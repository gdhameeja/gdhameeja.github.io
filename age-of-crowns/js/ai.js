'use strict';
// ============================================================================
//  Computer opponent. A rule-based planner that runs a few times per second:
//  economy (villagers, drop sites, farms, houses), build order, ages, techs,
//  army composition with counters, defence (incl. town bell) and attack waves.
// ============================================================================

const AI_DIFF = {
  easy:   { think: 1.6, vilTarget: 30, gather: 0.9,  firstAttack: 960, armyMin: 10, armyGrow: 3, maxArmy: 35, counters: false, bell: false, towers: false, castle: false, feudalVils: 18, castleVils: 28, impVils: 30, hunt: false, market: false, wonder: false, techRate: 0.5, extraTC: false },
  normal: { think: 0.9, vilTarget: 55, gather: 1.0,  firstAttack: 700, armyMin: 10, armyGrow: 5, maxArmy: 70, counters: true,  bell: true,  towers: false, castle: true,  feudalVils: 21, castleVils: 30, impVils: 42, hunt: false, market: true,  wonder: false, techRate: 1, extraTC: false },
  hard:   { think: 0.5, vilTarget: 80, gather: 1.12, firstAttack: 520, armyMin: 8,  armyGrow: 6, maxArmy: 110, counters: true, bell: true,  towers: true,  castle: true,  feudalVils: 22, castleVils: 30, impVils: 45, hunt: true, market: true,  wonder: true,  techRate: 1, extraTC: true },
};

// unit preferences per civ: [trainSlot, weight, minAge]
const AI_COMP = {
  britons:    [['archer', 5, 1], ['spearman', 2, 1], ['militia', 1, 1], ['UNIQUE', 6, 2], ['knight', 1, 2], ['mangonel', 0.5, 2]],
  franks:     [['knight', 6, 2], ['scoutcavalry', 3, 1], ['militia', 2, 1], ['UNIQUE', 4, 2], ['archer', 1, 1], ['spearman', 1, 1]],
  mongols:    [['cavalryarcher', 6, 2], ['scoutcavalry', 3, 1], ['archer', 2, 1], ['UNIQUE', 5, 2], ['spearman', 1, 1], ['mangonel', 1, 2]],
  byzantines: [['spearman', 2, 1], ['skirmisher', 2, 1], ['archer', 3, 1], ['UNIQUE', 5, 2], ['knight', 2, 2], ['militia', 1, 1]],
};

const AI_ECO_TECHS = [
  ['loom', 0], ['doublebitaxe', 0], ['horsecollar', 1], ['wheelbarrow', 1], ['bowsaw', 1], ['goldmining', 1],
  ['heavyplow', 2], ['handcart', 2], ['goldshaft', 2], ['stonemining', 2], ['croprotation', 3], ['twomansaw', 3], ['townwatch', 1],
];

class AI {
  constructor(game, player) {
    this.g = game;
    this.p = player;
    this.d = AI_DIFF[player.difficulty] || AI_DIFF.normal;
    this.p.mods.aiGather = this.d.gather;
    this.timer = Math.random() * this.d.think;
    this.attackers = new Set();
    this.waves = 0;
    this.nextAttack = this.d.firstAttack + Math.random() * 60;
    this.lastThreatT = -99;
    this.bell = false;
    this.rebalanceT = 0;
    this.slowT = 0;
    this.started = false;
    this.reserve = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.comp = AI_COMP[player.civId] || AI_COMP.britons;
    this.attackTarget = null;
    this.retreating = false;
  }

  update(dt) {
    if (!this.p.alive || this.g.over) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.d.think;
    this.think();
  }

  // ------------------------------------------------------------------ bookkeeping
  scan() {
    const g = this.g, pid = this.p.id;
    this.vils = []; this.mil = []; this.sheep = [];
    this.bs = {}; this.foundations = 0; this.houseFound = 0;
    for (const u of g.units) {
      if (u.dead || u.owner !== pid) continue;
      if (u.isVillager) this.vils.push(u);
      else if (u.type === 'sheep') this.sheep.push(u);
      else if (!u.st.animal) this.mil.push(u);
    }
    for (const b of g.buildings) {
      if (b.dead || b.owner !== pid) continue;
      (this.bs[b.type] || (this.bs[b.type] = [])).push(b);
      if (!b.built && b.type !== 'farm') { if (b.type === 'house') this.houseFound++; else this.foundations++; }
    }
    const tcs = this.bs.towncenter || [];
    const tc = tcs.find(b => b.built) || tcs[0];
    if (tc) { this.base = { x: tc.x, y: tc.y }; this.tc = tc; }
    else if (!this.base) { const s = g.starts[pid]; this.base = { x: s.x, y: s.y }; this.tc = null; }
    else this.tc = null;
  }
  count(type) { return (this.bs[type] || []).length; }
  built(type) { return (this.bs[type] || []).filter(b => b.built).length; }

  afford(cost, ignoreReserve = false) {
    const r = this.p.res;
    for (const k of RES) if ((cost[k] || 0) > r[k] - (ignoreReserve ? 0 : this.reserve[k])) return false;
    return true;
  }

  think() {
    const g = this.g;
    this.siteCache = {};
    this.scan();
    if (!this.started) { this.opening(); this.started = true; }
    if (!this.vils.length && !this.tc && this.mil.length < 3 && g.time > 60) { g.resign(this.p.id); g.notify(0, `${this.p.name} resigned.`, 'info'); return; }
    this.computeReserve();
    this.defend();
    this.boarLure();
    this.trainVillagers();
    this.housing();
    this.assignVillagers();
    this.manageBuilders();
    this.dropSites();
    this.buildPlan();
    this.ageUp();
    this.research();
    this.trainArmy();
    this.attack();
    this.useMarket();
  }

  opening() {
    const g = this.g;
    // herd sheep under the town center
    if (this.tc) {
      this.sheep.forEach((s, i) => g.setOrder(s, { type: 'move', x: this.tc.x + 2.6 + (i % 2) * 0.6, y: this.tc.y + 2.6 + Math.floor(i / 2) * 0.6 }));
    }
    // scout circles the base
    const scout = this.mil.find(u => u.type === 'scoutcavalry');
    if (scout && this.base) {
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, r = k < 5 ? 14 : 22;
        pts.push([clamp(this.base.x + Math.cos(a) * r, 1, g.n - 2), clamp(this.base.y + Math.sin(a) * r, 1, g.n - 2)]);
      }
      pts.forEach((pt, i) => g.setOrder(scout, { type: 'move', x: pt[0], y: pt[1] }, i > 0));
    }
  }

  computeReserve() {
    this.reserve = { food: 0, wood: 0, gold: 0, stone: 0 };
    const p = this.p;
    const next = ['feudal', 'castle', 'imperial'][p.age];
    if (!next || [...p.pending].some(t => TECHS[t].ageUp)) return;
    const need = [this.d.feudalVils, this.d.castleVils, this.d.impVils][p.age];
    if (this.vils.length >= need - 2 && p.ageReqMet(p.age + 1)) Object.assign(this.reserve, p.techCost(next));
    if (p.age >= 2 && this.d.castle && !this.count('castle') && p.res.stone >= 400) this.reserve.stone = Math.max(this.reserve.stone, 650);
  }

  // ------------------------------------------------------------------ economy
  trainVillagers() {
    const p = this.p;
    const tcs = (this.bs.towncenter || []).filter(b => b.built);
    let queued = 0;
    for (const tc of tcs) queued += tc.queue.filter(q => q.kind === 'unit').length;
    const total = this.vils.length + queued;
    const next = ['feudal', 'castle', 'imperial'][p.age];
    const ageNeed = [this.d.feudalVils, this.d.castleVils, this.d.impVils, 999][p.age];
    const waitingForAge = next && total >= ageNeed && !p.pending.has(next) && p.age < 3 && p.ageReqMet(p.age + 1) && !p.canAfford(p.techCost(next));
    const target = Math.min(this.d.vilTarget, MAX_POP - Math.min(60, this.mil.length));
    if (total >= target || waitingForAge) return;
    for (const tc of tcs) {
      if (tc.queue.length >= 2) continue;
      if (p.res.food < 50) break;
      g_train(this.g, tc, 'villager');
    }
  }

  housing() {
    const p = this.p;
    if (p.popCap >= MAX_POP) return;
    const prod = this.count('barracks') + this.count('archeryrange') + this.count('stable') + this.count('towncenter') + this.count('castle');
    const margin = 4 + prod * 1.5;
    const maxConcurrent = p.age >= 2 ? 3 : p.age >= 1 ? 2 : 1;
    if (p.pop + margin >= p.popCap && this.houseFound < maxConcurrent && p.res.wood >= 25) {
      this.place('house', this.base, 6, 18, 1);
    }
  }

  // desired villager distribution
  ratios() {
    const a = this.p.age;
    let r;
    if (a === 0) r = { food: 0.62, wood: 0.38, gold: 0, stone: 0 };
    else if (a === 1) r = { food: 0.5, wood: 0.34, gold: 0.14, stone: 0.02 };
    else if (a === 2) r = { food: 0.4, wood: 0.26, gold: 0.27, stone: 0.07 };
    else r = { food: 0.36, wood: 0.26, gold: 0.3, stone: 0.08 };
    if (a === 0 && this.p.pending.has('feudal')) r = { food: 0.45, wood: 0.4, gold: 0.15, stone: 0 };
    if (a === 1 && this.p.pending.has('castle')) r = { food: 0.4, wood: 0.3, gold: 0.25, stone: 0.05 };
    if (a >= 2 && this.d.castle && !this.count('castle') && this.p.res.stone < 650) { r.stone += 0.06; r.wood -= 0.06; }
    // react to stockpiles: shift workers away from what is piling up
    const res = this.p.res;
    for (const k of RES) {
      const pile = res[k] - this.reserve[k];
      if (pile > 900) r[k] *= 0.4; else if (pile > 500) r[k] *= 0.7;
      else if (pile < 80 && r[k] > 0) r[k] *= 1.35;
    }
    const sum = RES.reduce((s, k) => s + r[k], 0) || 1;
    for (const k of RES) r[k] /= sum;
    return r;
  }

  vilRes(u) {
    const o = u.order;
    if (!o) return null;
    if (o.type === 'gather') return o.kind ? KIND_RES[o.kind] : (this.g.gatherKind(this.g.ents.get(o.target)) ? KIND_RES[this.g.gatherKind(this.g.ents.get(o.target))] : null);
    if (o.type === 'build' || o.type === 'repair') return 'build';
    if (o.type === 'dropoff') return u.carryType;
    if (o.type === 'garrison') return 'garrison';
    return null;
  }

  assignVillagers() {
    const g = this.g;
    if (this.bell) return;
    const cnt = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle = [];
    for (const u of this.vils) {
      if (u.garrisonedIn) continue;
      const r = this.vilRes(u);
      if (r && cnt[r] != null) cnt[r]++;
      else if (!r && (!u.order || u.order.type === 'move')) { if (!u.order) idle.push(u); }
    }
    const total = this.vils.length;
    const ratio = this.ratios();
    if (idle.length > 8) idle.length = 8;   // spread the work over several thinks
    for (const u of idle) {
      let best = null, bd = -1e9;
      for (const r of RES) {
        const def = ratio[r] * total - cnt[r];
        if (def > bd) { bd = def; best = r; }
      }
      if (this.sendTo(u, best)) cnt[best]++;
      else {
        for (const r of ['wood', 'food', 'gold', 'stone']) if (r !== best && this.sendTo(u, r)) { cnt[r]++; break; }
      }
    }
    // gentle rebalancing
    this.rebalanceT -= this.d.think;
    if (this.rebalanceT <= 0) {
      this.rebalanceT = 20;
      let over = null, under = null, ov = 1.5, un = 1.5;
      for (const r of RES) {
        const diff = cnt[r] - ratio[r] * total;
        if (diff > ov) { ov = diff; over = r; }
        if (-diff > un) { un = -diff; under = r; }
      }
      if (over && under) {
        const movers = this.vils.filter(u => this.vilRes(u) === over && u.carry < 3).slice(0, Math.min(3, Math.floor(Math.min(ov, un))));
        for (const u of movers) { g.commandStop([u]); this.sendTo(u, under); }
      }
    }
  }

  sendTo(u, res) {
    const g = this.g;
    if (res === 'food') return this.sendFood(u);
    const kind = res;
    const dropType = res === 'wood' ? 'lumbercamp' : 'miningcamp';
    const drops = [...(this.bs[dropType] || []), ...(this.bs.towncenter || [])].filter(b => b.built);
    let best = null, bd = 1e9;
    for (const d of drops) {
      const r = g.findResourceNear(d.x, d.y, kind, d.type === 'towncenter' ? 7 : 8, this.p.id, u.id);
      if (!r) continue;
      const dd = Math.hypot(r.x - d.x, r.y - d.y) + Math.hypot(r.x - u.x, r.y - u.y) * 0.15;
      if (dd < bd) { bd = dd; best = r; }
    }
    if (best) { g.setOrder(u, { type: 'gather', target: best.id }); return true; }
    // no reachable resource near a drop site: build a new camp
    const pending = (this.bs[dropType] || []).find(b => !b.built);
    if (pending) { g.setOrder(u, { type: 'build', target: pending.id }); return true; }
    const spot = this.findResourceSite(kind);
    if (!spot) return false;
    if (!this.afford(this.p.buildingCost(dropType), true)) {
      // gather without a camp (walk to the TC)
      const r = g.findResourceNear(spot.x, spot.y, kind, 4, this.p.id, u.id);
      if (r) { g.setOrder(u, { type: 'gather', target: r.id }); return true; }
      return false;
    }
    const b = this.placeNear(dropType, spot.x, spot.y, [u]);
    if (b) {
      const r = g.findResourceNear(spot.x, spot.y, kind, 6, this.p.id, u.id);
      if (r) g.setOrder(u, { type: 'gather', target: r.id }, true);
      return true;
    }
    return false;
  }

  sendFood(u) {
    const g = this.g, pid = this.p.id;
    const tc = this.tc;
    // own sheep first: only harvest sheep that have been herded to the town center
    if (this.sheep.length && tc) {
      const carcass = g.findResourceNear(tc.x, tc.y, 'sheep', 6, pid, u.id);
      if (carcass && carcass.kind === 'resource') { g.setOrder(u, { type: 'gather', target: carcass.id }); return true; }
      let s = null, bd = 1e9;
      for (const sh of this.sheep) {
        const d = Math.hypot(sh.x - tc.x, sh.y - tc.y);
        if (d > 5.5) { if (!sh.order) g.setOrder(sh, { type: 'move', x: tc.x + 2.4 + Math.random(), y: tc.y + 2.4 + Math.random() }); continue; }
        if (d < bd) { bd = d; s = sh; }
      }
      if (s) { g.setOrder(u, { type: 'gather', target: s.id }); return true; }
    }
    // hunt carcasses / deer
    const carcass = g.findResourceNear(u.x, u.y, 'hunt', 20, pid, u.id);
    if (carcass && carcass.kind === 'resource') { g.setOrder(u, { type: 'gather', target: carcass.id }); return true; }
    if (this.d.hunt && tc) {
      const deer = g.findResourceNear(tc.x, tc.y, 'hunt', 11, pid, u.id);
      if (deer) { g.setOrder(u, { type: 'gather', target: deer.id }); return true; }
    }
    // berries near a drop site
    const drops = [...(this.bs.mill || []), ...(this.bs.towncenter || [])].filter(b => b.built);
    for (const d of drops) {
      const b = g.findResourceNear(d.x, d.y, 'forage', 8, pid, u.id);
      if (b) { g.setOrder(u, { type: 'gather', target: b.id }); return true; }
    }
    // berries further away -> build a mill there
    if (tc && !(this.bs.mill || []).some(m => !m.built)) {
      const bush = g.findResourceNear(tc.x, tc.y, 'forage', 24, pid, u.id);
      if (bush && this.afford({ wood: 100 }, true)) {
        const m = this.placeNear('mill', bush.x, bush.y, [u]);
        if (m) { g.setOrder(u, { type: 'gather', target: bush.id }, true); return true; }
      }
    }
    // free farm
    const farm = g.findResourceNear(u.x, u.y, 'farm', 40, pid, u.id);
    if (farm) { g.setOrder(u, { type: 'gather', target: farm.id }); return true; }
    // need a mill before farms
    if (!this.count('mill')) {
      if (this.afford({ wood: 100 }, true) && tc) return !!this.place('mill', this.base, 6, 12, 1, [u]);
      return false;
    }
    if (!this.afford(this.p.buildingCost('farm'), true)) return false;
    const anchors = [...(this.bs.towncenter || []), ...(this.bs.mill || [])].filter(b => b.built);
    for (const a of anchors) {
      const f = this.place('farm', a, a.w / 2 + 1, a.w / 2 + 5, 0, [u]);
      if (f) return true;
    }
    return false;
  }

  // find a good spot to exploit a resource kind (densest cluster near base)
  findResourceSite(kind) {
    if (this.siteCache && kind in this.siteCache) return this.siteCache[kind];
    const r = this.findResourceSiteRaw(kind);
    if (this.siteCache) this.siteCache[kind] = r;
    return r;
  }
  findResourceSiteRaw(kind) {
    const g = this.g, n = g.n;
    const want = kind === 'wood' ? 'tree' : kind;
    const bx = this.base.x, by = this.base.y;
    let best = null, bs = -1e9;
    const R = 40;
    for (const r of g.resources) {
      if (r.dead || r.type !== want) continue;
      const d = Math.hypot(r.x - bx, r.y - by);
      if (d > R || d < 5) continue;
      if (want === 'tree' && hash2(r.tx, r.ty, 3) > 0.25) continue; // sample trees
      if (!g.hasOpenSide(r.tx, r.ty)) continue;
      let dens = 0;
      if (want === 'tree') {
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const x = r.tx + dx, y = r.ty + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const e = g.ents.get(g.occ[y * n + x]);
          if (e && e.type === 'tree') dens++;
        }
      } else dens = 12;
      // avoid spots near enemies
      let danger = 0;
      for (let q = 1; q < g.players.length; q++) if (this.p.isEnemy(q) && g.starts[q] && Math.hypot(g.starts[q].x - r.x, g.starts[q].y - r.y) < 22) danger = 50;
      const s = Math.min(dens, 25) * 1.2 - d - danger;
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }

  // Lure a wild boar back to the Town Center so its 340 food is harvested
  // next to the drop site (TC arrows help finish it off).
  boarLure() {
    const g = this.g, tc = this.tc;
    if (!tc || !tc.built || this.d === AI_DIFF.easy || this.bell) return;
    const L = this.lure;
    if (L) {
      const v = g.ents.get(L.vil), b = g.ents.get(L.boar);
      if (!b || b.dead) { this.lure = null; return; }
      if (!v || v.dead) {
        // send help: whoever is closest goes to fight it
        const help = this.vils.filter(u => !u.garrisonedIn).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y)).slice(0, 4);
        for (const u of help) g.setOrder(u, { type: 'gather', target: b.id });
        this.lure = null; return;
      }
      const dTC = Math.hypot(b.x - tc.x, b.y - tc.y);
      if (L.phase === 'go' && b.order && b.order.type === 'attack' && b.order.target === v.id) {
        L.phase = 'run';
        g.setOrder(v, { type: 'move', x: tc.x + 2.6, y: tc.y + 2.6 });
      } else if (L.phase === 'run' && dTC < 5) {
        L.phase = 'kill';
        const help = this.vils.filter(u => u !== v && !u.garrisonedIn && this.vilRes(u) === 'food').sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y)).slice(0, 4);
        for (const u of [v, ...help]) g.setOrder(u, { type: 'gather', target: b.id });
      } else if (L.phase === 'run' && !v.order) g.setOrder(v, { type: 'move', x: tc.x + 2.6, y: tc.y + 2.6 });
      if (g.time - L.t0 > 70) { if (L.phase !== 'kill') g.setOrder(v, { type: 'gather', target: b.id }); this.lure = null; }
      return;
    }
    // start a lure when the sheep are nearly gone
    if (this.vils.length < 7 || this.sheep.length > 1) return;
    if (g.carcasses.some(r => !r.dead && r.animal === 'boar' && Math.hypot(r.x - tc.x, r.y - tc.y) < 8)) return;
    let boar = null, bd = 20;
    for (const u of g.units) {
      if (u.dead || u.type !== 'boar' || u.order) continue;
      const d = Math.hypot(u.x - tc.x, u.y - tc.y);
      if (d < bd) { bd = d; boar = u; }
    }
    if (!boar) return;
    const v = this.vils.filter(u => !u.garrisonedIn && u.hp >= u.st.hp * 0.9 && this.vilRes(u) === 'food').sort((a, c) => Math.hypot(a.x - boar.x, a.y - boar.y) - Math.hypot(c.x - boar.x, c.y - boar.y))[0];
    if (!v) return;
    g.setOrder(v, { type: 'gather', target: boar.id });
    this.lure = { vil: v.id, boar: boar.id, phase: 'go', t0: g.time };
  }

  // Proactively build lumber camps, mining camps and mills next to the
  // resources villagers are working, so they don't walk back to the TC.
  dropSites() {
    const g = this.g, p = this.p;
    if (this.foundations >= 2 || !this.tc) return;
    const v = this.vils.length;
    const far = { wood: [], gold: [], stone: [], forage: [] };
    for (const u of this.vils) {
      const o = u.order;
      if (!o || o.type !== 'gather' || !far[o.kind]) continue;
      const t = g.ents.get(o.target);
      if (!t || t.dead) continue;
      const res = KIND_RES[o.kind];
      let bd = 1e9;
      for (const b of g.buildings) if (!b.dead && b.owner === p.id && b.def.drop && b.def.drop.includes(res)) bd = Math.min(bd, distToRect(t.x, t.y, b.x0, b.y0, b.x1, b.y1));
      if (bd > 5.5) far[o.kind].push(t);
    }
    const tryCamp = (type, kind, list, minN) => {
      if (list.length < minN || (this.bs[type] || []).some(b => !b.built)) return false;
      if (!this.afford(p.buildingCost(type), true)) return false;
      const t = list[0];
      const builder = this.vils.filter(u => u.order && u.order.kind === kind).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
      if (!builder) return false;
      const b = this.placeNear(type, t.x, t.y, [builder]);
      if (b) { g.setOrder(builder, { type: 'gather', target: t.id }, true); return true; }
      return false;
    };
    if (v >= 4 && !this.count('lumbercamp')) {
      const site = this.findResourceSite('wood');
      if (site && this.afford(p.buildingCost('lumbercamp'), true)) {
        const bl = this.pickBuilders(1, site.x, site.y);
        if (bl.length && this.placeNear('lumbercamp', site.x, site.y, bl)) { g.setOrder(bl[0], { type: 'gather', target: site.id }, true); return; }
      }
    }
    if (tryCamp('lumbercamp', 'wood', far.wood, 3)) return;
    if (tryCamp('miningcamp', 'gold', far.gold, 2)) return;
    if (tryCamp('miningcamp', 'stone', far.stone, 2)) return;
    if (tryCamp('mill', 'forage', far.forage, 2)) return;
    if (v >= 8 && !this.count('mill')) {
      const bush = g.findResourceNear(this.tc.x, this.tc.y, 'forage', 22, p.id, 0);
      if (bush && distToRect(bush.x, bush.y, this.tc.x0, this.tc.y0, this.tc.x1, this.tc.y1) > 4 && this.afford(p.buildingCost('mill'), true)) {
        const bl = this.pickBuilders(1, bush.x, bush.y);
        if (bl.length && this.placeNear('mill', bush.x, bush.y, bl)) g.setOrder(bl[0], { type: 'gather', target: bush.id }, true);
      }
    }
  }

  manageBuilders() {
    const g = this.g;
    for (const type in this.bs) for (const b of this.bs[type]) {
      if (b.built || b.type === 'farm') continue;
      if (b.bcPrev > 0) continue;
      const assigned = this.vils.some(u => u.order && (u.order.type === 'build') && u.order.target === b.id) ||
        this.vils.some(u => u.queue.some(q => q.target === b.id));
      if (assigned) continue;
      const k = type === 'castle' || type === 'wonder' ? 4 : type === 'towncenter' ? 3 : 1;
      const bl = this.pickBuilders(k, b.x, b.y);
      for (const u of bl) g.setOrder(u, { type: 'build', target: b.id });
    }
  }

  pickBuilders(k, x, y) {
    const pri = u => {
      const r = this.vilRes(u);
      if (!u.order) return 0;
      if (r === 'build' || r === 'garrison') return 99;
      if (r === 'wood') return 1;
      if (r === 'stone') return 2;
      if (r === 'gold') return 3;
      if (u.order.kind === 'farm') return 5;
      return 4;
    };
    return this.vils.filter(u => !u.garrisonedIn && pri(u) < 99)
      .sort((a, b) => (pri(a) - pri(b)) * 20 + (Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)))
      .slice(0, k);
  }

  // ------------------------------------------------------------------ placement
  clearRing(type, tx, ty, mode) {
    const g = this.g, n = g.n, s = BUILDINGS[type].size;
    let open = 0, total = 0;
    for (let y = ty - 1; y <= ty + s; y++) for (let x = tx - 1; x <= tx + s; x++) {
      if (x >= tx && x < tx + s && y >= ty && y < ty + s) continue;
      total++;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const i = y * n + x;
      const e = g.ents.get(g.occ[i]);
      if (e) {
        if (e.kind === 'building' && e.type !== 'farm') return false;
        if (e.kind === 'resource' && mode !== 'drop') return false;
        if (e.kind === 'building' && e.type === 'farm' && mode !== 'farm' && type !== 'house') return false;
        continue;
      }
      if (g.block[i] === 0) open++;
    }
    return open >= total * 0.5;
  }

  findSpot(type, cx, cy, minR, maxR, mode) {
    const g = this.g, s = BUILDINGS[type].size;
    const off = Math.floor(s / 2);
    const tcx = Math.floor(cx), tcy = Math.floor(cy);
    const rot = Math.floor(Math.random() * 8);
    for (let r = Math.floor(minR); r <= maxR; r++) {
      const ring = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([dx, dy]);
      const k0 = Math.floor(ring.length * rot / 8);
      for (let k = 0; k < ring.length; k++) {
        const [dx, dy] = ring[(k + k0) % ring.length];
        const tx = tcx + dx - off, ty = tcy + dy - off;
        if (!g.canPlace(type, tx, ty, this.p.id)) continue;
        if (mode !== 'farm' && !this.clearRing(type, tx, ty, mode)) continue;
        // keep the inner ring around the TC free for farms
        if (mode !== 'farm' && mode !== 'drop' && this.tc && type !== 'house' && distToRect(tx + s / 2, ty + s / 2, this.tc.x0, this.tc.y0, this.tc.x1, this.tc.y1) < 5) continue;
        return [tx, ty];
      }
    }
    return null;
  }

  place(type, near, minR, maxR, clearance = 1, builders = null) {
    const g = this.g;
    if (!near) return null;
    const cost = this.p.buildingCost(type);
    if (!this.afford(cost, type === 'house' || type === 'farm')) return null;
    if (!g.canBuildType(this.p.id, type).ok) return null;
    const spot = this.findSpot(type, near.x, near.y, minR, maxR, type === 'farm' ? 'farm' : 'normal');
    if (!spot) return null;
    const bl = builders || this.pickBuilders(type === 'house' ? 1 : type === 'castle' || type === 'wonder' ? 5 : type === 'towncenter' ? 4 : 2, spot[0], spot[1]);
    if (!bl.length) return null;
    return this.registered(g.commandBuild(bl, type, spot[0], spot[1], false, true));
  }

  // keep the per-think building cache current so we don't double-place
  registered(b) {
    if (!b) return b;
    (this.bs[b.type] || (this.bs[b.type] = [])).push(b);
    if (b.type === 'house') this.houseFound++; else if (b.type !== 'farm') this.foundations++;
    return b;
  }

  placeNear(type, x, y, builders) {
    const g = this.g;
    if (!g.canBuildType(this.p.id, type).ok) return null;
    const spot = this.findSpot(type, x, y, 1, 6, 'drop');
    if (!spot) return null;
    return this.registered(g.commandBuild(builders, type, spot[0], spot[1], false, true));
  }

  // ------------------------------------------------------------------ build order
  buildPlan() {
    const p = this.p, a = p.age, v = this.vils.length;
    const maxF = a >= 2 ? 3 : a >= 1 ? 2 : 1;
    if (this.foundations >= maxF) return;
    const want = [];
    const mainMil = this.mainBuilding(), otherMil = mainMil === 'stable' ? 'archeryrange' : 'stable';
    if (v >= 9 || a >= 1) want.push(['barracks', 1]);
    if (a === 0 && v >= 12 && !this.count('mill')) want.push(['mill', 1]);
    if (a === 1) {
      // buildings that unlock the Castle Age come first
      want.push([mainMil, 1], ['blacksmith', 1]);
      if (this.d.market && v >= 24) want.push(['market', 1]);
      if (v >= 22) want.push([otherMil, 1]);
      if (this.d.towers && v >= 20 && p.res.stone >= 300 && this.count('watchtower') < 2) want.push(['watchtower', this.count('watchtower') + 1]);
    }
    if (a >= 2) {
      want.push(['siegeworkshop', 1], ['university', 1], [mainMil, 1], ['blacksmith', 1]);
      if (this.d.castle && p.res.stone >= 500) want.push(['castle', 1]);
      want.push([mainMil, 2], [otherMil, 1]);
      if (this.d.extraTC && v >= 35) want.push(['towncenter', 2]);
      if (p.civId === 'byzantines' || p.civId === 'franks') want.push(['monastery', 1]);
      if (this.d.market) want.push(['market', 1]);
    }
    if (a >= 3) {
      want.push([mainMil, 3], ['barracks', 2]);
      if (this.d.wonder && p.res.wood > 1200 && p.res.gold > 1100 && p.res.stone > 1050) want.push(['wonder', 1]);
    }
    this.buildReserve = null;
    for (const [type, n] of want) {
      if (this.count(type) >= n) continue;
      if (!this.g.canBuildType(p.id, type).ok) continue;
      const cost = p.buildingCost(type);
      if (!this.afford(cost)) {
        // hold resources for this building so the army doesn't spend them first
        this.buildReserve = cost;
        for (const r of RES) this.reserve[r] += cost[r] || 0;
        return;
      }
      const minR = type === 'watchtower' ? 8 : type === 'castle' ? 9 : 7;
      const maxR = type === 'castle' || type === 'wonder' ? 24 : 22;
      if (type === 'watchtower') {
        const mine = (this.bs.miningcamp || [])[0];
        if (mine && this.place(type, mine, 2, 6)) return;
      }
      if (this.place(type, this.towardEnemy(this.base, type === 'castle' ? 4 : 0), minR, maxR)) return;
      // no room for it: try the next item rather than stalling the whole plan
    }
  }

  mainBuilding() {
    return this.p.civId === 'franks' ? 'stable' : 'archeryrange';
  }

  towardEnemy(pt, by) {
    if (!by) return pt;
    const e = this.enemyTarget();
    if (!e) return pt;
    const dx = e.x - pt.x, dy = e.y - pt.y, d = Math.hypot(dx, dy) || 1;
    return { x: pt.x + dx / d * by, y: pt.y + dy / d * by };
  }

  ageUp() {
    const g = this.g, p = this.p;
    const next = ['feudal', 'castle', 'imperial'][p.age];
    if (!next || !this.tc || !this.tc.built) return;
    if ([...p.pending].some(t => TECHS[t].ageUp)) return;
    const need = [this.d.feudalVils, this.d.castleVils, this.d.impVils][p.age];
    if (this.vils.length < need && g.time < 2400) return;
    if (!p.ageReqMet(p.age + 1)) return;
    if (!p.canAfford(p.techCost(next))) return;
    if (this.tc.queue.length) {
      // don't wait behind villagers
      if (this.tc.queue.every(q => q.kind === 'unit')) { while (this.tc.queue.length > 1) g.commandCancel(this.tc, this.tc.queue.length - 1); }
    }
    g.commandResearch(this.tc, next);
  }

  research() {
    const g = this.g, p = this.p;
    if (Math.random() > this.d.techRate) return;
    const tryTech = (id) => {
      const t = TECHS[id];
      const bl = (this.bs[t.at] || []).filter(b => b.built && b.queue.length === 0);
      if (!bl.length) return false;
      if (!g.canResearch(bl[0], id).ok) return false;
      if (!this.afford(p.techCost(id))) return false;
      return g.commandResearch(bl[0], id);
    };
    for (const [id, minVils] of AI_ECO_TECHS) {
      if (id === 'loom' && p.age === 0 && !(p.lastAttackedT > g.time - 30) && this.vils.length < 16) continue;
      if (TECHS[id].age > p.age) continue;
      if (this.vils.length < 10 + minVils * 6) continue;
      if (tryTech(id)) return;
    }
    if (p.age < 1 || this.mil.length < 4) return;
    // military upgrades relevant to our army
    const has = cls => this.mil.some(u => u.st.classes.includes(cls));
    const list = [];
    if (has('archer')) list.push('fletching', 'paddedarcher', 'bodkinarrow', 'leatherarcher', 'thumbring', 'bracer', 'ringarcher', 'up_crossbow', 'up_arbalester', 'up_eliteskirm');
    if (has('cavalry')) list.push('bloodlines', 'scalebarding', 'forging', 'husbandry', 'chainbarding', 'ironcasting', 'up_lightcav', 'up_cavalier', 'platebarding', 'blastfurnace', 'up_hussar', 'up_paladin', 'up_heavycavarcher');
    if (has('infantry')) list.push('forging', 'scalemail', 'up_manatarms', 'up_pikeman', 'squires', 'ironcasting', 'chainmail', 'up_longsword', 'platemail', 'up_halberdier', 'up_champion');
    if (p.age >= 2) list.push(this.p.civ.uniqueTech, 'masonry', 'ballistics', 'chemistry', 'up_elitelongbow', 'up_eliteaxe', 'up_elitemangudai', 'up_elitecataphract', 'up_onager', 'up_cappedram', 'guardtower');
    for (const id of list) if (TECHS[id] && tryTech(id)) return;
  }

  // ------------------------------------------------------------------ military
  trainArmy() {
    const g = this.g, p = this.p;
    if (p.age < 1) return;
    if (this.vils.length < Math.min(16, this.d.feudalVils - 4) && !(p.lastAttackedT > g.time - 20)) return;
    if (this.mil.length >= this.d.maxArmy) return;
    const weights = this.unitWeights();
    for (const type of ['barracks', 'archeryrange', 'stable', 'castle', 'siegeworkshop']) {
      for (const b of (this.bs[type] || [])) {
        if (!b.built || b.queue.length >= 2) continue;
        const opts = [];
        for (const slot of (b.def.trains || [])) {
          const t = p.resolve(slot);
          if (!g.canTrain(b, t).ok) continue;
          const w = weights[slot] || 0;
          if (w > 0) opts.push([slot, w]);
        }
        if (!opts.length) continue;
        let sum = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * sum;
        let pick = opts[0][0];
        for (const [s, w] of opts) { r -= w; if (r <= 0) { pick = s; break; } }
        const t = p.resolve(pick);
        if (!this.afford(p.unitCost(t))) continue;
        g.commandTrain(b, pick);
        if (!b.rally && this.base) {
          const rp = this.towardEnemy(this.base, 9);
          b.rally = { x: rp.x, y: rp.y, ent: 0 };
        }
      }
    }
  }

  unitWeights() {
    const p = this.p, g = this.g;
    const w = {};
    for (const [slot, wt, minAge] of this.comp) if (p.age >= minAge) w[slot] = (w[slot] || 0) + wt;
    // feudal fallbacks
    if (p.age === 1) { if (w.knight == null && this.comp.some(c => c[0] === 'knight')) w.scoutcavalry = (w.scoutcavalry || 0) + 2; if (this.comp.some(c => c[0] === 'cavalryarcher')) w.archer = (w.archer || 0) + 3; }
    if (this.d.counters) {
      let cav = 0, arch = 0, inf = 0, siege = 0, tot = 0;
      for (const u of g.units) {
        if (u.dead || !p.isEnemy(u.owner) || u.isVillager || u.st.animal) continue;
        tot++;
        const c = u.st.classes;
        if (c.includes('siege')) siege++;
        else if (c.includes('archer')) arch++;
        else if (c.includes('cavalry')) cav++;
        else if (c.includes('infantry')) inf++;
      }
      if (tot >= 5) {
        if (cav / tot > 0.35) w.spearman = (w.spearman || 0) + 6 * cav / tot;
        if (arch / tot > 0.35) { w.skirmisher = (w.skirmisher || 0) + 5 * arch / tot; if (p.age >= 2) { w.knight = (w.knight || 0) + 2; w.mangonel = (w.mangonel || 0) + 1; } }
        if (inf / tot > 0.35) { w.archer = (w.archer || 0) + 4 * inf / tot; }
        if (siege >= 2) { w.scoutcavalry = (w.scoutcavalry || 0) + 2; w.knight = (w.knight || 0) + 1; }
      }
    }
    // siege for attacks
    if (p.age >= 2) {
      const rams = this.mil.filter(u => u.st.line === 'batteringram').length;
      if (rams < 2 + (p.age >= 3 ? 1 : 0)) w.batteringram = 3;
      if (p.age >= 3 && this.mil.filter(u => u.type === 'trebuchet').length < 2) w.trebuchet = 1;
    }
    return w;
  }

  enemyTarget() {
    const g = this.g;
    let best = null, bd = 1e9;
    for (let q = 1; q < g.players.length; q++) {
      const pl = g.players[q];
      if (!pl.alive || !this.p.isEnemy(q)) continue;
      const s = g.starts[q];
      const d = Math.hypot(s.x - this.base.x, s.y - this.base.y);
      if (d < bd) { bd = d; best = { x: s.x, y: s.y, pid: q }; }
    }
    return best;
  }

  defend() {
    const g = this.g, p = this.p;
    if (!this.base) return;
    const threats = [];
    const arr = g.hash.query(this.base.x, this.base.y, 22, []);
    for (const u of arr) if (!u.dead && !u.garrisonedIn && u.owner && p.isEnemy(u.owner) && !u.isVillager && Math.hypot(u.x - this.base.x, u.y - this.base.y) < 22) threats.push(u);
    // wolves / boars harassing villagers
    for (const u of arr) if (!u.dead && u.owner === 0 && u.st.animal === 'predator' && u.order && u.order.type === 'attack' && Math.hypot(u.x - this.base.x, u.y - this.base.y) < 18) threats.push(u);
    if (threats.length) {
      this.lastThreatT = g.time;
      let cx = 0, cy = 0;
      for (const t of threats) { cx += t.x; cy += t.y; }
      cx /= threats.length; cy /= threats.length;
      const defenders = this.mil.filter(u => !this.attackers.has(u.id) && !u.garrisonedIn && (!u.order || u.order.type === 'move'));
      if (defenders.length) g.commandMove(defenders, cx, cy, false, true);
      // town bell when badly outnumbered
      let threatPow = 0, ownPow = 0;
      for (const t of threats) threatPow += t.st.atk * t.hp / 30;
      for (const d of this.mil) if (!this.attackers.has(d.id)) ownPow += d.st.atk * d.hp / 30;
      if (this.d.bell && !this.bell && threatPow > ownPow * 1.5 + 8 && threats.length >= 4) {
        g.commandRingBell(p.id); this.bell = true; this.bellT = g.time;
      }
      // call the attack force home if the base is in trouble
      if (threatPow > ownPow * 2 && this.attackers.size) {
        const home = [...this.attackers].map(id => g.ents.get(id)).filter(u => u && !u.dead);
        g.commandMove(home, cx, cy, false, true);
        this.attackers.clear();
      }
    } else if (this.bell && g.time - this.lastThreatT > 12) {
      g.commandAllClear(p.id); this.bell = false;
    }
    // garrisoned villagers left over (e.g. after bell) get released
    if (!this.bell && g.time - this.lastThreatT > 20 && g.tickN % 40 === 0) {
      for (const b of g.buildings) if (b.owner === p.id && b.garrison.length && !b.dead) g.commandUngarrison(b);
    }
  }

  attack() {
    const g = this.g, p = this.p;
    for (const id of this.attackers) { const u = g.ents.get(id); if (!u || u.dead) this.attackers.delete(id); }
    const home = this.mil.filter(u => !this.attackers.has(u.id) && (u.type !== 'scoutcavalry' || g.time > 300));
    if (g.time > this.nextAttack && g.time - this.lastThreatT > 15) {
      const need = this.d.armyMin + this.waves * this.d.armyGrow;
      const strength = home.filter(u => !u.st.monk).length;
      if (strength >= Math.min(need, this.d.maxArmy * 0.7)) {
        const tgt = this.pickAttackTarget();
        if (tgt) {
          const army = home.filter(u => !u.st.monk && !u.garrisonedIn);
          for (const u of army) this.attackers.add(u.id);
          g.commandMove(army, tgt.x, tgt.y, false, true);
          this.attackTarget = tgt;
          this.waves++;
          this.nextAttack = g.time + 150 + Math.random() * 90;
          this.attackSize = army.length;
        }
      }
    }
    // keep attackers busy: idle attackers find buildings to destroy
    if (this.attackers.size && g.tickN % 4 === 0) {
      const alive = [...this.attackers].map(id => g.ents.get(id)).filter(u => u && !u.dead);
      if (alive.length < Math.max(2, (this.attackSize || 0) * 0.2)) {
        // retreat the remains
        g.commandMove(alive, this.base.x, this.base.y);
        this.attackers.clear();
        return;
      }
      for (const u of alive) {
        if (u.order) continue;
        const b = this.nearestEnemyBuilding(u.x, u.y, 30);
        if (b) g.commandTarget([u], b);
        else {
          const t = this.pickAttackTarget();
          if (t) g.setOrder(u, { type: 'move', x: t.x, y: t.y, attackMove: true });
          else this.attackers.delete(u.id);
        }
      }
    }
  }

  pickAttackTarget() {
    const e = this.enemyTarget();
    if (!e) return null;
    const g = this.g;
    // prefer the enemy town center, else any building
    let best = null, bd = 1e9;
    for (const b of g.buildings) {
      if (b.dead || b.owner !== e.pid || b.def.wall) continue;
      const d = Math.hypot(b.x - this.base.x, b.y - this.base.y) - (b.type === 'towncenter' ? 6 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return { x: best.x, y: best.y, id: best.id };
    for (const u of g.units) if (!u.dead && u.owner === e.pid) return { x: u.x, y: u.y };
    return null;
  }

  nearestEnemyBuilding(x, y, r) {
    const g = this.g;
    let best = null, bd = r;
    for (const b of g.buildings) {
      if (b.dead || !this.p.isEnemy(b.owner)) continue;
      const d = distToRect(x, y, b.x0, b.y0, b.x1, b.y1) + (b.def.wall ? 8 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  useMarket() {
    const g = this.g, p = this.p;
    if (!this.d.market || !this.built('market') || g.tickN % 20 !== 0) return;
    for (const r of ['food', 'wood', 'stone']) {
      if (p.res[r] > 1600 && p.res.gold < 400) { g.commandMarket(p.id, 'sell', r); return; }
    }
    if (p.res.gold > 650) {
      for (const r of ['food', 'wood']) if (p.res[r] < 200 && g.marketPrice(r, true) < 250) { g.commandMarket(p.id, 'buy', r); return; }
    }
  }
}

function g_train(game, b, type) { return game.commandTrain(b, type, 1); }
