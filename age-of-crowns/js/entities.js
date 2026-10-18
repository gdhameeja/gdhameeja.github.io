'use strict';
// ============================================================================
//  Entities: Player, Unit, Building, Resource
// ============================================================================

function cloneStats(type, def) {
  return {
    ...def, type,
    armor: { ...def.armor },
    bonus: { ...(def.bonus || {}) },
    classes: def.classes.slice(),
    cost: { ...(def.cost || {}) },
    accuracy: def.accuracy == null ? 1 : def.accuracy,
    minRange: def.minRange || 0,
    pop: def.pop == null ? (def.classes.includes('animal') ? 0 : 1) : def.pop,
  };
}

class Player {
  constructor(game, id, opts) {
    this.game = game;
    this.id = id;
    this.name = opts.name || ('Player ' + id);
    this.civId = opts.civ || 'britons';
    this.civ = CIVS[this.civId] || null;
    this.colorIdx = opts.color != null ? opts.color : id;
    this.color = PLAYER_COLORS[this.colorIdx];
    this.isAI = !!opts.ai;
    this.isHuman = !!opts.human;
    this.difficulty = opts.difficulty || 'normal';
    this.team = opts.team != null ? opts.team : id;
    this.res = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.age = 0;
    this.techs = new Set();
    this.pending = new Set();      // techs queued somewhere
    this.alive = id !== 0;
    this.pop = 0; this.popCap = 0;
    this.onAge = [];
    this.lineCur = {};
    this.mods = {
      gather: { forage: 1, hunt: 1, sheep: 1, farm: 1, wood: 1, gold: 1, stone: 1 },
      carry: 10, farmCarry: 0, farmFood: 175, buildRate: 1, buildingHp: 1, buildingArmor: 0, buildingLos: 0,
      trainSpeed: {}, costMult: {}, techCostMult: {}, towerAtk: 0, towerAtkT: 0, towerRange: 0, towerHp: 0,
      ballistics: false, aiGather: 1,
    };
    this.stats = {};
    // every upgrade line is named after its base unit type
    for (const k in UNITS) {
      this.stats[k] = cloneStats(k, UNITS[k]);
      if (UNITS[k].line) this.lineCur[UNITS[k].line] = UNITS[k].line;
    }
    if (this.civ && id !== 0) this.civ.apply(this);
    // statistics for the end screen
    this.st = {
      gathered: { food: 0, wood: 0, gold: 0, stone: 0 }, trained: 0, lost: 0, kills: 0,
      built: 0, razed: 0, bLost: 0, techs: 0, ageTimes: [0, null, null, null], timeline: [],
      tributed: 0, converted: 0,
    };
    this.wonderTimer = null;
    this.defeatedAt = null;
  }

  forStats(pred, fn) { for (const k in this.stats) { const s = this.stats[k]; if (pred(s)) fn(s); } }

  addMaxHp(pred, amt) {
    this.forStats(pred, s => { s.hp += amt; });
    for (const u of this.game.units) if (u.owner === this.id && !u.dead && pred(u.st)) u.hp += amt;
  }

  applyBuildingHp(mult) {
    for (const b of this.game.buildings) if (b.owner === this.id && !b.dead) { b.maxHp = Math.round(b.maxHp * mult); b.hp = Math.min(b.maxHp, b.hp * mult); }
  }

  applyTowerHp(add) {
    for (const b of this.game.buildings) if (b.owner === this.id && !b.dead && b.type === 'watchtower') { b.maxHp += add; b.hp += add * (b.built ? 1 : b.progress); }
  }

  // Current unit type for a training slot (resolves upgrade lines and the unique unit)
  resolve(type) {
    if (type === 'UNIQUE') type = this.civ ? this.civ.unique : 'longbowman';
    const line = UNITS[type].line;
    return line ? (this.lineCur[line] || type) : type;
  }

  upgradeLine(from, to) {
    const line = UNITS[from].line;
    if (line) this.lineCur[line] = to;
    const ns = this.stats[to];
    for (const u of this.game.units) {
      if (u.owner === this.id && u.type === from && !u.dead) {
        const ratio = u.hp / u.st.hp;
        u.type = to; u.st = ns; u.hp = Math.max(1, Math.round(ratio * ns.hp));
        u.spriteKey = null;
      }
    }
    for (const b of this.game.buildings) if (b.owner === this.id) for (const q of b.queue) if (q.kind === 'unit' && q.type === from) q.type = to;
  }

  applyMult(type, cost) {
    const m = this.mods.costMult[type];
    if (!m) return { ...cost };
    const out = {};
    for (const r of RES) if (cost[r]) out[r] = Math.round(cost[r] * (m.all != null ? m.all : (m[r] != null ? m[r] : 1)));
    return out;
  }
  unitCost(type) { return this.applyMult(type, UNITS[type].cost || {}); }
  buildingCost(type) { return this.applyMult(type, BUILDINGS[type].cost); }
  techCost(id) {
    const m = this.mods.techCostMult[id];
    const c = TECHS[id].cost;
    if (m == null) return { ...c };
    const out = {};
    for (const r of RES) if (c[r]) out[r] = Math.round(c[r] * m);
    return out;
  }

  canAfford(cost) { for (const r of RES) if ((cost[r] || 0) > this.res[r] + 1e-6) return false; return true; }
  pay(cost) { for (const r of RES) if (cost[r]) this.res[r] -= cost[r]; }
  refund(cost, f = 1) { for (const r of RES) if (cost[r]) this.res[r] += cost[r] * f; }
  missing(cost) { return RES.filter(r => (cost[r] || 0) > this.res[r]); }

  hasBuilt(type) { return this.game.buildings.some(b => b.owner === this.id && b.type === type && b.built && !b.dead); }
  countBuilt(type) { let n = 0; for (const b of this.game.buildings) if (b.owner === this.id && b.type === type && b.built && !b.dead) n++; return n; }

  research(id) {
    const t = TECHS[id];
    this.techs.add(id);
    this.pending.delete(id);
    this.st.techs++;
    if (t.effect) t.effect(this);
    if (t.upgrade) this.upgradeLine(t.upgrade[0], t.upgrade[1]);
    if (t.ageUp) {
      this.age = t.ageUp;
      this.st.ageTimes[t.ageUp] = this.game.time;
      for (const f of this.onAge) f(this.age);
      this.game.emit('age', this, t.ageUp);
    } else {
      this.game.emit('researched', this, id);
    }
  }

  // Age requirement check for age-up techs
  ageReqMet(target) {
    const r = AGE_REQ[target];
    if (!r) return true;
    let n = 0;
    const counted = new Set();
    for (const t of r.from) {
      if (t === 'castle' && this.hasBuilt('castle')) { n++; continue; }
      if (!counted.has(t) && this.hasBuilt(t)) { counted.add(t); n++; }
    }
    return n >= r.count;
  }

  isEnemy(other) { return other !== 0 && other !== this.id && this.game.players[other].team !== this.team; }
  isAlly(other) { return other === this.id || (other !== 0 && this.game.players[other].team === this.team); }
}

let NEXT_ID = 1;

class Unit {
  constructor(game, type, owner, x, y) {
    this.id = NEXT_ID++;
    this.kind = 'unit';
    this.type = type;
    this.owner = owner;
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.st = game.players[owner].stats[type];
    this.hp = this.st.hp;
    this.radius = this.st.radius || 0.22;
    this.facing = Math.random() < 0.5 ? 1 : -1;
    this.anim = 'idle'; this.animT = Math.random() * 10;
    this.order = null;
    this.queue = [];
    this.path = null; this.pi = 0;
    this.pathPending = false;
    this.goal = null;
    this.carry = 0; this.carryType = null;
    this.task = null;               // villager activity: wood/gold/stone/forage/farm/hunt/build/sheep
    this.attackCd = 0;
    this.scanCd = Math.random() * 0.5;
    this.stance = 'aggressive';
    this.garrisonedIn = 0;
    this.lastHitT = -99; this.lastAttacker = 0;
    this.stuckT = 0; this.repaths = 0; this.lastDist = 1e9;
    this.home = { x, y };
    this.faith = 100;
    this.convertT = 0;
    this.dead = false;
    this.selected = false;
    this.moving = false;
    this.fleeT = 0;
    this.idleT = 0;
    this.wanderT = 2 + Math.random() * 6;
    this.variant = this.id % 4;
  }
  get isVillager() { return this.type === 'villager'; }
  get isAnimal() { return this.owner === 0 || this.st.classes.includes('animal'); }
}

class Building {
  constructor(game, type, owner, tx, ty, built) {
    this.id = NEXT_ID++;
    this.kind = 'building';
    this.type = type;
    this.def = BUILDINGS[type];
    this.owner = owner;
    this.tx = tx; this.ty = ty;
    this.w = this.def.size; this.h = this.def.size;
    this.x = tx + this.w / 2; this.y = ty + this.h / 2;
    const p = game.players[owner];
    this.maxHp = Math.round(this.def.hp * p.mods.buildingHp + (type === 'watchtower' ? p.mods.towerHp : 0));
    this.built = !!built;
    this.progress = built ? 1 : 0;
    this.hp = built ? this.maxHp : 1;
    this.queue = [];
    this.rally = null;
    this.garrison = [];
    this.attackCd = 1;
    this.bcNow = 0; this.bcPrev = 0;
    this.farmer = 0;
    this.food = type === 'farm' ? p.mods.farmFood : 0;
    this.foodMax = this.food;
    this.dead = false;
    this.selected = false;
    this.seen = false;      // seen by the human viewer (for fog rendering)
    this.lastHitT = -99;
    this.builtAt = built ? game.time : null;
    this.variant = (tx * 7 + ty * 13) % 4;
  }
  get x0() { return this.tx; } get y0() { return this.ty; }
  get x1() { return this.tx + this.w; } get y1() { return this.ty + this.h; }
}

class Resource {
  constructor(game, type, tx, ty, amount, opts = {}) {
    this.id = NEXT_ID++;
    this.kind = 'resource';
    this.type = type;
    this.def = RESOURCES[type];
    this.res = this.def.res;
    this.tx = tx; this.ty = ty;
    this.x = opts.x != null ? opts.x : tx + 0.5;
    this.y = opts.y != null ? opts.y : ty + 0.5;
    this.amount = amount != null ? amount : this.def.amount;
    this.max = this.amount;
    this.variant = opts.variant || 0;
    this.animal = opts.animal || null;  // carcass source type
    this.facing = opts.facing || 1;
    this.dead = false;
    this.selected = false;
    this.owner = 0;
    this.gatherers = 0;
  }
  get x0() { return this.tx; } get y0() { return this.ty; }
  get x1() { return this.tx + 1; } get y1() { return this.ty + 1; }
}

// Rect helpers usable for any entity
function entRect(e) {
  if (e.kind === 'unit') return [e.x, e.y, e.x, e.y];
  if (e.kind === 'resource' && !e.def.blocks) return [e.x, e.y, e.x, e.y];
  return [e.x0, e.y0, e.x1, e.y1];
}
function distToEnt(x, y, e) {
  if (e.kind === 'unit') return Math.hypot(e.x - x, e.y - y) - e.radius;
  if (e.kind === 'resource' && !e.def.blocks) return Math.hypot(e.x - x, e.y - y);
  return distToRect(x, y, e.x0, e.y0, e.x1, e.y1);
}
