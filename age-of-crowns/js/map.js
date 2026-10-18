'use strict';
// ============================================================================
//  Random map generation. Six map styles share one pipeline:
//    terrain -> player starts -> player resources -> forests -> extras ->
//    connectivity repair.
// ============================================================================

const TREE = { OAK: 0, PINE: 1, PALM: 2, SNOWPINE: 3, BIRCH: 4 };

function generateMap(game, opts) {
  const n = game.n;
  const rnd = mulberry32(opts.seed);
  const noise = makeNoise(opts.seed % 100000);
  const noise2 = makeNoise((opts.seed * 7 + 13) % 100000);
  const terr = game.terrain;
  const forest = new Uint8Array(n * n);      // 1 = place a tree here
  const reserved = new Uint8Array(n * n);    // keep clear of forests / water
  const mapType = opts.map;
  const nPlayers = game.players.length - 1;
  const C = n / 2;
  const idx = (x, y) => y * n + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < n && y < n;
  let treeKind = [TREE.OAK];

  // ---------------------------------------------------------------- starts
  const startR = { mediterranean: 0.4, oasis: 0.37, blackforest: 0.36 }[mapType] || 0.36;
  const angle0 = rnd() * Math.PI * 2;
  const starts = [];
  // group teammates next to each other
  const order = game.players.slice(1).map(p => p.id).sort((a, b) => game.players[a].team - game.players[b].team || a - b);
  order.forEach((pid, i) => {
    const a = angle0 + (i / nPlayers) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const r = n * startR * (0.94 + rnd() * 0.08);
    starts[pid] = { x: Math.round(C + Math.cos(a) * r), y: Math.round(C + Math.sin(a) * r), a };
  });
  game.starts = starts;
  const nearStart = (x, y, rad) => {
    for (let p = 1; p <= nPlayers; p++) { const s = starts[p]; if ((s.x - x) ** 2 + (s.y - y) ** 2 < rad * rad) return p; }
    return 0;
  };

  // ---------------------------------------------------------------- terrain
  const setT = (x, y, t) => { if (inb(x, y)) terr[idx(x, y)] = t; };
  const disc = (cx, cy, r, fn) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (inb(x, y)) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d <= r) fn(x, y, d); }
  };

  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = noise(x / 14, y / 14), v2 = noise2(x / 9, y / 9);
    let t;
    switch (mapType) {
      case 'arabia': t = v < 0.42 ? T.GRASS : v2 > 0.66 ? T.SAND : T.DIRT; break;
      case 'blackforest': t = v2 > 0.55 ? T.LEAVES : T.GRASS; break;
      case 'oasis': t = v2 > 0.7 ? T.DIRT : T.SAND; break;
      case 'rivers': t = v2 > 0.68 ? T.DIRT : T.GRASS; break;
      case 'mediterranean': t = v2 > 0.66 ? T.DIRT : T.GRASS; break;
      case 'frozennorth': t = v2 > 0.72 ? T.DIRT : T.SNOW; break;
      default: t = T.GRASS;
    }
    terr[idx(x, y)] = t;
  }

  // per-map features
  if (mapType === 'arabia') {
    treeKind = [TREE.OAK, TREE.OAK, TREE.BIRCH];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const f = noise2(x / 7 + 40, y / 7 + 40);
      if (f > 0.74) forest[idx(x, y)] = 1;
      else if (rnd() < 0.004) forest[idx(x, y)] = 1;
    }
    // a couple of small ponds
    for (let k = 0; k < 2; k++) {
      const a = rnd() * Math.PI * 2, r = n * (0.12 + rnd() * 0.1);
      const px = C + Math.cos(a) * r, py = C + Math.sin(a) * r;
      if (nearStart(px, py, 18)) continue;
      const pr = 2.5 + rnd() * 2;
      disc(px, py, pr + 1.5, (x, y, d) => { if (terr[idx(x, y)] !== T.WATER) setT(x, y, d < pr + 0.6 ? T.SHALLOW : T.GRASS); });
      disc(px, py, pr, (x, y) => setT(x, y, T.WATER));
    }
  } else if (mapType === 'blackforest') {
    treeKind = [TREE.OAK, TREE.PINE, TREE.PINE];
    forest.fill(1);
    // clear corridors between neighbouring players and to the center
    const carve = (ax, ay, bx, by, w) => {
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
      const off = rnd() * 100;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wob = (noise(t * 4 + off, off) - 0.5) * 10;
        const nx = -(by - ay) / steps, ny = (bx - ax) / steps;
        const x = ax + (bx - ax) * t + nx * wob, y = ay + (by - ay) * t + ny * wob;
        disc(x, y, w, (xx, yy) => { forest[idx(xx, yy)] = 0; });
      }
    };
    for (let i = 0; i < order.length; i++) {
      const a = starts[order[i]], b = starts[order[(i + 1) % order.length]];
      if (order.length > 1) carve(a.x, a.y, b.x, b.y, 2.2);
      carve(a.x, a.y, C, C, 2.6);
    }
    disc(C, C, 9, (x, y) => { forest[idx(x, y)] = 0; });
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (noise(x / 6 + 90, y / 6) > 0.7) forest[idx(x, y)] = 0;
  } else if (mapType === 'oasis') {
    treeKind = [TREE.PALM];
    const lr = n * 0.075;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = Math.atan2(y - C, x - C);
      const wob = (noise(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5) - 0.5) * 6;
      const d = Math.hypot(x + 0.5 - C, y + 0.5 - C) + wob;
      const i = idx(x, y);
      if (d < lr) terr[i] = T.WATER;
      else if (d < lr + 1.2) terr[i] = T.SHALLOW;
      else if (d < lr + 9) { terr[i] = T.GRASS; if (d > lr + 2 && noise2(x / 4, y / 4) > 0.25) forest[i] = 1; }
      else if (d < lr + 11) terr[i] = noise(x / 3, y / 3) > 0.5 ? T.GRASS : T.DIRT;
    }
  } else if (mapType === 'rivers') {
    treeKind = [TREE.OAK, TREE.BIRCH, TREE.OAK];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (noise2(x / 6 + 11, y / 6 + 3) > 0.73) forest[idx(x, y)] = 1;
    const sorted = order.map(p => starts[p].a).sort((a, b) => a - b);
    const riverAngles = nPlayers >= 2 ? sorted.map((a, i) => { const b = sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? Math.PI * 2 : 0); return (a + b) / 2; }) : [angle0 + Math.PI];
    for (const ra of riverAngles) {
      const off = rnd() * 100;
      const r0 = 7, r1 = n * 0.75;
      const fords = [0.35 + rnd() * 0.1, 0.7 + rnd() * 0.1];
      for (let r = r0; r < r1; r += 0.5) {
        const t = (r - r0) / (r1 - r0);
        const ang = ra + (noise(t * 5 + off, off) - 0.5) * 0.5;
        const x = C + Math.cos(ang) * r, y = C + Math.sin(ang) * r;
        const ford = fords.some(f => Math.abs(t - f) < 0.035);
        const w = 1.6 + noise(t * 9, off + 3) * 0.8;
        disc(x, y, w + 1.2, (xx, yy, d) => {
          const i = idx(xx, yy);
          forest[i] = 0;
          if (ford) { if (d < w + 0.6) terr[i] = T.SHALLOW; }
          else if (d < w) terr[i] = T.WATER;
          else if (terr[i] !== T.WATER) terr[i] = T.SHALLOW;
        });
      }
    }
  } else if (mapType === 'mediterranean') {
    treeKind = [TREE.OAK, TREE.PINE];
    const sr = n * 0.24;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = Math.atan2(y - C, x - C);
      const wob = (noise(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 7) - 0.5) * n * 0.12;
      const d = Math.hypot(x + 0.5 - C, y + 0.5 - C) + wob;
      const i = idx(x, y);
      if (d < sr) terr[i] = T.WATER;
      else if (d < sr + 1.3) terr[i] = T.SHALLOW;
      else if (d < sr + 4) terr[i] = T.SAND;
      else if (noise2(x / 7 + 60, y / 7 + 20) > 0.7 && d > sr + 6) forest[i] = 1;
    }
    // a few islands of sand in the sea
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * sr * 0.5;
      disc(C + Math.cos(a) * r, C + Math.sin(a) * r, 1.5 + rnd() * 1.5, (x, y) => setT(x, y, T.SAND));
    }
  } else if (mapType === 'frozennorth') {
    treeKind = [TREE.SNOWPINE, TREE.SNOWPINE, TREE.PINE];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = idx(x, y);
      if (noise(x / 11 + 30, y / 11 + 30) > 0.7) terr[i] = T.ICE;
      else if (noise2(x / 7 + 77, y / 7) > 0.7) forest[i] = 1;
    }
  }

  // clear player areas
  for (let p = 1; p <= nPlayers; p++) {
    const s = starts[p];
    disc(s.x, s.y, 11, (x, y, d) => {
      const i = idx(x, y);
      forest[i] = 0; reserved[i] = 1;
      if (terr[i] === T.WATER || terr[i] === T.SHALLOW || terr[i] === T.ICE)
        terr[i] = mapType === 'oasis' ? T.SAND : mapType === 'frozennorth' ? T.SNOW : T.GRASS;
      if (d < 5 && mapType !== 'frozennorth' && mapType !== 'oasis') terr[i] = d < 3.5 ? T.DIRT : terr[i];
    });
  }
  // Water can't be adjacent to a start's clear zone in a way that blocks: smooth shallow fringe
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = idx(x, y);
    if (terr[i] !== T.WATER) continue;
    let land = false;
    for (let dy = -1; dy <= 1 && !land; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (inb(xx, yy)) { const t = terr[idx(xx, yy)]; if (t !== T.WATER && t !== T.SHALLOW) { land = true; break; } }
    }
    if (land) terr[i] = T.SHALLOW;
  }
  game.rebuildBlock();

  // ---------------------------------------------------------------- placement helpers
  const free = (x, y, margin = 0) => {
    for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inb(xx, yy)) return false;
      const i = idx(xx, yy);
      if (game.occ[i] || !TERRAINS[terr[i]].build) return false;
    }
    return true;
  };
  // grow a blob of k tiles; returns tile list or null
  const blob = (cx, cy, k) => {
    const tiles = [[cx, cy]], set = new Set([idx(cx, cy)]);
    if (!free(cx, cy, 1)) return null;
    let guard = 0;
    while (tiles.length < k && guard++ < 200) {
      const [bx, by] = tiles[Math.floor(rnd() * tiles.length)];
      const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
      const nx = bx + d[0], ny = by + d[1];
      if (!inb(nx, ny) || set.has(idx(nx, ny)) || !free(nx, ny, 1)) continue;
      tiles.push([nx, ny]); set.add(idx(nx, ny));
    }
    return tiles.length === k ? tiles : null;
  };
  const ringSpot = (s, dmin, dmax, need, tries = 120, extra) => {
    for (let t = 0; t < tries; t++) {
      const a = rnd() * Math.PI * 2, d = dmin + rnd() * (dmax - dmin);
      const x = Math.round(s.x + Math.cos(a) * d), y = Math.round(s.y + Math.sin(a) * d);
      if (!inb(x, y)) continue;
      if (extra && !extra(x, y)) continue;
      const r = need(x, y);
      if (r) return r;
    }
    return null;
  };
  const placeCluster = (type, s, dmin, dmax, k, amount, extra) => {
    const tiles = ringSpot(s, dmin, dmax, (x, y) => blob(x, y, k), 160, extra);
    if (tiles) for (const [x, y] of tiles) game.addResource(type, x, y, amount);
    return !!tiles;
  };
  const placeAnimals = (type, s, dmin, dmax, count, owner = 0, spread = 1.5) => {
    const spot = ringSpot(s, dmin, dmax, (x, y) => free(x, y, 1) ? [x, y] : null);
    if (!spot) return;
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 20; t++) {
        const x = spot[0] + 0.5 + (rnd() - 0.5) * spread * 2, y = spot[1] + 0.5 + (rnd() - 0.5) * spread * 2;
        if (inb(Math.floor(x), Math.floor(y)) && game.block[idx(Math.floor(x), Math.floor(y))] === 0) { game.addUnit(type, owner, x, y); break; }
      }
    }
  };
  const awayFromOthers = (pid, rad) => (x, y) => { const q = nearStart(x, y, rad); return !q || q === pid; };

  // ---------------------------------------------------------------- player starts
  const res = opts.startRes === 'high' ? { food: 1000, wood: 1000, gold: 500, stone: 500 }
    : opts.startRes === 'deathmatch' ? { food: 20000, wood: 20000, gold: 10000, stone: 5000 }
    : { food: 200, wood: 200, gold: 100, stone: 200 };
  for (let p = 1; p <= nPlayers; p++) {
    const s = starts[p];
    const pl = game.players[p];
    Object.assign(pl.res, res);
    const tc = game.addBuilding('towncenter', p, s.x - 2, s.y - 2, true);
    pl.startTC = tc.id;
    // villagers & scout
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * 0.25 + i * 0.6;
      game.addUnit('villager', p, s.x + Math.cos(a) * 3.2, s.y + Math.sin(a) * 3.2);
    }
    const sa = Math.atan2(C - s.y, C - s.x);
    game.addUnit('scoutcavalry', p, s.x + Math.cos(sa) * 3.6, s.y + Math.sin(sa) * 3.6);
    // sheep near the town center
    for (let i = 0; i < 6; i++) {
      const a = sa + Math.PI + (i - 2.5) * 0.38;
      game.addUnit('sheep', p, s.x + Math.cos(a) * 4.2, s.y + Math.sin(a) * 4.2);
    }
    if (opts.startRes === 'deathmatch') continue;
    const away = awayFromOthers(p, n * 0.2);
    placeCluster('berry', s, 7, 9, 6, 125, away);
    placeCluster('gold', s, 9, 12, 7, 800, away);
    placeCluster('stone', s, 10, 13, 5, 350, away);
    placeCluster('gold', s, 15, 20, 4, 800, away);
    placeCluster('stone', s, 16, 21, 4, 350, away);
    placeAnimals('sheep', s, 12, 18, 2, 0);
    placeAnimals('sheep', s, 14, 22, 2, 0);
    if (mapType !== 'frozennorth') placeAnimals('deer', s, 14, 20, 3, 0, 2);
    else placeAnimals('deer', s, 14, 20, 4, 0, 2);
    placeAnimals('boar', s, 13, 17, 1, 0, 0.5);
    placeAnimals('boar', s, 15, 19, 1, 0, 0.5);
    // straggler trees
    for (let i = 0; i < 4; i++) {
      const spot = ringSpot(s, 5.5, 8, (x, y) => free(x, y, 1) ? [x, y] : null);
      if (spot) game.addResource('tree', spot[0], spot[1], 100, { variant: treeKind[Math.floor(rnd() * treeKind.length)] });
    }
    // a guaranteed woodline
    if (mapType !== 'blackforest') {
      const spot = ringSpot(s, 11.5, 14, (x, y) => free(x, y, 2) ? [x, y] : null, 200, away);
      if (spot) {
        const len = 14 + Math.floor(rnd() * 6);
        const a = rnd() * Math.PI;
        for (let k = -len / 2; k < len / 2; k++) {
          for (let w = 0; w < 3; w++) {
            const x = Math.round(spot[0] + Math.cos(a) * k + Math.cos(a + Math.PI / 2) * w);
            const y = Math.round(spot[1] + Math.sin(a) * k + Math.sin(a + Math.PI / 2) * w);
            if (inb(x, y) && Math.hypot(x - s.x, y - s.y) > 9) forest[idx(x, y)] = 1;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- forests
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = idx(x, y);
    if (!forest[i]) continue;
    const t = terr[i];
    if (!TERRAINS[t].build || game.occ[i]) continue;
    // don't wall in mines / berries
    let bad = false;
    for (let dy = -1; dy <= 1 && !bad; dy++) for (let dx = -1; dx <= 1; dx++) {
      const e = game.ents.get(game.occ[idx(x + dx, y + dy)]);
      if (e && (e.kind === 'building' || (e.kind === 'resource' && e.type !== 'tree'))) { bad = true; break; }
    }
    if (bad) continue;
    if (reserved[i] && mapType !== 'blackforest') continue;
    const density = mapType === 'blackforest' ? 0.96 : 0.9;
    if (rnd() > density) continue;
    game.addResource('tree', x, y, 100, { variant: treeKind[Math.floor(hash2(x, y, 5) * treeKind.length)] });
  }
  // make the ground under forests darker
  for (const r of game.resources) if (r.type === 'tree') {
    const i = idx(r.tx, r.ty);
    if (terr[i] === T.GRASS && mapType !== 'oasis') terr[i] = T.LEAVES;
  }

  // ---------------------------------------------------------------- neutral extras
  const center = { x: C, y: C };
  const extras = Math.round(nPlayers * 1.5);
  for (let k = 0; k < extras; k++) {
    const far = (x, y) => !nearStart(x, y, 22);
    placeCluster('gold', center, n * 0.05, n * 0.45, 4 + Math.floor(rnd() * 3), 800, far);
    if (k % 2 === 0) placeCluster('stone', center, n * 0.05, n * 0.45, 4, 350, far);
    placeCluster('berry', center, n * 0.1, n * 0.45, 4, 125, far);
    placeAnimals('deer', center, n * 0.1, n * 0.45, 3, 0, 2);
    placeAnimals('sheep', center, n * 0.05, n * 0.4, 2, 0);
  }
  if (mapType === 'frozennorth' || mapType === 'blackforest') {
    for (let k = 0; k < nPlayers * 2; k++) {
      const spot = ringSpot(center, n * 0.05, n * 0.48, (x, y) => (!nearStart(x, y, 24) && free(x, y, 1)) ? [x, y] : null);
      if (spot) for (let i = 0; i < 2 + (k % 2); i++) game.addUnit('wolf', 0, spot[0] + 0.5 + (rnd() - 0.5) * 2, spot[1] + 0.5 + (rnd() - 0.5) * 2);
    }
  }

  // ---------------------------------------------------------------- connectivity repair
  const reach = () => {
    const seen = new Uint8Array(n * n);
    const s = starts[order[0]];
    const q = [idx(s.x + 2, s.y + 3)];
    // start just outside the TC
    const st0 = idx(clamp(s.x, 0, n - 1), clamp(s.y + 3, 0, n - 1));
    q[0] = st0; seen[st0] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % n, cy = (c - cx) / n;
      for (let d = 0; d < 4; d++) {
        const nx = cx + [1, -1, 0, 0][d], ny = cy + [0, 0, 1, -1][d];
        if (!inb(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen[ni] || game.block[ni]) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return seen;
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = reach();
    let fixed = false;
    for (let k = 1; k < order.length; k++) {
      const s = starts[order[k]];
      if (seen[idx(s.x, clamp(s.y + 3, 0, n - 1))]) continue;
      const a = starts[order[0]];
      const steps = Math.ceil(Math.hypot(s.x - a.x, s.y - a.y));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        disc(a.x + (s.x - a.x) * t, a.y + (s.y - a.y) * t, 1.6, (x, y) => {
          const ii = idx(x, y);
          const e = game.ents.get(game.occ[ii]);
          if (e && e.kind === 'resource' && e.type === 'tree') game.removeEntity(e);
          if (terr[ii] === T.WATER) terr[ii] = T.SHALLOW;
        });
      }
      fixed = true;
    }
    if (!fixed) break;
    game.rebuildBlock();
  }
  game.rebuildBlock();
}
