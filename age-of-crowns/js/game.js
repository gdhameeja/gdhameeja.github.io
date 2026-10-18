'use strict';
// ============================================================================
//  Game simulation: world state, unit behaviour, combat, economy, production,
//  visibility, victory, and the command API shared by the UI and the AI.
// ============================================================================

class SpatialHash {
  constructor(n, cs) {
    this.cs = cs; this.w = Math.ceil(n / cs);
    this.cells = Array.from({ length: this.w * this.w }, () => []);
  }
  clear() { for (const c of this.cells) c.length = 0; }
  insert(u) {
    const cx = clamp(Math.floor(u.x / this.cs), 0, this.w - 1), cy = clamp(Math.floor(u.y / this.cs), 0, this.w - 1);
    this.cells[cy * this.w + cx].push(u);
  }
  query(x, y, r, out) {
    out.length = 0;
    const cs = this.cs, w = this.w;
    const x0 = clamp(Math.floor((x - r) / cs), 0, w - 1), x1 = clamp(Math.floor((x + r) / cs), 0, w - 1);
    const y0 = clamp(Math.floor((y - r) / cs), 0, w - 1), y1 = clamp(Math.floor((y + r) / cs), 0, w - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = this.cells[cy * w + cx];
      for (let i = 0; i < c.length; i++) out.push(c[i]);
    }
    return out;
  }
}

const KIND_RES = { wood: 'wood', gold: 'gold', stone: 'stone', forage: 'food', hunt: 'food', sheep: 'food', farm: 'food' };
const RES_TYPE_KIND = { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'forage' };

class Game {
  constructor(opts) {
    this.opts = opts;
    const n = this.n = opts.n || MAP_SIZES[opts.size].n;
    const nn = n * n;
    this.terrain = new Uint8Array(nn);
    this.block = new Uint8Array(nn);
    this.occ = new Int32Array(nn);
    this.ents = new Map();
    this.units = []; this.buildings = []; this.resources = []; this.carcasses = [];
    this.projectiles = []; this.corpses = []; this.fx = [];
    this.time = 0; this.tickN = 0;
    this.listeners = {};
    this.players = [new Player(this, 0, { name: 'Nature', civ: null })];
    opts.players.forEach((po, i) => this.players.push(new Player(this, i + 1, po)));
    this.viewer = (this.players.find(p => p.isHuman) || { id: 0 }).id;
    this.reveal = opts.reveal || false;
    this.pf = new Pathfinder(this);
    this.pathQueue = []; this.pathHead = 0;
    this.hash = new SpatialHash(n, 3);
    this.vis = new Uint8Array(nn);
    this.explored = new Uint8Array(nn);
    this.market = { food: 100, wood: 100, stone: 100 };
    this.dirty = false;
    this.terrainVersion = 0; this.resVersion = 0;
    this.over = false; this.winnerTeam = null;
    this.tmp = []; this.tmp2 = [];
    this.alerts = {};
    this.stats = { pathMs: 0 };
    generateMap(this, opts);
    this.ais = [];
    if (typeof AI !== 'undefined') for (const p of this.players) if (p.isAI) this.ais.push(new AI(this, p));
    this.updatePop();
    if (opts.reveal) this.explored.fill(1);
    this.updateVisibility();
  }

  // ------------------------------------------------------------------ events
  on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, ...args) { const l = this.listeners[ev]; if (l) for (const f of l) f(...args); }
  sfx(name, x, y) { this.emit('sfx', name, x, y); }
  notify(pid, text, kind) { this.emit('notify', pid, text, kind); }

  // ------------------------------------------------------------------ grid helpers
  inb(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; }
  tileAt(x, y) { return Math.floor(y) * this.n + Math.floor(x); }
  terrainBlock(i) { return TERRAINS[this.terrain[i]].pass ? 0 : 1; }
  passableXY(x, y, owner) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.n || ty >= this.n) return false;
    return this.pf.passable(ty * this.n + tx, owner);
  }
  rebuildBlock() {
    const nn = this.n * this.n;
    for (let i = 0; i < nn; i++) {
      const id = this.occ[i];
      if (!id) { this.block[i] = this.terrainBlock(i); continue; }
      const e = this.ents.get(id);
      if (!e) { this.occ[i] = 0; this.block[i] = this.terrainBlock(i); continue; }
      this.block[i] = this.entBlockVal(e);
    }
    this.terrainVersion++;
  }
  entBlockVal(e) {
    if (e.kind === 'resource') return e.def.blocks ? 1 : 0;
    if (e.def.walkable) return 0;
    if (e.def.gate) return 2;
    return 1;
  }
  setFootprint(e, on) {
    const n = this.n;
    const w = e.kind === 'building' ? e.w : 1, h = e.kind === 'building' ? e.h : 1;
    for (let y = e.ty; y < e.ty + h; y++) for (let x = e.tx; x < e.tx + w; x++) {
      const i = y * n + x;
      if (on) { this.occ[i] = e.id; this.block[i] = this.entBlockVal(e); }
      else if (this.occ[i] === e.id) { this.occ[i] = 0; this.block[i] = this.terrainBlock(i); }
    }
  }

  // ------------------------------------------------------------------ entity creation / removal
  addUnit(type, owner, x, y) {
    const u = new Unit(this, type, owner, x, y);
    this.units.push(u); this.ents.set(u.id, u);
    return u;
  }
  addBuilding(type, owner, tx, ty, built) {
    const b = new Building(this, type, owner, tx, ty, built);
    this.buildings.push(b); this.ents.set(b.id, b);
    this.setFootprint(b, true);
    if (built) this.players[owner].st.built++;
    return b;
  }
  addResource(type, tx, ty, amount, opts) {
    const r = new Resource(this, type, tx, ty, amount, opts);
    this.resources.push(r); this.ents.set(r.id, r);
    if (r.type === 'carcass') this.carcasses.push(r);
    if (r.def.blocks) this.setFootprint(r, true);
    this.resVersion++;
    return r;
  }
  removeEntity(e) {
    if (e.dead) return;
    e.dead = true;
    this.ents.delete(e.id);
    if (e.kind === 'building' || (e.kind === 'resource' && e.def.blocks)) this.setFootprint(e, false);
    if (e.kind === 'resource') this.resVersion++;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ main step
  step(dt) {
    if (this.over && this.opts.stopOnEnd) return;
    this.time += dt; this.tickN++;
    for (const b of this.buildings) { b.bcPrev = b.bcNow; b.bcNow = 0; }
    this.hash.clear();
    for (const u of this.units) if (!u.dead && !u.garrisonedIn) this.hash.insert(u);
    this.processPaths();
    for (const ai of this.ais) ai.update(dt);
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.garrisonedIn) continue;
      this.updateUnit(u, dt);
    }
    this.separate();
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b, dt);
    this.updateProjectiles(dt);
    if (this.tickN % 3 === 0) this.updateVisibility();
    if (this.tickN % 10 === 0) this.updateSheep();
    if (this.tickN % 20 === 0) this.slowUpdate();
    if (this.dirty) this.cleanup();
  }

  slowUpdate() {
    this.updatePop();
    this.checkVictory();
    if (this.tickN % 100 === 0) for (const r of ['food', 'wood', 'stone']) this.market[r] += Math.sign(100 - this.market[r]);
    if (this.tickN % 200 === 0) {
      for (const p of this.players) if (p.id) {
        let mil = 0, vil = 0;
        for (const u of this.units) if (u.owner === p.id && !u.dead) { if (u.isVillager) vil++; else if (u.st.pop) mil++; }
        const g = p.st.gathered;
        p.st.timeline.push({ t: this.time, pop: p.pop, mil, vil, eco: Math.round(g.food + g.wood + g.gold + g.stone) });
      }
    }
    // decay corpses / fx
    const t = this.time;
    if (this.corpses.length) this.corpses = this.corpses.filter(c => t - c.t0 < 40);
    if (this.fx.length) this.fx = this.fx.filter(f => t - f.t0 < f.life);
    // carcass decay when nobody is harvesting
    for (const r of this.carcasses) if (!r.dead && r.gatherers === 0) {
      r.amount -= 0.25;
      if (r.amount <= 0) this.removeEntity(r);
    }
    for (const r of this.resources) r.gatherers = 0;
  }

  cleanup() {
    this.dirty = false;
    this.units = this.units.filter(u => !u.dead);
    this.buildings = this.buildings.filter(b => !b.dead);
    this.resources = this.resources.filter(r => !r.dead);
    this.carcasses = this.carcasses.filter(r => !r.dead);
  }

  // ------------------------------------------------------------------ pathing
  requestPath(u, goal) {
    u.goal = goal;
    if (!u.pathPending) { u.pathPending = true; this.pathQueue.push(u); }
  }
  pointGoal(x, y, r = 0.5) { return { x0: x, y0: y, x1: x, y1: y, r }; }
  entGoal(e, r) {
    const [x0, y0, x1, y1] = entRect(e);
    return { x0, y0, x1, y1, r };
  }
  processPaths() {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    this.pf.expanded = 0;
    let done = 0;
    while (this.pathHead < this.pathQueue.length) {
      if (done > 0 && this.pf.expanded > 7000) break;
      const u = this.pathQueue[this.pathHead++];
      if (u.dead || !u.pathPending) continue;
      u.pathPending = false;
      const res = this.pf.find(u.x, u.y, u.goal, u.owner, 9000);
      u.path = res.pts.length ? res.pts : null;
      u.pi = 0; u.pathReached = res.reached; u.stuckT = 0; u.lastDist = 1e9;
      done++;
    }
    if (this.pathHead >= this.pathQueue.length) { this.pathQueue.length = 0; this.pathHead = 0; }
    else if (this.pathHead > 512) { this.pathQueue = this.pathQueue.slice(this.pathHead); this.pathHead = 0; }
    if (t0) this.stats.pathMs = performance.now() - t0;
  }

  // Move a unit, sliding along obstacles
  tryMove(u, nx, ny) {
    const owner = u.owner;
    const curOk = this.passableXY(u.x, u.y, owner);
    if (this.passableXY(nx, ny, owner) || !curOk) { u.x = nx; u.y = ny; return true; }
    if (this.passableXY(nx, u.y, owner)) { u.x = nx; return true; }
    if (this.passableXY(u.x, ny, owner)) { u.y = ny; return true; }
    return false;
  }

  followPath(u, dt) {
    if (!u.path) return false;
    const n = u.path.length >> 1;
    if (u.pi >= n) { u.path = null; return false; }
    const tx = u.path[u.pi * 2], ty = u.path[u.pi * 2 + 1];
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    const step = u.st.speed * dt;
    if (d <= step) {
      this.tryMove(u, tx, ty);
      u.pi++;
      u.lastDist = 1e9; u.stuckT = 0;
      if (u.pi >= n) u.path = null;
    } else {
      this.tryMove(u, u.x + dx / d * step, u.y + dy / d * step);
      if (d > u.lastDist - step * 0.25) u.stuckT += dt; else u.stuckT = Math.max(0, u.stuckT - dt);
      u.lastDist = d;
      if (u.stuckT > 1.0) {
        u.stuckT = 0; u.repaths++;
        if (u.goal && u.repaths < 6) { this.requestPath(u, u.goal); }
        else u.path = null;
      }
    }
    this.face(u, dx, dy);
    u.moving = true;
    return true;
  }

  face(u, dx, dy) { const s = dx - dy; if (Math.abs(s) > 0.01) u.facing = s > 0 ? 1 : -1; }

  // Direct step towards a point (final approach); returns progress made
  stepToward(u, x, y, dt) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy);
    if (d < 0.01) return 0;
    const step = Math.min(d, u.st.speed * dt);
    const ox = u.x, oy = u.y;
    this.tryMove(u, u.x + dx / d * step, u.y + dy / d * step);
    this.face(u, dx, dy);
    u.moving = true;
    return Math.hypot(u.x - ox, u.y - oy);
  }

  // Generic "get within range of entity" behaviour. Returns true when in range.
  approach(u, e, range, dt) {
    const d = distToEnt(u.x, u.y, e) - u.radius;
    if (d <= range) { u.path = null; u.approachFails = 0; return true; }
    const o = u.order;
    const pathR = Math.max(0.75, range + u.radius - 0.15);
    const tgtMoved = e.kind === 'unit' && o && (o.tpx == null || Math.hypot(e.x - o.tpx, e.y - o.tpy) > Math.max(1, d * 0.3));
    o.repathT = (o.repathT || 0) - dt;
    if (u.pathPending) return false;
    if ((!u.path && !o.pathed) || (tgtMoved && o.repathT <= 0)) {
      this.requestPath(u, this.entGoal(e, pathR));
      o.pathed = true; o.repathT = 0.7;
      if (e.kind === 'unit') { o.tpx = e.x; o.tpy = e.y; }
      return false;
    }
    if (!u.path) {
      // path exhausted but not in range: close in directly
      let px, py;
      if (e.kind === 'unit' || (e.kind === 'resource' && !e.def.blocks)) { px = e.x; py = e.y; }
      else { px = clamp(u.x, e.x0, e.x1); py = clamp(u.y, e.y0, e.y1); }
      const moved = this.stepToward(u, px, py, dt);
      if (moved < u.st.speed * dt * 0.3) {
        u.approachFails = (u.approachFails || 0) + dt;
        if (u.approachFails > 1.5) { u.approachFails = 0; o.pathed = false; o.fails = (o.fails || 0) + 1; }
      }
      if ((o.fails || 0) > 3) { o.unreachable = true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ unit update
  updateUnit(u, dt) {
    u.px = u.x; u.py = u.y;
    u.moving = false;
    if (u.attackCd > 0) u.attackCd -= dt;
    if (u.st.monk && u.faith < 100) u.faith = Math.min(100, u.faith + dt * 2);
    u.animT += dt;
    const prevAnim = u.anim;
    u.anim = 'idle';
    const o = u.order;
    if (u.owner === 0 || u.st.animal) this.animalLogic(u, dt);
    if (!o) {
      this.idleLogic(u, dt);
    } else {
      switch (o.type) {
        case 'move': this.doMove(u, o, dt); break;
        case 'attack': this.doAttack(u, o, dt); break;
        case 'gather': this.doGather(u, o, dt); break;
        case 'build': case 'repair': this.doBuild(u, o, dt); break;
        case 'garrison': this.doGarrison(u, o, dt); break;
        case 'dropoff': this.doDropoff(u, o, dt); break;
        case 'convert': this.doConvert(u, o, dt); break;
        case 'heal': this.doHeal(u, o, dt); break;
        default: this.finishOrder(u);
      }
    }
    if (u.path && !u.moving && u.order) this.followPath(u, dt);
    else if (u.path && !u.order) this.followPath(u, dt);
    if (u.moving) u.anim = 'walk';
    if (u.anim !== prevAnim && (u.anim === 'walk' || prevAnim === 'walk')) u.animT = 0;
  }

  finishOrder(u) {
    u.order = u.queue.length ? u.queue.shift() : null;
    u.path = null; u.pathPending = false;
    u.repaths = 0;
    if (!u.order) u.idleT = 0;
  }

  setOrder(u, order, queue = false) {
    if (queue && (u.order || u.queue.length)) { u.queue.push(order); return; }
    u.queue.length = 0;
    u.order = order;
    u.path = null; u.pathPending = false; u.repaths = 0;
    u.convertT = 0;
  }

  idleLogic(u, dt) {
    u.idleT += dt;
    if (u.st.animal) return;
    if (u.st.monk) {
      u.scanCd -= dt;
      if (u.scanCd <= 0) {
        u.scanCd = 1;
        const t = this.findHealTarget(u);
        if (t) u.order = { type: 'heal', target: t.id, auto: true };
      }
      return;
    }
    if (u.isVillager || u.st.atk <= 0 || u.stance === 'noattack') return;
    u.scanCd -= dt;
    if (u.scanCd > 0) return;
    u.scanCd = 0.4 + Math.random() * 0.2;
    const r = u.stance === 'standground' ? u.st.range + 0.5 : Math.max(u.st.los, u.st.range + 1);
    const t = this.findTarget(u, r, !!u.st.buildingsOnly);
    if (t) u.order = { type: 'attack', target: t.id, auto: true, gx: u.x, gy: u.y };
  }

  // Military auto-targeting
  findTarget(u, r, withBuildings) {
    const p = this.players[u.owner];
    let best = null, bestS = 1e9;
    if (!u.st.buildingsOnly) {
      const arr = this.hash.query(u.x, u.y, r, this.tmp);
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v.dead || v.garrisonedIn) continue;
        if (v.owner === 0) { if (v.st.animal !== 'predator' && !(v.st.animal === 'boar' && v.order && v.order.type === 'attack')) continue; }
        else if (!p.isEnemy(v.owner)) continue;
        const d = Math.hypot(v.x - u.x, v.y - u.y);
        if (d > r) continue;
        if (u.st.minRange && d < u.st.minRange) continue;
        let s = d;
        if (v.st.atk <= 0 && !v.st.monk) s += 3;
        if (v.isVillager) s += 1;
        if (v.st.classes.includes('siege') && u.st.bonus.siege) s -= 2;
        if (s < bestS) { bestS = s; best = v; }
      }
    }
    if (!best && withBuildings) {
      for (const b of this.buildings) {
        if (b.dead || !p.isEnemy(b.owner)) continue;
        const d = distToRect(u.x, u.y, b.x0, b.y0, b.x1, b.y1);
        if (d > r) continue;
        const s = d + (b.def.wall ? 6 : 0) + (b.type === 'farm' ? 3 : 0);
        if (s < bestS) { bestS = s; best = b; }
      }
    }
    return best;
  }

  findHealTarget(u) {
    const arr = this.hash.query(u.x, u.y, u.st.los, this.tmp);
    let best = null, bd = 1e9;
    for (const v of arr) {
      if (v.dead || v === u || v.owner !== u.owner || v.hp >= v.st.hp || v.st.classes.includes('siege') || v.st.animal) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  doMove(u, o, dt) {
    if (o.attackMove) {
      u.scanCd -= dt;
      if (u.scanCd <= 0) {
        u.scanCd = 0.5;
        const t = this.findTarget(u, Math.max(u.st.los, u.st.range + 1), true);
        if (t) {
          u.queue.unshift({ ...o, started: false });
          u.order = { type: 'attack', target: t.id, auto: true, fromAM: true };
          u.path = null;
          return;
        }
      }
    }
    if (!o.started) {
      o.started = true;
      u.repaths = 0;
      this.requestPath(u, this.pointGoal(o.x, o.y, 0.5));
      return;
    }
    if (u.pathPending || u.path) return;
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    o.finalT = (o.finalT || 0) + dt;
    if (d > 0.08 && o.finalT < 1.5 && this.passableXY(o.x, o.y, u.owner)) {
      if (this.stepToward(u, o.x, o.y, dt) < 0.001) o.finalT += 0.5;
      return;
    }
    if (o.follow) {
      const t = this.ents.get(o.follow);
      if (t && !t.dead) { o.x = t.x; o.y = t.y; o.started = false; o.finalT = 0; return; }
    }
    this.finishOrder(u);
  }

  canAttack(u, t) {
    if (!t || t.dead) return false;
    if (t.kind === 'resource') return false;
    if (t.kind === 'unit' && t.garrisonedIn) return false;
    if (u.st.atk <= 0) return false;
    if (u.st.buildingsOnly && t.kind !== 'building') return false;
    return true;
  }

  doAttack(u, o, dt) {
    const t = this.ents.get(o.target);
    if (!this.canAttack(u, t) || (t.kind === 'unit' && t.owner === u.owner && !t.st.animal && !o.force)) { this.finishOrder(u); return; }
    // leash for auto-acquired targets
    if (o.auto && o.gx != null) {
      const leash = u.stance === 'defensive' ? 6 : 14;
      if (Math.hypot(u.x - o.gx, u.y - o.gy) > leash) {
        const gx = o.gx, gy = o.gy;
        this.finishOrder(u);
        if (!u.order) u.order = { type: 'move', x: gx, y: gy };
        return;
      }
    }
    const range = u.st.range + (t.kind === 'building' && u.st.range > 0 ? 0.3 : 0);
    const d = distToEnt(u.x, u.y, t) - u.radius;
    if (u.st.minRange && d < u.st.minRange - 0.2) {
      // too close: back off a little, or give up
      if (u.stance === 'standground' || o.auto) { this.finishOrder(u); return; }
      const dx = u.x - t.x, dy = u.y - t.y, dd = Math.hypot(dx, dy) || 1;
      this.stepToward(u, u.x + dx / dd, u.y + dy / dd, dt);
      return;
    }
    if (d <= range + (u.st.range > 0 ? 0 : 0.2)) {
      u.path = null;
      this.face(u, t.x - u.x, t.y - u.y);
      u.anim = 'attack';
      if (u.attackCd <= 0) {
        this.performAttack(u, t);
        u.attackCd = u.st.reload;
        u.animT = 0;
      }
      return;
    }
    if (u.stance === 'standground' && !o.forceMove) { this.finishOrder(u); return; }
    this.approach(u, t, range, dt);
    if (o.unreachable) this.finishOrder(u);
  }

  performAttack(u, t) {
    const st = u.st;
    if (st.proj) {
      this.fireProjectile(u, st, t, st.proj);
    } else {
      const dmg = this.calcDamage(st, t);
      this.applyDamage(t, dmg, u);
      if (st.trample) {
        const arr = this.hash.query(t.x, t.y, 1, this.tmp2);
        for (const v of arr) {
          if (v === t || v.dead || v.garrisonedIn || !this.players[u.owner].isEnemy(v.owner)) continue;
          if (Math.hypot(v.x - t.x, v.y - t.y) < 0.6) this.applyDamage(v, Math.max(1, Math.round(dmg * st.trample)), u);
        }
      }
      this.sfx(t.kind === 'building' ? (st.classes.includes('siege') ? 'ram' : 'hitBuilding') : 'melee', t.x, t.y);
    }
  }

  calcDamage(ast, t) {
    let arm, classes;
    if (t.kind === 'building') {
      const p = this.players[t.owner];
      arm = { m: t.def.armor.m + p.mods.buildingArmor, p: t.def.armor.p + p.mods.buildingArmor };
      classes = t.def.wall || t.def.gate ? ['building', 'wall'] : ['building'];
    } else { arm = t.st.armor; classes = t.st.classes; }
    let d = ast.atk - (ast.atkType === 'pierce' ? arm.p : arm.m);
    if (d < 0) d = 0;
    if (ast.bonus) for (const k in ast.bonus) if (classes.includes(k)) d += ast.bonus[k];
    return Math.max(1, d);
  }

  applyDamage(t, dmg, attacker) {
    if (t.dead) return;
    t.hp -= dmg;
    t.lastHitT = this.time;
    if (attacker) t.lastAttacker = attacker.id;
    if (t.owner > 0 && attacker && attacker.owner !== t.owner) this.alert(t, attacker);
    if (t.hp <= 0) { this.kill(t, attacker); return; }
    if (t.kind !== 'unit' || !attacker || attacker.dead || attacker.kind !== 'unit') return;
    // reactions
    const an = t.st.animal;
    if (an === 'flee') {
      const dx = t.x - attacker.x, dy = t.y - attacker.y, d = Math.hypot(dx, dy) || 1;
      const fx = clamp(t.x + dx / d * 3, 1, this.n - 1), fy = clamp(t.y + dy / d * 3, 1, this.n - 1);
      this.setOrder(t, { type: 'move', x: fx, y: fy });
      t.home = { x: fx, y: fy };
      return;
    }
    if (an === 'boar' || an === 'predator') {
      if (!t.order || t.order.type !== 'attack') this.setOrder(t, { type: 'attack', target: attacker.id, force: true });
      return;
    }
    if (t.isVillager || t.st.atk <= 0 || t.stance === 'noattack') return;
    if (!t.order || (t.order.type === 'move' && t.order.attackMove)) {
      if (t.stance === 'standground' && distToEnt(t.x, t.y, attacker) > t.st.range + 0.5) return;
      if (t.st.buildingsOnly) return;
      if (t.order) t.queue.unshift({ ...t.order, started: false });
      t.order = { type: 'attack', target: attacker.id, auto: true, gx: t.x, gy: t.y };
      t.path = null;
    }
  }

  alert(t, attacker) {
    const p = this.players[t.owner];
    const a = this.alerts[p.id] || (this.alerts[p.id] = { t: -99, x: 0, y: 0 });
    if (this.time - a.t > 15 || Math.hypot(a.x - t.x, a.y - t.y) > 20) {
      a.t = this.time; a.x = t.x; a.y = t.y;
      this.emit('attacked', p.id, t, attacker);
    }
    p.lastAttackedT = this.time; p.lastAttackedPos = { x: t.x, y: t.y };
  }

  kill(e, killer) {
    if (e.dead) return;
    const kp = killer ? this.players[killer.owner] : null;
    const op = this.players[e.owner];
    if (e.kind === 'unit') {
      if (e.st.animal) {
        if (e.st.food) {
          const r = this.addResource('carcass', Math.floor(e.x), Math.floor(e.y), e.st.food, { x: e.x, y: e.y, animal: e.type, facing: e.facing });
          e.carcassId = r.id;
        } else this.corpses.push({ type: e.type, owner: 0, x: e.x, y: e.y, facing: e.facing, t0: this.time });
      } else {
        this.corpses.push({ type: e.type, owner: e.owner, x: e.x, y: e.y, facing: e.facing, t0: this.time, variant: e.variant });
        if (e.owner) op.st.lost++;
        if (kp && kp.id && killer.owner !== e.owner) kp.st.kills++;
      }
      if (e.farmId) { const f = this.ents.get(e.farmId); if (f && f.farmer === e.id) f.farmer = 0; }
      this.sfx(e.st.animal ? 'animalDie' : (e.st.classes.includes('siege') ? 'siegeDie' : 'die'), e.x, e.y);
      this.removeEntity(e);
      this.emit('died', e, killer);
    } else if (e.kind === 'building') {
      this.ejectGarrison(e);
      if (e.farmer) { const f = this.ents.get(e.farmer); if (f) f.farmId = 0; }
      this.removeEntity(e);
      if (e.owner) { op.st.bLost++; if (kp && kp.id && killer.owner !== e.owner) kp.st.razed++; }
      if (e.type !== 'farm' || e.built) this.fx.push({ type: 'rubble', x: e.x, y: e.y, size: e.w, t0: this.time, life: 45 });
      this.sfx(e.def.wall ? 'wallFall' : 'collapse', e.x, e.y);
      this.updatePop();
      this.emit('died', e, killer);
    } else {
      this.removeEntity(e);
    }
  }

  // ------------------------------------------------------------------ projectiles
  fireProjectile(u, st, t, type, fromZ = 14) {
    const sx = u.x !== undefined ? u.x : t.x, sy = u.y;
    let tx = t.x, ty = t.y;
    if (t.kind === 'building') { tx = t.x; ty = t.y; }
    const p = this.players[u.owner];
    const moving = t.kind === 'unit' && (Math.abs(t.x - t.px) + Math.abs(t.y - t.py)) > 0.001;
    let acc = st.accuracy == null ? 1 : st.accuracy;
    if (moving && !p.mods.ballistics && st.proj !== 'stone' && st.proj !== 'boulder') acc *= 0.8;
    const hit = st.ballistic ? false : Math.random() < acc;
    const speed = { arrow: 8, bolt: 9, javelin: 6.5, axe: 5.5, spear: 6, stone: 5, boulder: 4.2, bullet: 22 }[type] || 7;
    if (st.ballistic) {
      // lead the shot slightly if the target is a unit, but don't track it afterwards
      if (t.kind === 'unit' && type === 'stone' && p.mods.ballistics) { tx += (t.x - t.px) * 4; ty += (t.y - t.py) * 4; }
      if (type === 'boulder' && t.kind === 'unit') { tx += (Math.random() - 0.5) * 2; ty += (Math.random() - 0.5) * 2; }
    } else if (!hit) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.8;
      tx += Math.cos(a) * r; ty += Math.sin(a) * r;
    }
    const d = Math.hypot(tx - sx, ty - sy);
    const pr = {
      type, owner: u.owner, from: u.id || 0, st, target: t.id, homing: hit,
      sx, sy, tx, ty, x: sx, y: sy, z: fromZ, t: 0, total: Math.max(0.15, d / speed),
      arc: st.ballistic ? Math.max(30, d * 9) : Math.max(6, d * 4), fromZ, splash: st.splash || 0, ballistic: !!st.ballistic,
      angle: 0,
    };
    this.projectiles.push(pr);
    this.sfx(type === 'bullet' ? 'gun' : type === 'stone' || type === 'boulder' ? 'catapult' : type === 'javelin' || type === 'axe' || type === 'spear' ? 'throw' : 'bow', sx, sy);
  }

  updateProjectiles(dt) {
    const out = [];
    for (const p of this.projectiles) {
      p.t += dt;
      if (p.homing) {
        const t = this.ents.get(p.target);
        if (t && !t.dead && !(t.kind === 'unit' && t.garrisonedIn)) { p.tx = t.x; p.ty = t.y; }
        else p.homing = false;
      }
      const k = Math.min(1, p.t / p.total);
      const nx = p.sx + (p.tx - p.sx) * k, ny = p.sy + (p.ty - p.sy) * k;
      const z = p.fromZ * (1 - k) + 4 * p.arc * k * (1 - k);
      const pz = p.z;
      // screen-space angle for rendering
      const sdx = ((nx - ny) - (p.x - p.y)) * HW, sdy = ((nx + ny) - (p.x + p.y)) * HH - (z - pz);
      if (Math.abs(sdx) + Math.abs(sdy) > 0.01) p.angle = Math.atan2(sdy, sdx);
      p.x = nx; p.y = ny; p.z = z;
      if (k >= 1) this.impact(p);
      else out.push(p);
    }
    this.projectiles = out;
  }

  impact(p) {
    const attacker = this.ents.get(p.from) || { owner: p.owner, id: 0, kind: 'none', dead: true };
    if (p.splash) {
      const arr = this.hash.query(p.tx, p.ty, p.splash + 0.5, this.tmp2);
      for (const v of arr) {
        if (v.dead || v.garrisonedIn) continue;
        const d = Math.hypot(v.x - p.tx, v.y - p.ty) - v.radius;
        if (d > p.splash) continue;
        const f = d < p.splash * 0.4 ? 1 : 0.5;
        this.applyDamage(v, Math.max(1, Math.round(this.calcDamage(p.st, v) * f)), attacker);
      }
      for (const b of this.buildings) {
        if (b.dead || b.owner === p.owner) continue;
        if (distToRect(p.tx, p.ty, b.x0, b.y0, b.x1, b.y1) <= p.splash * 0.5) this.applyDamage(b, this.calcDamage(p.st, b), attacker);
      }
      this.fx.push({ type: 'impact', x: p.tx, y: p.ty, t0: this.time, life: 1.2, size: p.splash });
      this.sfx('impact', p.tx, p.ty);
      return;
    }
    if (p.homing) {
      const t = this.ents.get(p.target);
      if (t && !t.dead) {
        const dmg = p.st.isBuildingAttack ? p.st.dmgFor(t) : this.calcDamage(p.st, t);
        this.applyDamage(t, dmg, attacker);
        if (t.kind === 'building' && (p.type === 'arrow' || p.type === 'bolt')) this.fx.push({ type: 'stuck', x: p.tx + (Math.random() - 0.5) * 0.6, y: p.ty + (Math.random() - 0.5) * 0.6, z: 6 + Math.random() * 18, t0: this.time, life: 4, a: p.angle });
      }
    } else if (p.type === 'arrow' || p.type === 'bolt' || p.type === 'javelin' || p.type === 'spear') {
      this.fx.push({ type: 'stuck', x: p.tx, y: p.ty, z: 0, t0: this.time, life: 5, a: p.angle });
    }
  }

  // ------------------------------------------------------------------ economy
  gatherKind(t) {
    if (!t) return null;
    if (t.kind === 'building') return t.type === 'farm' ? 'farm' : null;
    if (t.kind === 'resource') {
      if (t.type === 'carcass') return t.animal === 'sheep' ? 'sheep' : 'hunt';
      return RES_TYPE_KIND[t.type];
    }
    if (t.kind === 'unit' && t.st.animal && t.st.food) return t.type === 'sheep' ? 'sheep' : 'hunt';
    return null;
  }

  // Ring search on the occupancy grid for a resource of a given kind
  findResourceNear(x, y, kind, maxR, owner, exclude, liveR = maxR) {
    const n = this.n;
    if (kind === 'farm') {
      let best = null, bd = 1e9;
      for (const b of this.buildings) {
        if (b.dead || b.type !== 'farm' || b.owner !== owner) continue;
        if (b.farmer && this.ents.get(b.farmer) && !this.ents.get(b.farmer).dead && b.farmer !== exclude) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < bd && d <= maxR) { bd = d; best = b; }
      }
      return best;
    }
    if (kind === 'hunt' || kind === 'sheep') {
      let best = null, bd = 1e9;
      for (const r of this.carcasses) {
        if (r.dead || (kind === 'sheep') !== (r.animal === 'sheep')) continue;
        const d = Math.hypot(r.x - x, r.y - y);
        if (d < bd && d <= maxR) { bd = d; best = r; }
      }
      if (best) return best;
      const arr = this.hash.query(x, y, liveR, this.tmp2);
      for (const u of arr) {
        if (u.dead || !u.st.animal) continue;
        if (kind === 'sheep' ? (u.type !== 'sheep' || u.owner !== owner) : (u.type !== 'deer')) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d < bd && d <= liveR) { bd = d; best = u; }
      }
      return best;
    }
    const want = kind === 'wood' ? 'tree' : kind === 'forage' ? 'berry' : kind;
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bd = 1e9;
    for (let r = 0; r <= maxR; r++) {
      if (best && r > bd + 1.5) break;
      const ring = ringOffsets(r);
      for (let k = 0; k < ring.length; k += 2) {
        const tx = cx + ring[k], ty = cy + ring[k + 1];
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        const id = this.occ[ty * n + tx];
        if (!id) continue;
        const e = this.ents.get(id);
        if (!e || e.kind !== 'resource' || e.type !== want || e.dead) continue;
        if (!this.hasOpenSide(tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y) + (e.gatherers > 2 ? 2 : 0);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  hasOpenSide(tx, ty) {
    const n = this.n;
    if (tx > 0 && this.block[ty * n + tx - 1] === 0) return true;
    if (tx < n - 1 && this.block[ty * n + tx + 1] === 0) return true;
    if (ty > 0 && this.block[(ty - 1) * n + tx] === 0) return true;
    if (ty < n - 1 && this.block[(ty + 1) * n + tx] === 0) return true;
    return false;
  }

  nearestDrop(u, res) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (b.dead || !b.built || b.owner !== u.owner || !b.def.drop || !b.def.drop.includes(res)) continue;
      const d = distToRect(u.x, u.y, b.x0, b.y0, b.x1, b.y1);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // returns true when carried resources have been deposited
  deposit(u, o, dt) {
    if (u.carry <= 0) return true;
    let d = o.dropId && this.ents.get(o.dropId);
    if (!d || d.dead || !d.built || !d.def.drop.includes(u.carryType)) {
      d = this.nearestDrop(u, u.carryType);
      if (!d) { o.noDrop = true; return false; }
      o.dropId = d.id; o.pathed = false;
    }
    if (this.approach(u, d, 0.25, dt)) {
      const p = this.players[u.owner];
      const amt = Math.floor(u.carry * 100) / 100;
      p.res[u.carryType] += amt;
      p.st.gathered[u.carryType] += amt;
      u.carry = 0; u.carryType = null;
      o.pathed = false; o.dropId = 0;
      return true;
    }
    if (o.unreachable) { o.unreachable = false; o.fails = 0; o.noDrop = true; }
    return false;
  }

  doDropoff(u, o, dt) {
    if (this.deposit(u, o, dt) || o.noDrop) this.finishOrder(u);
  }

  doGather(u, o, dt) {
    if (!u.isVillager) { this.finishOrder(u); return; }
    const p = this.players[u.owner];
    let t = this.ents.get(o.target);
    if (!t || t.dead) {
      const old = o.lastEnt;
      if (old && old.carcassId && this.ents.get(old.carcassId)) t = this.ents.get(old.carcassId);
      else t = this.findResourceNear(o.lx != null ? o.lx : u.x, o.ly != null ? o.ly : u.y, o.kind || 'wood', 9, u.owner, u.id, o.kind === 'hunt' ? 5 : 9);
      if (!t) {
        if (u.carry > 0) { this.setOrder(u, { type: 'dropoff' }); return; }
        this.finishOrder(u); return;
      }
      o.target = t.id; o.pathed = false; o.fails = 0; o.unreachable = false;
    }
    o.lastEnt = t;
    const kind = this.gatherKind(t);
    if (!kind) { this.finishOrder(u); return; }
    o.kind = kind; o.lx = t.x; o.ly = t.y;
    const res = KIND_RES[kind];
    u.task = kind;
    const cap = p.mods.carry + (kind === 'farm' ? p.mods.farmCarry : 0);
    if (o.phase !== 'drop' && ((u.carry > 0 && u.carryType !== res) || u.carry >= cap - 1e-6)) {
      o.phase = 'drop'; o.pathed = false; o.fails = 0; o.unreachable = false; u.path = null;
    }
    if (o.phase === 'drop') {
      if (this.deposit(u, o, dt)) { o.phase = 'res'; o.pathed = false; o.fails = 0; }
      else if (o.noDrop) { o.noDrop = false; o.phase = 'res'; if (u.carry >= cap - 1e-6) { u.anim = 'idle'; this.finishOrder(u); } }
      return;
    }
    // ---- living animal: hunt it
    if (t.kind === 'unit') {
      const range = 2.5;
      if (this.approach(u, t, range, dt)) {
        this.face(u, t.x - u.x, t.y - u.y);
        u.anim = 'attack';
        if (u.attackCd <= 0) {
          this.fireProjectile(u, { ...u.st, atkType: 'pierce', proj: 'spear', accuracy: 1, bonus: {}, atk: u.st.atk + (p.techs.has('loom') ? 0 : 0) }, t, 'spear', 12);
          u.attackCd = 1.5;
          u.animT = 0;
        }
      } else if (o.unreachable) this.finishOrder(u);
      return;
    }
    // ---- farm
    if (kind === 'farm') {
      if (t.owner !== u.owner) { this.finishOrder(u); return; }
      if (!t.built) { const r = this.buildStep(u, o, t, dt); if (r === 'fail') this.finishOrder(u); return; }
      const fo = t.farmer && this.ents.get(t.farmer);
      if (fo && fo !== u && !fo.dead && fo.order && fo.order.target === t.id) {
        const alt = this.findResourceNear(u.x, u.y, 'farm', 10, u.owner, u.id);
        if (alt && alt !== t) { o.target = alt.id; o.pathed = false; } else this.finishOrder(u);
        return;
      }
      t.farmer = u.id; u.farmId = t.id;
      const fx = t.x + (u.id % 3 - 1) * 0.5, fy = t.y + ((u.id >> 2) % 3 - 1) * 0.4;
      const d = Math.hypot(u.x - fx, u.y - fy);
      if (d > 0.35) {
        if (!o.pathed && !u.pathPending && !u.path) { this.requestPath(u, this.pointGoal(fx, fy, 0.5)); o.pathed = true; }
        else if (!u.path && !u.pathPending) { if (this.stepToward(u, fx, fy, dt) < 0.001) { o.farmStuck = (o.farmStuck || 0) + dt; if (o.farmStuck > 2) { u.x = fx; u.y = fy; } } }
        return;
      }
      u.path = null;
      u.anim = 'gather';
      this.workBeat(u, 'farm', t, dt);
      const rate = GATHER_RATES.farm * p.mods.gather.farm * p.mods.aiGather;
      const amt = Math.min(rate * dt, t.food, cap - u.carry);
      u.carry += amt; u.carryType = 'food'; t.food -= amt;
      if (t.food <= 0.01) this.farmDepleted(t, u);
      return;
    }
    // ---- static resource (tree, mine, bush, carcass)
    if (this.approach(u, t, 0.3, dt)) {
      this.face(u, t.x - u.x, t.y - u.y);
      u.anim = 'gather';
      t.gatherers++;
      const rate = GATHER_RATES[kind] * (p.mods.gather[kind] || 1) * p.mods.aiGather;
      const amt = Math.min(rate * dt, t.amount, cap - u.carry);
      u.carry += amt; u.carryType = res; t.amount -= amt;
      this.workBeat(u, kind, t, dt);
      if (t.type === 'tree' && t.fellAt == null && t.amount < t.max) { t.fellAt = this.time; this.sfx('treeFall', t.x, t.y); }
      if (t.amount <= 0.01) this.removeEntity(t);
    } else if (o.unreachable) {
      // try another resource of the same kind
      const alt = this.findResourceNear(u.x, u.y, kind, 6, u.owner, u.id);
      if (alt && alt !== t) { o.target = alt.id; o.pathed = false; o.unreachable = false; o.fails = 0; }
      else this.finishOrder(u);
    }
  }

  // Keeps a villager's work animation cycling and plays the sound on the impact frame
  workBeat(u, kind, t, dt) {
    const P = WORK_CYCLE[kind] || 1, hit = P * WORK_HIT;
    if (u.animT >= hit && u.animT - dt < hit) {
      const snd = { wood: 'chop', gold: 'mine', stone: 'mine', build: 'hammer', farm: 'till', forage: 'pluck', hunt: 'cut', sheep: 'cut' }[kind];
      if (snd) this.sfx(snd, t.x, t.y);
    }
    if (u.animT >= P) u.animT -= P;
  }

  farmDepleted(f, u) {
    const p = this.players[f.owner];
    const cost = p.buildingCost('farm');
    if (p.autoReseed !== false && p.canAfford(cost)) {
      p.pay(cost);
      f.built = false; f.progress = 0; f.hp = 1; f.food = 0;
      this.sfx('reseed', f.x, f.y);
    } else {
      f.farmer = 0;
      this.removeEntity(f);
      this.notify(f.owner, 'A farm has been exhausted.', 'info');
    }
  }

  // ------------------------------------------------------------------ construction
  buildStep(u, o, b, dt) {
    if (!b || b.dead) return 'fail';
    if (b.built && (o.type !== 'repair' || b.hp >= b.maxHp)) return 'done';
    if (!this.approach(u, b, 0.25, dt)) return o.unreachable ? 'fail' : 'moving';
    u.path = null;
    this.face(u, b.x - u.x, b.y - u.y);
    u.anim = 'build'; u.task = 'build';
    const p = this.players[b.owner];
    if (!b.built) {
      b.bcNow++;
      const n = Math.max(1, b.bcPrev);
      const dp = p.aegis ? 1 : dt * p.mods.buildRate * (3 / (n + 2)) / b.def.time;
      b.progress = Math.min(1, b.progress + dp);
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * dp);
      this.workBeat(u, 'build', b, dt);
      if (b.progress >= 1) { this.completeBuilding(b); return 'done'; }
    } else {
      // repair: costs a little wood/stone
      const rate = b.maxHp / (b.def.time * 2.5) * (b.def.wall ? 3 : 1) + 0.6;
      b.hp = Math.min(b.maxHp, b.hp + rate * dt);
      this.workBeat(u, 'build', b, dt);
      if (b.hp >= b.maxHp) return 'done';
    }
    return 'working';
  }

  completeBuilding(b) {
    if (b.built) return;
    const p = this.players[b.owner];
    b.built = true; b.progress = 1; b.builtAt = this.time;
    b.hp = Math.max(1, Math.min(b.maxHp, b.hp));
    if (b.hp > b.maxHp * 0.98) b.hp = b.maxHp;
    if (b.type === 'farm') { b.food = p.mods.farmFood; b.foodMax = b.food; }
    else { p.st.built++; }
    this.updatePop();
    this.emit('built', b);
    this.sfx(b.type === 'farm' ? 'farmDone' : 'built', b.x, b.y);
  }

  doBuild(u, o, dt) {
    if (!u.isVillager) { this.finishOrder(u); return; }
    const b = this.ents.get(o.target);
    const r = this.buildStep(u, o, b, dt);
    if (r === 'fail') { this.finishOrder(u); return; }
    if (r !== 'done') return;
    // after-construction behaviour
    if (u.queue.length) { this.finishOrder(u); return; }
    if (b.type === 'farm' && b.owner === u.owner) {
      if (!b.farmer || b.farmer === u.id || !this.ents.get(b.farmer)) { u.order = { type: 'gather', target: b.id }; u.path = null; return; }
    }
    if (b.def.drop && b.type !== 'towncenter') {
      const kinds = b.type === 'lumbercamp' ? ['wood'] : b.type === 'miningcamp' ? ['gold', 'stone'] : ['forage', 'farm'];
      for (const k of kinds) {
        const t = this.findResourceNear(b.x, b.y, k, 9, u.owner, u.id);
        if (t) { u.order = { type: 'gather', target: t.id }; u.path = null; return; }
      }
    }
    // help with another nearby foundation
    for (const f of this.buildings) {
      if (f.dead || f.built || f.owner !== u.owner || Math.hypot(f.x - u.x, f.y - u.y) > 8) continue;
      u.order = { type: 'build', target: f.id }; u.path = null; return;
    }
    this.finishOrder(u);
  }

  pushOutUnits(b) {
    const arr = this.hash.query(b.x, b.y, b.w + 1, this.tmp2);
    for (const u of arr) {
      if (u.dead || u.garrisonedIn) continue;
      if (u.x >= b.x0 - u.radius && u.x <= b.x1 + u.radius && u.y >= b.y0 - u.radius && u.y <= b.y1 + u.radius) {
        const spot = this.freeSpotNear(u.x, u.y, u.owner, 6);
        if (spot) { u.x = u.px = spot[0]; u.y = u.py = spot[1]; u.path = null; if (u.order) { u.order.pathed = false; u.order.started = false; } }
      }
    }
  }

  freeSpotNear(x, y, owner, maxR) {
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bd = 1e9;
    for (let r = 0; r <= maxR; r++) {
      const ring = ringOffsets(r);
      for (let k = 0; k < ring.length; k += 2) {
        const tx = cx + ring[k], ty = cy + ring[k + 1];
        if (!this.inb(tx, ty) || !this.pf.passable(ty * this.n + tx, owner)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d < bd) { bd = d; best = [tx + 0.5, ty + 0.5]; }
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------------ garrison
  doGarrison(u, o, dt) {
    const b = this.ents.get(o.target);
    if (!b || b.dead || !b.built || !b.def.garrison || !this.players[u.owner].isAlly(b.owner) || b.garrison.length >= b.def.garrison || u.st.garrisonable === false || !u.st.garrisonable) { this.finishOrder(u); return; }
    if (this.approach(u, b, 0.35, dt)) this.garrisonInto(u, b);
    else if (o.unreachable) this.finishOrder(u);
  }

  garrisonInto(u, b) {
    if (u.farmId) { const f = this.ents.get(u.farmId); if (f && f.farmer === u.id) f.farmer = 0; u.farmId = 0; }
    u.garrisonedIn = b.id;
    b.garrison.push(u.id);
    u.order = null; u.queue.length = 0; u.path = null; u.pathPending = false;
    u.selected = false;
    this.emit('garrisoned', u, b);
  }

  ejectGarrison(b) {
    const ids = b.garrison.slice();
    b.garrison.length = 0;
    let k = 0;
    for (const id of ids) {
      const u = this.ents.get(id);
      if (!u) continue;
      u.garrisonedIn = 0;
      const ang = (k++ / Math.max(1, ids.length)) * Math.PI * 2;
      const ex = b.x + Math.cos(ang) * (b.w / 2 + 0.8), ey = b.y + Math.sin(ang) * (b.h / 2 + 0.8);
      const spot = this.freeSpotNear(ex, ey, u.owner, 6) || [ex, ey];
      u.x = u.px = spot[0]; u.y = u.py = spot[1];
      if (b.rally && !b.dead) {
        if (b.rally.ent && this.ents.get(b.rally.ent)) this.commandTarget([u], this.ents.get(b.rally.ent));
        else this.setOrder(u, { type: 'move', x: b.rally.x, y: b.rally.y });
      }
      if (u.bellOrder) { u.order = u.bellOrder; u.bellOrder = null; if (u.order) { u.order.pathed = false; u.order.started = false; } }
    }
  }

  // ------------------------------------------------------------------ monks
  doConvert(u, o, dt) {
    const t = this.ents.get(o.target);
    if (!t || t.dead || t.kind !== 'unit' || t.garrisonedIn || t.owner === u.owner || !this.players[u.owner].isEnemy(t.owner)) { this.finishOrder(u); return; }
    if (u.faith < 100) { if (o.auto) this.finishOrder(u); else { u.anim = 'idle'; } return; }
    if (this.approach(u, t, u.st.range, dt)) {
      this.face(u, t.x - u.x, t.y - u.y);
      u.anim = 'pray';
      if (!o.need) o.need = 4 + Math.random() * 6 + (t.st.classes.includes('siege') ? 3 : 0);
      u.convertT += dt;
      if (u.animT > 1.2) { u.animT = 0; }
      if (u.convertT >= o.need) {
        u.convertT = 0; u.faith = 0;
        this.convertUnit(t, u.owner);
        this.sfx('convert', t.x, t.y);
        this.finishOrder(u);
      }
    } else if (o.unreachable) this.finishOrder(u);
  }

  convertUnit(t, newOwner) {
    const old = t.owner;
    if (t.farmId) { const f = this.ents.get(t.farmId); if (f && f.farmer === t.id) f.farmer = 0; t.farmId = 0; }
    t.owner = newOwner;
    t.st = this.players[newOwner].stats[t.type];
    t.hp = Math.min(t.hp, t.st.hp);
    t.order = null; t.queue.length = 0; t.path = null; t.selected = false;
    t.carry = 0; t.carryType = null;
    this.players[newOwner].st.converted++;
    if (old) this.players[old].st.lost++;
    this.emit('converted', t, old, newOwner);
  }

  doHeal(u, o, dt) {
    const t = this.ents.get(o.target);
    if (!t || t.dead || t.garrisonedIn || t.kind !== 'unit' || !this.players[u.owner].isAlly(t.owner) || t.hp >= t.st.hp) { this.finishOrder(u); return; }
    if (this.approach(u, t, 3.5, dt)) {
      u.anim = 'pray';
      this.face(u, t.x - u.x, t.y - u.y);
      t.hp = Math.min(t.st.hp, t.hp + 1.8 * dt);
    } else if (o.unreachable) this.finishOrder(u);
  }

  // ------------------------------------------------------------------ animals
  animalLogic(u, dt) {
    const an = u.st.animal;
    if (!an) return;
    if (an === 'herd' && u.owner !== 0) return;
    if (an === 'predator' && !u.order) {
      u.scanCd -= dt;
      if (u.scanCd <= 0) {
        u.scanCd = 1;
        const arr = this.hash.query(u.x, u.y, u.st.los, this.tmp);
        let best = null, bd = 1e9;
        for (const v of arr) {
          if (v.dead || v.owner === 0 || v.st.classes.includes('siege')) continue;
          if (u.owner && this.players[u.owner].isAlly(v.owner)) continue;   // tamed predators spare their master's people
          const d = Math.hypot(v.x - u.x, v.y - u.y);
          if (d < bd && d < u.st.los) { bd = d; best = v; }
        }
        if (best) { u.order = { type: 'attack', target: best.id, force: true }; return; }
      }
    }
    if ((an === 'predator' || an === 'boar') && u.order && u.order.type === 'attack' && Math.hypot(u.x - u.home.x, u.y - u.home.y) > 12) {
      this.setOrder(u, { type: 'move', x: u.home.x, y: u.home.y });
      return;
    }
    if (!u.order) {
      u.wanderT -= dt;
      if (u.wanderT <= 0) {
        u.wanderT = 5 + Math.random() * 10;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
        const x = clamp(u.home.x + Math.cos(a) * r, 1, this.n - 1), y = clamp(u.home.y + Math.sin(a) * r, 1, this.n - 1);
        if (this.passableXY(x, y, 0)) u.order = { type: 'move', x, y, wander: true };
      }
    }
  }

  updateSheep() {
    for (const u of this.units) {
      if (u.dead || u.type !== 'sheep') continue;
      const arr = this.hash.query(u.x, u.y, 4, this.tmp);
      let ownNear = false, closest = null, cd = 1e9;
      for (const v of arr) {
        if (v.dead || v.owner === 0 || v.st.animal) continue;
        const d = Math.hypot(v.x - u.x, v.y - u.y);
        if (v.owner === u.owner) { if (d < 4) ownNear = true; }
        else if (d < 2.6 && d < cd) { cd = d; closest = v; }
      }
      if (closest && (u.owner === 0 || !ownNear)) {
        const old = u.owner;
        u.owner = closest.owner;
        u.st = this.players[u.owner].stats.sheep;
        u.order = null; u.path = null; u.selected = false;
        u.home = { x: u.x, y: u.y };
        if (old === 0 && u.owner === this.viewer) this.sfx('sheep', u.x, u.y);
      }
    }
  }

  // ------------------------------------------------------------------ separation
  separate() {
    const arr = this.tmp;
    for (const u of this.units) {
      if (u.dead || u.garrisonedIn) continue;
      this.hash.query(u.x, u.y, 1, arr);
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v.id <= u.id || v.dead || v.garrisonedIn) continue;
        const dx = v.x - u.x, dy = v.y - u.y;
        const rr = (u.radius + v.radius) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2), nx, ny;
        if (d < 1e-4) { const a = (u.id * 2.39996) % (Math.PI * 2); nx = Math.cos(a); ny = Math.sin(a); d = 0; }
        else { nx = dx / d; ny = dy / d; }
        const ov = (rr - d) * 0.5;
        const wu = this.pushWeight(u), wv = this.pushWeight(v);
        const tot = wu + wv;
        if (tot <= 0) continue;
        const pu = ov * wu / tot * 2 * 0.5, pv = ov * wv / tot * 2 * 0.5;
        if (pu > 0) { const nxu = u.x - nx * pu, nyu = u.y - ny * pu; if (this.passableXY(nxu, nyu, u.owner)) { u.x = nxu; u.y = nyu; } }
        if (pv > 0) { const nxv = v.x + nx * pv, nyv = v.y + ny * pv; if (this.passableXY(nxv, nyv, v.owner)) { v.x = nxv; v.y = nyv; } }
      }
    }
  }
  pushWeight(u) {
    if (u.anim === 'gather' || u.anim === 'build' || u.anim === 'attack' || u.anim === 'pray') return 0.08;
    if (u.moving) return 0.6;
    return 1;
  }

  // ------------------------------------------------------------------ buildings
  updateBuilding(b, dt) {
    if (!b.built) return;
    const p = this.players[b.owner];
    // production
    if (b.queue.length) {
      const q = b.queue[0];
      if (q.kind === 'unit') {
        if (p.pop >= p.popCap || p.pop >= MAX_POP) {
          if (!q.housed) { q.housed = true; this.emit('housed', p, b); }
        } else {
          q.housed = false;
          q.t += p.aegis ? q.total : dt * (p.mods.trainSpeed[b.type] || 1);
          if (q.t >= q.total) {
            b.queue.shift();
            this.spawnFrom(b, q.type);
          }
        }
      } else {
        q.t += p.aegis ? q.total : dt;
        if (q.t >= q.total) { b.queue.shift(); p.research(q.id); this.sfx('research', b.x, b.y); }
      }
    }
    // arrows
    if (b.def.atk && b.owner) {
      b.attackCd -= dt;
      if (b.attackCd <= 0) {
        b.attackCd = b.def.reload;
        const range = b.def.range + p.mods.towerRange;
        const t = this.buildingTarget(b, range);
        if (t) {
          const extra = b.garrison.length ? b.garrison.filter(id => { const g = this.ents.get(id); return g && (g.isVillager || g.st.classes.includes('archer') || g.st.classes.includes('infantry')); }).length : 0;
          const arrows = b.def.arrows + (b.type === 'watchtower' ? Math.floor(extra / 2) : extra);
          const st = this.buildingAttackStats(b);
          for (let i = 0; i < arrows; i++) {
            const src = { x: b.x + (Math.random() - 0.5) * b.w * 0.6, y: b.y + (Math.random() - 0.5) * b.h * 0.6, owner: b.owner, id: b.id };
            this.fireProjectile(src, st, t, 'arrow', b.type === 'watchtower' ? 60 : b.type === 'castle' ? 70 : 50);
          }
        }
      }
    }
    // garrison healing
    if (b.garrison.length && this.tickN % 20 === 0) for (const id of b.garrison) { const g = this.ents.get(id); if (g && g.hp < g.st.hp) g.hp = Math.min(g.st.hp, g.hp + 1); }
  }

  buildingAttackStats(b) {
    const p = this.players[b.owner];
    const atk = b.def.atk + p.mods.towerAtk + (b.type === 'watchtower' ? p.mods.towerAtkT : 0);
    return { atk, atkType: 'pierce', bonus: { building: 0 }, accuracy: 0.9, splash: 0, ballistic: false };
  }

  buildingTarget(b, range) {
    const p = this.players[b.owner];
    const arr = this.hash.query(b.x, b.y, range + b.w / 2 + 1, this.tmp);
    let best = null, bd = 1e9;
    for (const v of arr) {
      if (v.dead || v.garrisonedIn) continue;
      if (v.owner === 0) {
        if (!(v.st.animal === 'predator' || (v.st.animal === 'boar' && v.order && v.order.type === 'attack'))) continue;
      } else if (!p.isEnemy(v.owner)) continue;
      const d = distToRect(v.x, v.y, b.x0, b.y0, b.x1, b.y1);
      if (d > range) continue;
      const s = d - (v.lastAttacker && this.ents.get(v.lastAttacker) && this.ents.get(v.lastAttacker).owner === b.owner ? 1 : 0) + (v.st.classes.includes('siege') && v.st.armor.p > 100 ? 20 : 0);
      if (s < bd) { bd = s; best = v; }
    }
    return best;
  }

  spawnFrom(b, type) {
    const p = this.players[b.owner];
    const rx = b.rally ? b.rally.x : b.x + b.w, ry = b.rally ? b.rally.y : b.y + b.h;
    let best = null, bd = 1e9;
    for (let y = b.ty - 1; y <= b.ty + b.h; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
      if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
      if (!this.inb(x, y) || !this.pf.passable(y * this.n + x, b.owner)) continue;
      const d = Math.hypot(x + 0.5 - rx, y + 0.5 - ry);
      if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
    }
    if (!best) best = this.freeSpotNear(b.x, b.y + b.h / 2 + 1, b.owner, 8) || [b.x, b.y + b.h / 2 + 0.6];
    const u = this.addUnit(type, b.owner, best[0], best[1]);
    p.pop += u.st.pop;
    p.st.trained++;
    if (b.rally) {
      const re = b.rally.ent && this.ents.get(b.rally.ent);
      if (re && !re.dead) this.commandTarget([u], re);
      else this.setOrder(u, { type: 'move', x: b.rally.x, y: b.rally.y });
    }
    this.emit('trained', u, b);
    return u;
  }

  // ------------------------------------------------------------------ population / visibility / victory
  updatePop() {
    for (const p of this.players) { p.pop = 0; p.popCap = 0; }
    for (const u of this.units) if (!u.dead) this.players[u.owner].pop += u.st.pop;
    for (const b of this.buildings) if (!b.dead && b.built && b.def.pop) this.players[b.owner].popCap += b.def.pop;
    for (const p of this.players) p.popCap = Math.min(MAX_POP, p.popCap);
  }

  updateVisibility() {
    const v = this.viewer;
    if (!v) return;
    const vis = this.vis, n = this.n;
    vis.fill(0);
    const vp = this.players[v];
    const stamp = (x, y, r) => {
      const off = discOffsets(r);
      const cx = Math.floor(x), cy = Math.floor(y);
      for (let i = 0; i < off.length; i += 2) {
        const tx = cx + off[i], ty = cy + off[i + 1];
        if (tx >= 0 && ty >= 0 && tx < n && ty < n) vis[ty * n + tx] = 1;
      }
    };
    for (const u of this.units) if (!u.dead && !u.garrisonedIn && u.owner && vp.isAlly(u.owner) && !(u.type === 'sheep' && false)) stamp(u.x, u.y, u.st.los);
    for (const b of this.buildings) if (!b.dead && vp.isAlly(b.owner)) stamp(b.x, b.y, b.built ? b.def.los + this.players[b.owner].mods.buildingLos + b.w / 2 : 2);
    const ex = this.explored;
    for (let i = 0; i < vis.length; i++) if (vis[i]) ex[i] = 1;
    for (const b of this.buildings) if (!b.seen && !b.dead && (this.reveal || vis[Math.floor(b.y) * n + Math.floor(b.x)] || vis[b.ty * n + b.tx])) b.seen = true;
  }

  isVisible(x, y) {
    if (!this.viewer || this.reveal === 'all') return true;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.n || ty >= this.n) return false;
    return this.vis[ty * this.n + tx] === 1;
  }
  isExplored(x, y) {
    if (!this.viewer) return true;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.n || ty >= this.n) return false;
    return this.explored[ty * this.n + tx] === 1;
  }

  checkVictory() {
    if (this.over) return;
    for (const p of this.players) {
      if (!p.id || !p.alive) continue;
      let has = false;
      for (const u of this.units) if (u.owner === p.id && !u.dead && !u.st.animal) { has = true; break; }
      if (!has) for (const b of this.buildings) if (b.owner === p.id && !b.dead && !b.def.wall && !b.def.gate && b.type !== 'farm') { has = true; break; }
      if (!has) this.defeat(p);
    }
    // wonder victory
    for (const b of this.buildings) {
      if (b.dead || b.type !== 'wonder' || !b.built) continue;
      const p = this.players[b.owner];
      if (!p.alive) continue;
      if (this.time - b.builtAt >= 300) { this.endGame(p.team, 'wonder'); return; }
    }
    const teams = new Set(this.players.filter(p => p.id && p.alive).map(p => p.team));
    if (teams.size <= 1) this.endGame(teams.size ? [...teams][0] : null, 'conquest');
  }

  defeat(p) {
    if (!p.alive) return;
    p.alive = false;
    p.defeatedAt = this.time;
    // remaining walls/farms crumble
    for (const b of this.buildings) if (b.owner === p.id && !b.dead) this.kill(b, null);
    for (const u of this.units) if (u.owner === p.id && !u.dead && u.type === 'sheep') { u.owner = 0; u.st = this.players[0].stats.sheep; }
    this.emit('defeated', p);
  }

  resign(pid) {
    const p = this.players[pid];
    for (const u of this.units) if (u.owner === pid && !u.dead && !u.st.animal) this.kill(u, null);
    for (const b of this.buildings) if (b.owner === pid && !b.dead) this.kill(b, null);
    this.defeat(p);
  }

  endGame(team, how) {
    if (this.over) return;
    this.over = true;
    this.winnerTeam = team;
    this.endHow = how;
    this.emit('gameover', team, how);
  }

  // ------------------------------------------------------------------ rules: building & training
  canBuildType(pid, type) {
    const p = this.players[pid], d = BUILDINGS[type];
    if (d.age > p.age) return { ok: false, why: `Requires ${AGES[d.age]}` };
    if (d.req && !p.hasBuilt(d.req)) return { ok: false, why: `Requires a ${BUILDINGS[d.req].name}` };
    return { ok: true };
  }

  canPlace(type, tx, ty, pid) {
    const d = BUILDINGS[type], s = d.size, n = this.n;
    const checkExplored = pid === this.viewer && !this.reveal;
    for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) return false;
      const i = y * n + x;
      if (this.occ[i]) return false;
      const tr = TERRAINS[this.terrain[i]];
      if (!tr.build) return false;
      if (checkExplored && !this.explored[i]) return false;
    }
    // don't build on top of enemy units
    const arr = this.hash.query(tx + s / 2, ty + s / 2, s, this.tmp2);
    for (const u of arr) {
      if (u.dead || u.garrisonedIn) continue;
      if (u.owner !== pid && u.owner !== 0 && u.x >= tx && u.x < tx + s && u.y >= ty && u.y < ty + s) return false;
    }
    return true;
  }

  canTrain(b, type) {
    const p = this.players[b.owner];
    const st = p.stats[type];
    if (!b.built) return { ok: false, why: 'Under construction' };
    if (st.age > p.age) return { ok: false, why: `Requires ${AGES[st.age]}` };
    if (b.queue.length >= 15) return { ok: false, why: 'Queue is full' };
    return { ok: true };
  }

  canResearch(b, id) {
    const p = this.players[b.owner];
    const t = TECHS[id];
    if (!t || t.at !== b.type) return { ok: false, hidden: true };
    if (t.civ && t.civ !== p.civId) return { ok: false, hidden: true };
    if (p.techs.has(id) || p.pending.has(id)) return { ok: false, hidden: true };
    if (t.req && !p.techs.has(t.req)) return { ok: false, hidden: true };
    if (t.ageUp) {
      if (p.age !== t.age) return { ok: false, hidden: true };
      if ([...p.pending].some(x => TECHS[x].ageUp)) return { ok: false, hidden: true };
      if (!p.ageReqMet(t.ageUp)) {
        const r = AGE_REQ[t.ageUp];
        return { ok: false, why: `Requires ${r.count} of: ${[...new Set(r.from)].map(x => BUILDINGS[x].name).join(', ')}` };
      }
    } else if (t.age > p.age) return { ok: false, why: `Requires ${AGES[t.age]}` };
    if (!b.built) return { ok: false, why: 'Under construction' };
    return { ok: true };
  }

  // ------------------------------------------------------------------ COMMANDS (shared by UI and AI)
  commandMove(units, x, y, queue = false, attackMove = false) {
    units = units.filter(u => !u.dead && !u.garrisonedIn);
    if (!units.length) return;
    x = clamp(x, 0.3, this.n - 0.3); y = clamp(y, 0.3, this.n - 0.3);
    if (units.length === 1) { this.setOrder(units[0], { type: 'move', x, y, attackMove }, queue); return; }
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= units.length; cy /= units.length;
    let dx = x - cx, dy = y - cy;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const px = -dy, py = dx;
    const sorted = units.slice().sort((a, b) => this.formRank(a) - this.formRank(b));
    const cols = Math.max(1, Math.ceil(Math.sqrt(units.length * 2)));
    const sp = 0.85;
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const rowCount = Math.min(cols, sorted.length - r * cols);
      const ox = px * (c - (rowCount - 1) / 2) * sp - dx * r * sp;
      const oy = py * (c - (rowCount - 1) / 2) * sp - dy * r * sp;
      let tx = x + ox, ty = y + oy;
      if (!this.passableXY(tx, ty, u.owner)) { tx = x; ty = y; }
      this.setOrder(u, { type: 'move', x: tx, y: ty, attackMove }, queue);
    });
  }
  formRank(u) {
    const c = u.st.classes;
    if (c.includes('siege')) return 4;
    if (u.st.monk) return 3;
    if (c.includes('archer')) return 2;
    if (c.includes('cavalry')) return 0;
    return 1;
  }

  // "Smart" right-click on an entity
  commandTarget(units, e, queue = false) {
    for (const u of units) {
      if (u.dead || u.garrisonedIn) continue;
      const p = this.players[u.owner];
      let order = null;
      if (e.kind === 'resource') {
        if (u.isVillager) order = { type: 'gather', target: e.id };
      } else if (e.kind === 'building') {
        if (p.isAlly(e.owner)) {
          if (u.isVillager && e.owner === u.owner) {
            if (!e.built || (e.hp < e.maxHp && e.type !== 'farm')) order = { type: e.built ? 'repair' : 'build', target: e.id };
            else if (e.type === 'farm') order = { type: 'gather', target: e.id };
            else if (u.carry > 0 && e.def.drop && e.def.drop.includes(u.carryType)) order = { type: 'dropoff', dropId: e.id };
          } else if (e.def.garrison && u.st.garrisonable && e.built) order = { type: 'garrison', target: e.id };
        } else if (e.owner !== 0 && this.canAttack(u, e)) order = { type: 'attack', target: e.id };
        if (u.st.monk) order = null;
      } else if (e.kind === 'unit') {
        if (u.st.monk) {
          if (p.isEnemy(e.owner) && e.owner !== 0) order = { type: 'convert', target: e.id };
          else if (p.isAlly(e.owner) && e.hp < e.st.hp) order = { type: 'heal', target: e.id };
        } else if (e.st.animal && e.st.food && u.isVillager && (e.owner === 0 || e.owner === u.owner)) {
          order = { type: 'gather', target: e.id };
        } else if (e.owner === 0 ? (e.st.animal !== 'herd') : p.isEnemy(e.owner)) {
          if (this.canAttack(u, e)) order = { type: 'attack', target: e.id, force: e.owner === 0 };
        } else if (e !== u) {
          order = { type: 'move', x: e.x, y: e.y, follow: e.owner === u.owner && !e.st.animal ? e.id : 0 };
        }
      }
      if (!order) order = { type: 'move', x: e.x, y: e.y };
      this.setOrder(u, order, queue);
    }
  }

  commandStop(units) { for (const u of units) { u.queue.length = 0; u.order = null; u.path = null; u.pathPending = false; } }

  commandStance(units, s) { for (const u of units) if (!u.isVillager) u.stance = s; }

  // Place a foundation and send villagers to build it
  commandBuild(vills, type, tx, ty, queue = false, silent = false, noResume = false) {
    const pid = vills.length ? vills[0].owner : 0;
    const p = this.players[pid];
    const can = this.canBuildType(pid, type);
    if (!can.ok) { if (!silent) this.notify(pid, can.why, 'warn'); return null; }
    if (!this.canPlace(type, tx, ty, pid)) { if (!silent) this.notify(pid, 'Cannot build there.', 'warn'); return null; }
    const cost = p.buildingCost(type);
    if (!p.canAfford(cost)) { if (!silent) this.emit('cantAfford', pid, p.missing(cost)); return null; }
    p.pay(cost);
    const b = this.addBuilding(type, pid, tx, ty, false);
    b.cost = cost;
    if (!BUILDINGS[type].walkable) this.pushOutUnits(b);
    for (const u of vills) {
      if (!u.isVillager || u.dead) continue;
      // remember what the villager was gathering so it returns to work afterwards
      const prev = !queue && !noResume && u.order && u.order.type === 'gather' ? { type: 'gather', target: u.order.target, kind: u.order.kind, lx: u.order.lx, ly: u.order.ly } : null;
      this.setOrder(u, { type: 'build', target: b.id }, queue);
      if (prev && b.type !== 'farm' && !BUILDINGS[type].drop) u.queue.push(prev);
    }
    this.emit('placed', b);
    return b;
  }

  // Walls: a 4-connected line of single tiles
  lineTiles(ax, ay, bx, by) {
    // 4-connected Bresenham so wall segments always touch edge-to-edge
    const out = [[ax, ay]];
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    let err = dx + dy, x = ax, y = ay, guard = 0;
    while ((x !== bx || y !== by) && guard++ < 400) {
      const e2 = 2 * err;
      if (e2 - dy > dx - e2) { err += dy; x += sx; } else { err += dx; y += sy; }
      out.push([x, y]);
    }
    return out;
  }

  commandBuildLine(vills, type, ax, ay, bx, by, queue = false) {
    const tiles = this.lineTiles(ax, ay, bx, by);
    const prev = new Map(vills.map(u => [u, !queue && u.order && u.order.type === 'gather' ? { type: 'gather', target: u.order.target, kind: u.order.kind, lx: u.order.lx, ly: u.order.ly } : null]));
    let first = true, placed = 0;
    for (const [x, y] of tiles) {
      if (!this.canPlace(type, x, y, vills[0].owner)) continue;
      const b = this.commandBuild(vills, type, x, y, queue || !first, true, true);
      if (!b) { if (placed === 0) this.commandBuild(vills, type, x, y, queue, false, true); break; }
      first = false; placed++;
    }
    if (placed) for (const [u, o] of prev) if (o) u.queue.push(o);
    return placed;
  }

  commandTrain(b, type, count = 1) {
    const p = this.players[b.owner];
    type = p.resolve(type);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const can = this.canTrain(b, type);
      if (!can.ok) { if (n === 0) this.notify(b.owner, can.why, 'warn'); break; }
      const cost = p.unitCost(type);
      if (!p.canAfford(cost)) { if (n === 0) this.emit('cantAfford', b.owner, p.missing(cost)); break; }
      p.pay(cost);
      b.queue.push({ kind: 'unit', type, t: 0, total: UNITS[type].time, cost });
      n++;
    }
    return n;
  }

  commandResearch(b, id) {
    const p = this.players[b.owner];
    const can = this.canResearch(b, id);
    if (!can.ok) { if (can.why) this.notify(b.owner, can.why, 'warn'); return false; }
    const cost = p.techCost(id);
    if (!p.canAfford(cost)) { this.emit('cantAfford', b.owner, p.missing(cost)); return false; }
    p.pay(cost);
    p.pending.add(id);
    b.queue.push({ kind: 'tech', id, t: 0, total: TECHS[id].time, cost });
    return true;
  }

  commandCancel(b, idx) {
    const q = b.queue[idx];
    if (!q) return;
    b.queue.splice(idx, 1);
    const p = this.players[b.owner];
    p.refund(q.cost);
    if (q.kind === 'tech') p.pending.delete(q.id);
  }

  commandRally(b, x, y, ent) { b.rally = { x, y, ent: ent ? ent.id : 0 }; }

  commandDelete(ents) {
    for (const e of ents) {
      if (e.dead || e.owner === 0) continue;
      if (e.kind === 'building') {
        if (!e.built && e.progress === 0 && e.cost) this.players[e.owner].refund(e.cost);
        for (const q of e.queue) { this.players[e.owner].refund(q.cost); if (q.kind === 'tech') this.players[e.owner].pending.delete(q.id); }
        e.queue.length = 0;
      }
      this.kill(e, null);
    }
  }

  commandUngarrison(b) { this.ejectGarrison(b); }

  commandGarrison(units, b) { for (const u of units) if (u.st.garrisonable) this.setOrder(u, { type: 'garrison', target: b.id }); }

  commandRingBell(pid) {
    const shelters = this.buildings.filter(b => b.owner === pid && !b.dead && b.built && b.def.garrison && b.type !== 'barracks' && b.type !== 'archeryrange' && b.type !== 'stable' && b.type !== 'monastery');
    const room = new Map(shelters.map(b => [b.id, b.def.garrison - b.garrison.length]));
    for (const u of this.units) {
      if (u.dead || u.owner !== pid || !u.isVillager || u.garrisonedIn) continue;
      let best = null, bd = 30;
      for (const b of shelters) {
        if (room.get(b.id) <= 0) continue;
        const d = Math.hypot(b.x - u.x, b.y - u.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) continue;
      room.set(best.id, room.get(best.id) - 1);
      const prev = u.order && u.order.type !== 'garrison' ? { ...u.order, pathed: false, started: false } : null;
      this.setOrder(u, { type: 'garrison', target: best.id });
      u.bellOrder = prev;
    }
    this.players[pid].bellRung = true;
    this.sfx('bell', 0, 0);
  }

  commandAllClear(pid) {
    for (const b of this.buildings) if (b.owner === pid && !b.dead && b.garrison.length) {
      const vils = b.garrison.filter(id => { const u = this.ents.get(id); return u && u.isVillager; });
      if (!vils.length) continue;
      const keep = b.garrison.filter(id => !vils.includes(id));
      b.garrison = vils;
      const rally = b.rally; b.rally = null;
      this.ejectGarrison(b);
      b.rally = rally;
      b.garrison = keep;
    }
    for (const u of this.units) if (u.owner === pid && u.bellOrder && !u.garrisonedIn) {
      if (u.order && u.order.type === 'garrison') { u.order = u.bellOrder; u.order.pathed = false; }
      u.bellOrder = null;
    }
    this.players[pid].bellRung = false;
  }

  // ------------------------------------------------------------------ cheat codes (AoE II classics + a few extras)
  cheat(pid, text) {
    const p = this.players[pid];
    const code = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    const give = (r, n) => { p.res[r] += n; return `+${n} ${r}`; };
    const tc = this.buildings.find(b => b.owner === pid && b.type === 'towncenter' && !b.dead);
    const spawnNear = (type, n = 1) => {
      const at = tc || this.units.find(u => u.owner === pid && !u.dead) || { x: this.starts[pid].x, y: this.starts[pid].y, w: 4, h: 4 };
      const out = [];
      for (let i = 0; i < n; i++) {
        const spot = this.freeSpotNear(at.x + 3 + (i % 3), at.y + 3 + Math.floor(i / 3), pid, 8);
        if (spot) out.push(this.addUnit(type, pid, spot[0], spot[1]));
      }
      this.updatePop();
      return out;
    };
    let msg = null;
    const torp = code.match(/^torpedo ?([1-8])$/);
    switch (code) {
      case 'cheese steak jerky': msg = give('food', 1000); break;
      case 'lumberjack': msg = give('wood', 1000); break;
      case 'robin hood': msg = give('gold', 1000); break;
      case 'rock on': msg = give('stone', 1000); break;
      case 'ninjalui': for (const r of RES) p.res[r] += 100000; msg = '+100,000 of everything'; break;
      case 'marco': this.explored.fill(1); msg = 'Map revealed'; break;
      case 'polo': this.reveal = this.reveal === 'all' ? false : 'all'; if (this.reveal) this.explored.fill(1); msg = this.reveal ? 'Fog of war removed' : 'Fog of war restored'; break;
      case 'aegis': p.aegis = !p.aegis; p.mods.gather = p.aegis ? Object.fromEntries(Object.entries(p.mods.gather).map(([k, v]) => [k, v * 25])) : Object.fromEntries(Object.entries(p.mods.gather).map(([k, v]) => [k, v / 25])); msg = p.aegis ? 'Instant building, training, research and super-fast gathering' : 'Aegis off'; break;
      case 'how do you turn this on': spawnNear('cobracar'); msg = 'Cobra Car delivered'; break;
      case 'big army': spawnNear(p.resolve('knight'), 6); spawnNear(p.resolve('archer'), 6); msg = 'An army appears'; break;
      case 'to the future': {
        const next = ['feudal', 'castle', 'imperial'][p.age];
        if (next) { p.research(next); msg = `Advanced to the ${AGES[p.age]}`; } else msg = 'Already in the Imperial Age';
        break;
      }
      case 'natural wonders': {
        let n = 0;
        for (const u of this.units) if (!u.dead && u.owner === 0 && u.st.animal) { u.owner = pid; u.st = p.stats[u.type]; u.order = null; n++; }
        msg = `You now command ${n} animals`; break;
      }
      case 'black death':
        for (const q of this.players) if (q.id && q.alive && p.isEnemy(q.id)) this.resign(q.id);
        msg = 'Plague sweeps your enemies away'; break;
      case 'i r winner': this.endGame(p.team, 'conquest'); msg = 'Victory!'; break;
      case 'wimpywimpywimpy': this.resign(pid); msg = 'You gave up'; break;
      default:
        if (torp) {
          const q = this.players[+torp[1]];
          if (q && q.id !== pid && q.alive) { this.resign(q.id); msg = `${q.name} torpedoed`; } else msg = 'No such opponent';
        }
    }
    if (msg) { p.usedCheats = true; this.sfx('research', 0, 0); }
    return msg;
  }

  marketPrice(res, buy) { return Math.max(20, Math.round(this.market[res] * (buy ? 1.3 : 0.7))); }

  commandMarket(pid, action, res, amount = 100) {
    const p = this.players[pid];
    if (action === 'buy') {
      const price = this.marketPrice(res, true);
      if (p.res.gold < price) { this.emit('cantAfford', pid, ['gold']); return false; }
      p.res.gold -= price; p.res[res] += amount;
      this.market[res] = Math.min(9999, this.market[res] + 5);
    } else {
      if (p.res[res] < amount) { this.emit('cantAfford', pid, [res]); return false; }
      p.res[res] -= amount; p.res.gold += this.marketPrice(res, false);
      this.market[res] = Math.max(20, this.market[res] - 5);
    }
    this.sfx('coin', 0, 0);
    return true;
  }
}
