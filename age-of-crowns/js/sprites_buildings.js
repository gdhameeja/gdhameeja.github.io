'use strict';
// ============================================================================
//  Procedural building sprites. Drawn in isometric tile space with the origin
//  at the footprint's top corner. Each civ has an architectural style.
// ============================================================================

const STYLES = {
  west:   { wall: '#a9a192', wallL: '#c3bcac', wallD: '#7f786b', plaster: '#e8dfc7', beam: '#4c3424', roof: '#94402b', roofD: '#6a2b1c', slate: '#5a5f66', slateD: '#3f444a', wood: '#7e5634', woodD: '#583a1f', trim: '#d8cdb3' },
  west2:  { wall: '#bbab8b', wallL: '#d3c5a5', wallD: '#8d7f63', plaster: '#efe3c6', beam: '#3d2b1d', roof: '#516178', roofD: '#39465a', slate: '#4a5568', slateD: '#333c4b', wood: '#7a5532', woodD: '#553a1e', trim: '#e2d6ba' },
  steppe: { wall: '#bfa47a', wallL: '#d5bf98', wallD: '#957e58', plaster: '#ece2c8', beam: '#6a4a2a', roof: '#e4d8bb', roofD: '#b9aa8c', slate: '#8a6a44', slateD: '#5e4428', wood: '#8a6a44', woodD: '#5e4428', felt: '#ede5cf', feltD: '#c3b797', pattern: '#a8352a', trim: '#d4b070' },
  byz:    { wall: '#e5ddcc', wallL: '#f3ede0', wallD: '#c0b6a2', plaster: '#f2ebdd', beam: '#7a5a3a', roof: '#bc5b3a', roofD: '#8f4128', slate: '#bc5b3a', slateD: '#8f4128', wood: '#86603a', woodD: '#5c3f22', dome: '#7e95a9', domeD: '#4e6377', gold: '#d6ad3d', trim: '#c9a050' },
};

const BLD_TOP = { towncenter: 130, castle: 140, wonder: 190, watchtower: 120, monastery: 110, university: 110, mill: 100, siegeworkshop: 110 };

function stoneBox(ctx, x0, y0, x1, y1, z0, z1, P, top = true) {
  box(ctx, x0, y0, x1, y1, z0, z1, top ? P.wallL : null, P.wall, P.wallD);
  bricksL(ctx, x0, x1, y1, z0, z1, 4.5, 0.32, 'rgba(60,50,40,0.35)');
  bricksR(ctx, x1, y0, y1, z0, z1, 4.5, 0.32, 'rgba(40,30,20,0.35)');
}
function plasterBox(ctx, x0, y0, x1, y1, z0, z1, P, timber = true) {
  box(ctx, x0, y0, x1, y1, z0, z1, null, P.plaster, shade(P.plaster, 0.78));
  if (timber) {
    const bL = P.beam, lw = 1.1;
    beamsL(ctx, x0, x1, y1, z0, z1, (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 0.45)), bL, lw);
    beamsR(ctx, x1, y0, y1, z0, z1, (y1 - y0) / Math.max(2, Math.round((y1 - y0) / 0.45)), shade(bL, 0.85), lw);
    const zm = (z0 + z1) / 2;
    line(ctx, iso(x0, y1, zm), iso(x1, y1, zm), bL, lw); line(ctx, iso(x1, y1, zm), iso(x1, y0, zm), bL, lw);
    line(ctx, iso(x0, y1, z1), iso(x1, y1, z1), bL, 1.4); line(ctx, iso(x1, y1, z1), iso(x1, y0, z1), bL, 1.4);
    line(ctx, iso(x0, y1, z0 + 0.5), iso(x1, y1, z0 + 0.5), bL, 1.4); line(ctx, iso(x1, y1, z0 + 0.5), iso(x1, y0, z0 + 0.5), bL, 1.4);
    // diagonal braces
    line(ctx, iso(x0, y1, z0), iso(x0 + (x1 - x0) * 0.3, y1, zm), bL, 0.9);
    line(ctx, iso(x1, y1, z0), iso(x1 - (x1 - x0) * 0.3, y1, zm), bL, 0.9);
  }
}
function woodBox(ctx, x0, y0, x1, y1, z0, z1, P) {
  box(ctx, x0, y0, x1, y1, z0, z1, null, P.wood, P.woodD);
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let z = z0 + 2.5; z < z1; z += 2.5) { line(ctx, iso(x0, y1, z), iso(x1, y1, z), P.woodD, 0.5); line(ctx, iso(x1, y1, z), iso(x1, y0, z), shade(P.woodD, 0.7), 0.5); }
  ctx.restore();
}
function merlonsL(ctx, x0, x1, y, z, P, d = 0.16, h = 3.5) {
  for (let x = x0; x < x1 - 0.05; x += d * 2) box(ctx, x, y - d, Math.min(x1, x + d), y, z, z + h, P.wallL, P.wall, P.wallD);
}
function merlonsR(ctx, x, y0, y1, z, P, d = 0.16, h = 3.5) {
  for (let y = y0; y < y1 - 0.05; y += d * 2) box(ctx, x - d, y, x, Math.min(y1, y + d), z, z + h, P.wallL, P.wall, P.wallD);
}
function banner(ctx, x, y, z, col, h = 10, face = 'L') {
  const w = 0.16;
  const pts = face === 'L'
    ? [iso(x - w, y, z), iso(x + w, y, z), iso(x + w, y, z - h), iso(x, y, z - h - 3), iso(x - w, y, z - h)]
    : [iso(x, y + w, z), iso(x, y - w, z), iso(x, y - w, z - h), iso(x, y, z - h - 3), iso(x, y + w, z - h)];
  poly(ctx, pts, col.main, col.dark, 0.6);
  const c = face === 'L' ? iso(x, y, z - h * 0.45) : iso(x, y, z - h * 0.45);
  ctx.fillStyle = col.light; ctx.beginPath(); ctx.arc(c[0], c[1], 1.4, 0, Math.PI * 2); ctx.fill();
}
function groundPad(ctx, s, col = 'rgba(70,55,35,0.35)', inset = -0.1) {
  poly(ctx, [iso(inset, inset), iso(s - inset, inset), iso(s - inset, s - inset), iso(inset, s - inset)], col);
}
function yurt(ctx, cx, cy, r, h, P, col, z = 0) {
  const [sx, sy, rx] = cylinder(ctx, cx, cy, z, z + h, r, P.felt, P.feltD);
  // decorative band
  ctx.save();
  ctx.beginPath(); ctx.ellipse(sx, sy + h * 0.45, rx, rx * 0.5, 0, 0, Math.PI); ctx.strokeStyle = P.pattern; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  const top = dome(ctx, cx, cy, z + h, r * 1.02, h * 0.75, P.roof, P.roofD);
  ctx.fillStyle = P.wood; ctx.beginPath(); ctx.arc(top[0], top[1] + 1, 2.2, 0, Math.PI * 2); ctx.fill();
  // door facing the viewer
  const [dx, dy] = iso(cx + r * 0.7, cy + r * 0.7, z);
  ctx.fillStyle = P.pattern; ctx.fillRect(dx - 2.5, dy - h * 0.7, 5, h * 0.7);
  ctx.strokeStyle = '#5a1a12'; ctx.lineWidth = 0.6; ctx.strokeRect(dx - 2.5, dy - h * 0.7, 5, h * 0.7);
  return top;
}
function scaffolding(ctx, x0, y0, x1, y1, h) {
  ctx.save();
  ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1;
  for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 3) line(ctx, iso(x, y1 + 0.12, 0), iso(x, y1 + 0.12, h), '#8a6a3a', 1);
  for (let y = y0; y <= y1 + 0.01; y += (y1 - y0) / 3) line(ctx, iso(x1 + 0.12, y, 0), iso(x1 + 0.12, y, h), '#7a5a2a', 1);
  for (let z = 6; z < h; z += 9) {
    line(ctx, iso(x0, y1 + 0.12, z), iso(x1 + 0.12, y1 + 0.12, z), '#a07a40', 1.3);
    line(ctx, iso(x1 + 0.12, y1 + 0.12, z), iso(x1 + 0.12, y0, z), '#8a6a34', 1.3);
  }
  ctx.restore();
}
function foundation(ctx, s, P) {
  poly(ctx, [iso(0.05, 0.05), iso(s - 0.05, 0.05), iso(s - 0.05, s - 0.05), iso(0.05, s - 0.05)], 'rgba(120,96,62,0.75)', 'rgba(60,45,25,0.8)', 1);
  ctx.save(); ctx.globalAlpha = 0.6;
  for (let i = 0.5; i < s; i += 0.5) {
    line(ctx, iso(i, 0.05), iso(i, s - 0.05), 'rgba(90,70,40,0.6)', 0.5);
    line(ctx, iso(0.05, i), iso(s - 0.05, i), 'rgba(90,70,40,0.6)', 0.5);
  }
  ctx.restore();
  // corner stakes and some materials
  for (const [x, y] of [[0.15, 0.15], [s - 0.15, 0.15], [s - 0.15, s - 0.15], [0.15, s - 0.15]]) line(ctx, iso(x, y, 0), iso(x, y, 8), '#7a5a2a', 1.2);
  if (s >= 2) {
    box(ctx, s * 0.55, s * 0.6, s * 0.55 + 0.4, s * 0.6 + 0.3, 0, 4, P.wallL, P.wall, P.wallD);
    for (let k = 0; k < 3; k++) box(ctx, s * 0.25, s * 0.3 + k * 0.12, s * 0.25 + 0.6, s * 0.3 + k * 0.12 + 0.1, k * 1.5, k * 1.5 + 1.5, P.wood, P.wood, P.woodD);
  }
}

// Main volume for each building type: [x0,y0,x1,y1,height] in footprint units
function mainVolume(type, s) {
  switch (type) {
    case 'house': return [0.25, 0.25, 1.75, 1.75, 17];
    case 'towncenter': return [0.3, 0.3, 3.7, 3.7, 24];
    case 'castle': return [0.25, 0.25, 3.75, 3.75, 28];
    case 'wonder': return [0.5, 0.5, 4.5, 4.5, 36];
    case 'watchtower': return [0.15, 0.15, 0.85, 0.85, 40];
    case 'mill': case 'lumbercamp': case 'miningcamp': return [0.3, 0.3, 1.7, 1.7, 14];
    case 'siegeworkshop': return [0.3, 0.3, 3.7, 2.8, 22];
    default: return [0.3, 0.3, s - 0.3, s - 0.3, 20];
  }
}

// ------------------------------------------------------------------ individual buildings
const BUILD_DRAW = {
  house(ctx, s, P, col, style) {
    groundPad(ctx, s);
    if (style === 'steppe') { yurt(ctx, 1, 1, 0.68, 13, P, col); return; }
    if (style === 'byz') {
      box(ctx, 0.3, 0.3, 1.7, 1.7, 0, 17, null, P.plaster, shade(P.plaster, 0.8));
      doorL(ctx, 1.0, 1.7, 0.3, 9, '#4a3020');
      winR(ctx, 1.7, 0.8, 9, 0.18, 4); winR(ctx, 1.7, 1.25, 9, 0.18, 4);
      roofHip(ctx, 0.3, 0.3, 1.7, 1.7, 17, 9, 0.1, P.roof, P.roofD, shade(P.roofD, 0.8));
      return;
    }
    plasterBox(ctx, 0.3, 0.35, 1.7, 1.65, 0, 16, P);
    doorL(ctx, 1.1, 1.65, 0.32, 9, '#3a2616');
    winR(ctx, 1.7, 0.75, 8, 0.22, 4, '#2a2018'); winR(ctx, 1.7, 1.3, 8, 0.22, 4, '#2a2018');
    box(ctx, 0.55, 0.55, 0.75, 0.75, 16, 30, P.wallL, P.wall, P.wallD);
    roofGableX(ctx, 0.3, 0.35, 1.7, 1.65, 16, 13, 0.12, P.roof, shade(P.roof, 0.85), P.plaster, shade(P.roofD, 0.9));
  },
  towncenter(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(90,75,50,0.45)', -0.2);
    if (style === 'steppe') {
      box(ctx, 0.2, 0.2, 3.8, 3.8, 0, 4, P.wood, P.wood, P.woodD);
      yurt(ctx, 0.95, 0.95, 0.55, 12, P, col, 4);
      yurt(ctx, 3.0, 0.9, 0.5, 11, P, col, 4);
      const top = yurt(ctx, 2.1, 2.1, 1.25, 26, P, col, 4);
      flag(ctx, top[0], top[1], 22, col.main, col.dark, true, 14, 8);
      yurt(ctx, 0.85, 3.1, 0.5, 11, P, col, 4);
      return;
    }
    if (style === 'byz') {
      stoneBox(ctx, 0.3, 0.3, 3.7, 3.7, 0, 26, P);
      for (let i = 0; i < 3; i++) { doorL(ctx, 1.0 + i * 0.9, 3.7, 0.4, 13, '#3e2e20'); winR(ctx, 3.7, 0.9 + i * 0.9, 12, 0.3, 8, '#3e2e20'); }
      for (const [x, y] of [[0.35, 0.35], [3.65, 0.35], [0.35, 3.65]]) { cylinder(ctx, x, y, 0, 34, 0.3, P.wallL, P.wallD); dome(ctx, x, y, 34, 0.3, 7, P.dome, P.domeD); }
      cylinder(ctx, 2, 2, 26, 38, 1.0, P.wallL, P.wallD);
      const t = dome(ctx, 2, 2, 38, 1.0, 26, P.dome, P.domeD);
      line(ctx, [t[0], t[1]], [t[0], t[1] - 9], P.gold, 1.4); line(ctx, [t[0] - 3, t[1] - 6], [t[0] + 3, t[1] - 6], P.gold, 1.4);
      cylinder(ctx, 3.65, 3.65, 0, 34, 0.3, P.wallL, P.wallD); dome(ctx, 3.65, 3.65, 34, 0.3, 7, P.dome, P.domeD);
      banner(ctx, 2.0, 3.7, 24, col, 12);
      return;
    }
    stoneBox(ctx, 0.3, 0.3, 3.7, 3.7, 0, 22, P);
    doorL(ctx, 2.0, 3.7, 0.7, 14, '#2e2014', '#5a4630');
    winR(ctx, 3.7, 1.2, 12, 0.3, 6); winR(ctx, 3.7, 2.7, 12, 0.3, 6);
    winL(ctx, 1.0, 3.7, 12, 0.3, 6); winL(ctx, 3.0, 3.7, 12, 0.3, 6);
    plasterBox(ctx, 0.8, 0.8, 3.2, 3.2, 22, 38, P);
    for (let i = 0; i < 2; i++) { winL(ctx, 1.4 + i * 1.2, 3.2, 27, 0.3, 6, '#2a2018'); winR(ctx, 3.2, 1.4 + i * 1.2, 27, 0.3, 6, '#2a2018'); }
    roofHip(ctx, 0.8, 0.8, 3.2, 3.2, 38, 22, 0.25, P.roof, P.roofD, shade(P.roofD, 0.85));
    box(ctx, 1.75, 1.75, 2.25, 2.25, 52, 70, P.wallL, P.wall, P.wallD);
    winL(ctx, 2.0, 2.25, 60, 0.18, 6, '#1a1410');
    roofHip(ctx, 1.75, 1.75, 2.25, 2.25, 70, 14, 0.06, P.roof, P.roofD);
    const t = iso(2, 2, 84);
    flag(ctx, t[0], t[1], 16, col.main, col.dark, true, 13, 7);
    banner(ctx, 1.1, 3.7, 20, col, 10); banner(ctx, 3.7, 1.1, 20, col, 10, 'R');
  },
  barracks(ctx, s, P, col, style) {
    groundPad(ctx, s);
    if (style === 'steppe') {
      woodBox(ctx, 0.3, 0.3, 2.7, 2.7, 0, 16, P);
      doorL(ctx, 1.5, 2.7, 0.5, 11, '#2a1a0e');
      const t = cone(ctx, 1.5, 1.5, 16, 1.6, 24, P.roof, P.roofD);
      flag(ctx, t[0], t[1], 12, col.main, col.dark, true);
    } else {
      stoneBox(ctx, 0.3, 0.3, 2.7, 2.7, 0, 20, P);
      doorL(ctx, 1.5, 2.7, 0.55, 12, '#2a1c12', '#5a4630');
      winR(ctx, 2.7, 1.0, 11, 0.25, 5); winR(ctx, 2.7, 2.0, 11, 0.25, 5);
      if (style === 'byz') roofHip(ctx, 0.3, 0.3, 2.7, 2.7, 20, 12, 0.12, P.roof, P.roofD, shade(P.roofD, 0.8));
      else roofGableY(ctx, 0.3, 0.3, 2.7, 2.7, 20, 16, 0.15, P.slate, shade(P.slate, 0.85), P.wall, shade(P.slateD, 0.9));
      merlonsL(ctx, 0.3, 2.7, 2.7, 20, P, 0.15, 3);
    }
    banner(ctx, 0.8, 2.7, 18, col, 10); banner(ctx, 2.2, 2.7, 18, col, 10);
    // weapon rack
    for (let i = 0; i < 4; i++) line(ctx, iso(2.85, 2.95 + i * 0.1, 0), iso(2.85, 2.9 + i * 0.1, 11), '#7a5a30', 0.9);
    line(ctx, iso(2.85, 2.9, 8), iso(2.85, 3.3, 8), '#5a3a1a', 1.2);
  },
  archeryrange(ctx, s, P, col, style) {
    groundPad(ctx, s);
    // back wall
    if (style === 'steppe') woodBox(ctx, 0.3, 0.3, 2.7, 1.3, 0, 15, P);
    else box(ctx, 0.3, 0.3, 2.7, 1.3, 0, 15, null, style === 'byz' ? P.plaster : P.wood, style === 'byz' ? shade(P.plaster, 0.8) : P.woodD);
    // posts
    for (const x of [0.4, 1.5, 2.6]) box(ctx, x - 0.06, 1.85, x + 0.06, 1.97, 0, 15, P.wood, P.wood, P.woodD);
    roofGableX(ctx, 0.3, 0.3, 2.7, 1.95, 15, 10, 0.1, style === 'byz' ? P.roof : P.slate, shade(style === 'byz' ? P.roof : P.slate, 0.85), P.wood);
    // targets
    for (const [x, y] of [[0.9, 2.55], [2.1, 2.45]]) {
      line(ctx, iso(x, y, 0), iso(x - 0.1, y, 10), '#6a4a24', 1.2); line(ctx, iso(x, y, 0), iso(x + 0.1, y, 10), '#6a4a24', 1.2);
      const [cx, cy] = iso(x, y, 11);
      ctx.fillStyle = '#d8c278'; ctx.beginPath(); ctx.ellipse(cx, cy, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c03020'; ctx.beginPath(); ctx.ellipse(cx, cy, 3.2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0e0b0'; ctx.beginPath(); ctx.ellipse(cx, cy, 1.4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    banner(ctx, 1.5, 1.97, 14, col, 8);
  },
  stable(ctx, s, P, col, style) {
    groundPad(ctx, s);
    woodBox(ctx, 0.3, 0.5, 2.7, 2.2, 0, 15, P);
    for (let i = 0; i < 3; i++) {
      const x = 0.7 + i * 0.75;
      poly(ctx, [iso(x - 0.22, 2.2, 0), iso(x + 0.22, 2.2, 0), iso(x + 0.22, 2.2, 10), iso(x - 0.22, 2.2, 10)], '#2a1a0e');
      poly(ctx, [iso(x - 0.22, 2.2, 0), iso(x + 0.22, 2.2, 0), iso(x + 0.22, 2.2, 5), iso(x - 0.22, 2.2, 5)], P.woodD, '#3a2410', 0.6);
    }
    if (style === 'byz') roofHip(ctx, 0.3, 0.5, 2.7, 2.2, 15, 9, 0.12, P.roof, P.roofD);
    else roofGableX(ctx, 0.3, 0.5, 2.7, 2.2, 15, 12, 0.12, style === 'steppe' ? P.roof : P.slate, shade(style === 'steppe' ? P.roof : P.slate, 0.85), P.wood, 'rgba(0,0,0,0.15)');
    // hay bales
    box(ctx, 2.75, 2.45, 3.1, 2.75, 0, 5, '#e2c45a', '#c9a840', '#a88a2a');
    box(ctx, 2.3, 2.55, 2.65, 2.85, 0, 5, '#e2c45a', '#c9a840', '#a88a2a');
    // horse-head sign
    const [hx, hy] = iso(2.7, 1.3, 12);
    ctx.fillStyle = col.main; ctx.fillRect(hx - 2, hy - 6, 6, 7);
    ctx.fillStyle = '#e8dcc0'; ctx.beginPath(); ctx.moveTo(hx - 0.5, hy); ctx.lineTo(hx + 0.5, hy - 5); ctx.lineTo(hx + 3, hy - 3.5); ctx.lineTo(hx + 1.6, hy); ctx.fill();
  },
  blacksmith(ctx, s, P, col, style) {
    groundPad(ctx, s);
    if (style === 'byz') box(ctx, 0.3, 0.3, 2.7, 2.7, 0, 18, null, P.plaster, shade(P.plaster, 0.8)); else stoneBox(ctx, 0.3, 0.3, 2.7, 2.7, 0, 18, P, false);
    poly(ctx, [iso(1.2, 2.7, 0), iso(2.0, 2.7, 0), iso(2.0, 2.7, 10), iso(1.2, 2.7, 10)], '#2a1810');
    poly(ctx, [iso(1.35, 2.7, 1), iso(1.85, 2.7, 1), iso(1.85, 2.7, 5), iso(1.35, 2.7, 5)], '#ff8a2a');
    poly(ctx, [iso(1.45, 2.7, 1.5), iso(1.75, 2.7, 1.5), iso(1.75, 2.7, 3.5), iso(1.45, 2.7, 3.5)], '#ffe080');
    winR(ctx, 2.7, 1.3, 9, 0.3, 5);
    roofHip(ctx, 0.3, 0.3, 2.7, 2.7, 18, 13, 0.12, style === 'byz' ? P.roof : P.slate, style === 'byz' ? P.roofD : P.slateD);
    box(ctx, 0.5, 0.5, 0.95, 0.95, 18, 46, P.wallL, P.wall, P.wallD);
    box(ctx, 0.45, 0.45, 1.0, 1.0, 44, 48, '#3a3430', P.wallD, shade(P.wallD, 0.8));
    // anvil
    const [ax, ay] = iso(2.2, 3.0, 0);
    ctx.fillStyle = '#3e4146'; ctx.fillRect(ax - 3, ay - 5, 7, 2.4); ctx.fillRect(ax - 1, ay - 3, 3, 3);
    ctx.fillStyle = '#5a5e64'; ctx.beginPath(); ctx.moveTo(ax + 4, ay - 5); ctx.lineTo(ax + 7, ay - 4); ctx.lineTo(ax + 4, ay - 2.6); ctx.fill();
    banner(ctx, 0.8, 2.7, 15, col, 8);
  },
  market(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(120,100,60,0.4)');
    if (style === 'byz') box(ctx, 0.3, 0.3, 2.7, 1.3, 0, 15, null, P.plaster, shade(P.plaster, 0.8)); else plasterBox(ctx, 0.3, 0.3, 2.7, 1.3, 0, 15, P, style !== 'steppe');
    roofGableX(ctx, 0.3, 0.3, 2.7, 1.3, 15, 9, 0.1, P.roof, shade(P.roof, 0.85), P.plaster);
    const stall = (x0, y0, c1, c2) => {
      for (const [x, y] of [[x0, y0], [x0 + 0.8, y0], [x0 + 0.8, y0 + 0.7], [x0, y0 + 0.7]]) line(ctx, iso(x, y, 0), iso(x, y, 10), '#6a4a24', 1);
      // striped awning
      for (let i = 0; i < 4; i++) {
        const a = x0 + i * 0.2;
        poly(ctx, [iso(a, y0 - 0.05, 12), iso(a + 0.2, y0 - 0.05, 12), iso(a + 0.2, y0 + 0.75, 8), iso(a, y0 + 0.75, 8)], i % 2 ? c1 : c2, 'rgba(0,0,0,0.25)', 0.4);
      }
      box(ctx, x0 + 0.1, y0 + 0.1, x0 + 0.7, y0 + 0.6, 0, 4, '#a07a44', '#8a6634', '#6a4c26');
      const r = mulberry32(Math.floor(x0 * 100 + y0 * 10));
      for (let k = 0; k < 6; k++) {
        const [fx, fy] = iso(x0 + 0.2 + r() * 0.4, y0 + 0.2 + r() * 0.3, 5);
        ctx.fillStyle = ['#d03a2a', '#e8b030', '#6aa83a', '#8a3ac0'][k % 4];
        ctx.beginPath(); ctx.arc(fx, fy, 1.4, 0, Math.PI * 2); ctx.fill();
      }
    };
    stall(0.4, 1.7, col.main, '#f0e8d8');
    stall(1.6, 1.8, '#e8b030', '#f0e8d8');
    // crates and amphorae
    box(ctx, 2.5, 2.6, 2.85, 2.9, 0, 4, '#a07a44', '#8a6634', '#6a4c26');
    const [ax, ay] = iso(0.5, 2.85, 0);
    ctx.fillStyle = '#b8643a'; ctx.beginPath(); ctx.ellipse(ax, ay - 4, 2.4, 4, 0, 0, Math.PI * 2); ctx.fill();
  },
  mill(ctx, s, P, col, style) {
    groundPad(ctx, s);
    if (style === 'steppe') woodBox(ctx, 0.5, 0.5, 1.5, 1.5, 0, 26, P);
    else if (style === 'byz') box(ctx, 0.5, 0.5, 1.5, 1.5, 0, 26, null, P.plaster, shade(P.plaster, 0.8));
    else { stoneBox(ctx, 0.5, 0.5, 1.5, 1.5, 0, 12, P, false); plasterBox(ctx, 0.5, 0.5, 1.5, 1.5, 12, 26, P); }
    doorL(ctx, 1.0, 1.5, 0.3, 8, '#3a2616');
    winR(ctx, 1.5, 1.0, 16, 0.2, 4);
    roofHip(ctx, 0.5, 0.5, 1.5, 1.5, 26, 15, 0.1, style === 'byz' ? P.roof : P.slate, style === 'byz' ? P.roofD : P.slateD);
    // grain sacks
    box(ctx, 1.6, 1.55, 1.85, 1.8, 0, 4, '#e0d0a0', '#c8b888', '#a89868');
    box(ctx, 1.65, 1.2, 1.88, 1.45, 0, 3.5, '#e0d0a0', '#c8b888', '#a89868');
    // hub (blades are animated by the renderer)
    const [hx, hy] = iso(1.5, 1.0, 22);
    ctx.fillStyle = '#4a3420'; ctx.beginPath(); ctx.arc(hx + 2, hy, 2, 0, Math.PI * 2); ctx.fill();
    banner(ctx, 0.75, 1.5, 22, col, 6);
  },
  lumbercamp(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(90,70,40,0.4)');
    for (const [x, y] of [[0.35, 0.35], [1.65, 0.35], [1.65, 1.1], [0.35, 1.1]]) box(ctx, x - 0.05, y - 0.05, x + 0.05, y + 0.05, 0, x > 1 ? 13 : 16, P.wood, P.wood, P.woodD);
    // lean-to roof
    poly(ctx, [iso(0.25, 0.25, 17), iso(1.75, 0.25, 17), iso(1.75, 1.2, 13), iso(0.25, 1.2, 13)], style === 'byz' ? P.roof : P.wood, OUTLINE, 0.6);
    for (let x = 0.4; x < 1.75; x += 0.25) line(ctx, iso(x, 0.25, 17), iso(x, 1.2, 13), shade(P.woodD, 0.9), 0.6);
    // log piles
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
      const [lx, ly] = iso(0.5 + i * 0.28 + row * 0.14, 1.55, 2.2 + row * 3.2);
      ctx.fillStyle = '#6a4424'; ctx.beginPath(); ctx.ellipse(lx, ly, 2.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9b47c'; ctx.beginPath(); ctx.ellipse(lx + 0.4, ly, 1.8, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(lx + 0.4, ly, 0.8, 0, Math.PI * 2); ctx.stroke();
    }
    // stump with axe
    const [sx, sy] = iso(1.7, 1.7, 0);
    ctx.fillStyle = '#7a5230'; ctx.fillRect(sx - 3, sy - 5, 6, 5);
    ctx.fillStyle = '#c8a070'; ctx.beginPath(); ctx.ellipse(sx, sy - 5, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    line(ctx, [sx, sy - 5], [sx + 4, sy - 11], '#6a4a24', 1.2);
    ctx.fillStyle = STEEL; ctx.beginPath(); ctx.moveTo(sx - 0.5, sy - 4.5); ctx.lineTo(sx + 2.5, sy - 7); ctx.lineTo(sx + 1, sy - 3); ctx.fill();
    banner(ctx, 0.35, 1.15, 14, col, 6);
  },
  miningcamp(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(90,80,70,0.4)');
    for (const [x, y] of [[0.35, 0.35], [1.65, 0.35], [1.65, 1.1], [0.35, 1.1]]) box(ctx, x - 0.05, y - 0.05, x + 0.05, y + 0.05, 0, x > 1 ? 13 : 16, P.wood, P.wood, P.woodD);
    poly(ctx, [iso(0.25, 0.25, 17), iso(1.75, 0.25, 17), iso(1.75, 1.2, 13), iso(0.25, 1.2, 13)], style === 'byz' ? P.roof : P.slate, OUTLINE, 0.6);
    // ore piles
    const pile = (x, y, c1, c2) => {
      const [px, py] = iso(x, y, 0);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.moveTo(px - 7, py); ctx.quadraticCurveTo(px, py - 11, px + 7, py); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c2; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(px - 4 + k * 2, py - 2 - (k % 2) * 3, 1.1, 0, Math.PI * 2); ctx.fill(); }
    };
    pile(0.6, 1.6, '#8a8880', '#c4c2b8');
    pile(1.2, 1.75, '#8a7a5a', '#e8c040');
    // mine cart
    const [cx, cy] = iso(1.7, 1.4, 0);
    ctx.fillStyle = '#5a4a3a'; ctx.fillRect(cx - 4, cy - 7, 8, 4.5);
    ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.arc(cx - 1, cy - 7.5, 1.6, 0, Math.PI * 2); ctx.arc(cx + 1.5, cy - 7.2, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(cx - 2.5, cy - 2, 1.4, 0, Math.PI * 2); ctx.arc(cx + 2.5, cy - 2, 1.4, 0, Math.PI * 2); ctx.fill();
    banner(ctx, 0.35, 1.15, 14, col, 6);
  },
  farm(ctx, s, P, col, style, extra) {
    const stage = extra || 'f3';
    poly(ctx, [iso(0.05, 0.05), iso(2.95, 0.05), iso(2.95, 2.95), iso(0.05, 2.95)], '#7a5a34', 'rgba(60,40,20,0.6)', 1);
    // furrows
    ctx.save();
    for (let i = 0; i < 12; i++) {
      const y = 0.2 + i * 0.22;
      line(ctx, iso(0.15, y), iso(2.85, y), 'rgba(60,40,20,0.55)', 1.2);
      line(ctx, iso(0.15, y + 0.08), iso(2.85, y + 0.08), 'rgba(150,120,80,0.35)', 0.6);
    }
    const crops = { f3: ['#d8b848', '#c8a038', 4.5], f2: ['#a8b048', '#8a9a38', 3.5], f1: ['#7aa040', '#5a8030', 2.4], f0: null, b: null }[stage];
    if (crops) {
      const r = mulberry32(99);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 14; j++) {
        if (stage === 'f1' && r() < 0.4) continue;
        const [x, y] = iso(0.2 + j * 0.19 + r() * 0.04, 0.22 + i * 0.22);
        ctx.strokeStyle = r() < 0.5 ? crops[0] : crops[1]; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 0.6, y - crops[2]); ctx.moveTo(x, y); ctx.lineTo(x + 0.8, y - crops[2] * 0.9); ctx.stroke();
      }
    }
    ctx.restore();
    // fence posts
    for (const [x, y] of [[0.05, 0.05], [2.95, 0.05], [2.95, 2.95], [0.05, 2.95], [1.5, 2.95], [2.95, 1.5]]) line(ctx, iso(x, y, 0), iso(x, y, 5), '#6a4a24', 1.2);
  },
  university(ctx, s, P, col, style) {
    groundPad(ctx, s);
    if (style === 'byz' || style === 'steppe') box(ctx, 0.3, 0.3, 2.7, 2.7, 0, 22, P.wallL, P.plaster, shade(P.plaster, 0.8)); else stoneBox(ctx, 0.3, 0.3, 2.7, 2.7, 0, 22, P);
    // colonnade
    for (let i = 0; i < 5; i++) { const x = 0.55 + i * 0.5; box(ctx, x - 0.06, 2.72, x + 0.06, 2.84, 0, 18, P.wallL, P.wallL, P.wall); }
    poly(ctx, [iso(0.3, 2.86, 18), iso(2.7, 2.86, 18), iso(2.7, 2.86, 22), iso(0.3, 2.86, 22)], P.wallL, OUTLINE, 0.6);
    winR(ctx, 2.7, 1.0, 12, 0.25, 7); winR(ctx, 2.7, 1.8, 12, 0.25, 7);
    roofHip(ctx, 0.3, 0.3, 2.7, 2.7, 22, 9, 0.1, style === 'byz' ? P.roof : P.slate, style === 'byz' ? P.roofD : P.slateD);
    cylinder(ctx, 0.9, 0.9, 22, 40, 0.42, P.wallL, P.wallD);
    const t = dome(ctx, 0.9, 0.9, 40, 0.45, 12, style === 'byz' ? P.dome : '#7a8a6a', style === 'byz' ? P.domeD : '#4a5a3a');
    line(ctx, [t[0] - 2, t[1] + 5], [t[0] + 8, t[1] - 2], '#c0a050', 1.6);
    banner(ctx, 1.5, 2.86, 16, col, 8);
  },
  monastery(ctx, s, P, col, style) {
    groundPad(ctx, s);
    const wall = style === 'byz' || style === 'steppe' ? 'plaster' : 'stone';
    if (wall === 'stone') stoneBox(ctx, 0.3, 0.7, 2.6, 2.3, 0, 22, P, false); else box(ctx, 0.3, 0.7, 2.6, 2.3, 0, 22, null, P.plaster, shade(P.plaster, 0.8));
    for (let i = 0; i < 3; i++) winL(ctx, 0.8 + i * 0.7, 2.3, 9, 0.18, 9, '#3a3a6a');
    if (style === 'byz') {
      roofHip(ctx, 0.3, 0.7, 2.6, 2.3, 22, 8, 0.08, P.roof, P.roofD);
      cylinder(ctx, 1.45, 1.5, 26, 32, 0.6, P.wallL, P.wallD);
      const t = dome(ctx, 1.45, 1.5, 32, 0.6, 14, P.dome, P.domeD);
      line(ctx, [t[0], t[1]], [t[0], t[1] - 8], P.gold, 1.3); line(ctx, [t[0] - 2.5, t[1] - 5.5], [t[0] + 2.5, t[1] - 5.5], P.gold, 1.3);
    } else {
      roofGableX(ctx, 0.3, 0.7, 2.6, 2.3, 22, 15, 0.1, style === 'steppe' ? P.roof : P.roof, P.roofD, wall === 'stone' ? P.wall : P.plaster, shade(P.roofD, 0.9));
      // bell tower
      stoneBox(ctx, 2.2, 1.9, 2.8, 2.5, 0, 46, P);
      poly(ctx, [iso(2.35, 2.5, 34), iso(2.65, 2.5, 34), iso(2.65, 2.5, 40), iso(2.35, 2.5, 40)], '#1a1410');
      roofHip(ctx, 2.2, 1.9, 2.8, 2.5, 46, 18, 0.05, P.slate, P.slateD);
      const t = iso(2.5, 2.2, 64);
      line(ctx, [t[0], t[1]], [t[0], t[1] - 8], '#d8b84a', 1.3); line(ctx, [t[0] - 2.5, t[1] - 5.5], [t[0] + 2.5, t[1] - 5.5], '#d8b84a', 1.3);
    }
    doorL(ctx, 1.4, 2.3, 0.35, 12, '#3a2414', '#6a4a2a');
    banner(ctx, 0.6, 2.3, 18, col, 9);
  },
  siegeworkshop(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(100,80,50,0.4)');
    woodBox(ctx, 0.3, 0.3, 3.7, 2.6, 0, 22, P);
    poly(ctx, [iso(1.2, 2.6, 0), iso(2.8, 2.6, 0), iso(2.8, 2.6, 16), iso(1.2, 2.6, 16)], '#2a1a0e');
    // a ram being built inside
    poly(ctx, [iso(1.5, 2.6, 2), iso(2.5, 2.6, 2), iso(2.3, 2.6, 10), iso(1.7, 2.6, 10)], '#8a6a3a');
    roofGableX(ctx, 0.3, 0.3, 3.7, 2.6, 22, 16, 0.12, style === 'byz' ? P.roof : P.slate, shade(style === 'byz' ? P.roof : P.slate, 0.85), P.wood, 'rgba(0,0,0,0.15)');
    // crane
    line(ctx, iso(3.5, 3.3, 0), iso(3.5, 3.3, 46), '#6a4a24', 2);
    line(ctx, iso(3.5, 3.3, 44), iso(2.8, 3.3, 52), '#6a4a24', 1.6);
    line(ctx, iso(2.85, 3.3, 51), iso(2.85, 3.3, 30), '#c8b080', 0.6);
    box(ctx, 2.75, 3.2, 2.95, 3.4, 26, 30, '#8a8478', '#6a6458', '#4a4438');
    // lumber
    for (let i = 0; i < 3; i++) box(ctx, 0.4, 2.9 + i * 0.13, 1.4, 3.0 + i * 0.13, 0, 2 + i, P.wood, P.wood, P.woodD);
    banner(ctx, 0.8, 2.6, 18, col, 10); banner(ctx, 3.3, 2.6, 18, col, 10);
  },
  castle(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(80,70,55,0.5)', -0.2);
    const H = 26, TH = 38;
    const tower = (x, y) => {
      if (style === 'byz') {
        stoneBox(ctx, x - 0.42, y - 0.42, x + 0.42, y + 0.42, 0, TH, P);
        merlonsL(ctx, x - 0.42, x + 0.42, y + 0.42, TH, P, 0.14, 3); merlonsR(ctx, x + 0.42, y - 0.42, y + 0.42, TH, P, 0.14, 3);
        dome(ctx, x, y, TH, 0.33, 9, P.dome, P.domeD);
      } else {
        const [sx, sy, rx] = cylinder(ctx, x, y, 0, TH, 0.45, P.wall, P.wallD, P.wallL);
        ctx.save(); ctx.strokeStyle = 'rgba(50,40,30,0.3)'; ctx.lineWidth = 0.5;
        for (let z = 4; z < TH; z += 4.5) { ctx.beginPath(); ctx.ellipse(sx, sy + (TH - z), rx, rx * 0.5, 0, 0, Math.PI); ctx.stroke(); }
        ctx.restore();
        cone(ctx, x, y, TH, 0.52, style === 'steppe' ? 12 : 20, style === 'steppe' ? P.roof : P.slate, style === 'steppe' ? P.roofD : P.slateD);
      }
    };
    const wallSeg = (x0, y0, x1, y1) => { stoneBox(ctx, x0, y0, x1, y1, 0, H, P); };
    // back: top corner tower, back walls
    tower(0.5, 0.5);
    wallSeg(0.5, 0.3, 3.5, 0.75); merlonsL(ctx, 0.5, 3.5, 0.75, H, P);
    wallSeg(0.3, 0.5, 0.75, 3.5); merlonsR(ctx, 0.75, 0.5, 3.5, H, P);
    tower(3.5, 0.5); tower(0.5, 3.5);
    // keep
    stoneBox(ctx, 1.2, 1.2, 2.8, 2.8, 0, 52, P);
    merlonsL(ctx, 1.2, 2.8, 2.8, 52, P); merlonsR(ctx, 2.8, 1.2, 2.8, 52, P);
    winL(ctx, 1.6, 2.8, 36, 0.12, 6); winL(ctx, 2.4, 2.8, 36, 0.12, 6); winR(ctx, 2.8, 2.0, 36, 0.12, 6);
    const t = iso(2, 2, 56);
    flag(ctx, t[0], t[1], 20, col.main, col.dark, true, 15, 8);
    // front walls
    wallSeg(0.5, 3.25, 3.5, 3.7); merlonsL(ctx, 0.5, 3.5, 3.7, H, P);
    wallSeg(3.25, 0.5, 3.7, 3.5); merlonsR(ctx, 3.7, 0.5, 3.5, H, P);
    doorL(ctx, 2.0, 3.7, 0.6, 16, '#2a1c12', '#4a3a28');
    banner(ctx, 1.2, 3.7, 22, col, 12); banner(ctx, 2.8, 3.7, 22, col, 12); banner(ctx, 3.7, 1.4, 22, col, 12, 'R'); banner(ctx, 3.7, 2.6, 22, col, 12, 'R');
    tower(3.5, 3.5);
  },
  watchtower(ctx, s, P, col, style) {
    groundPad(ctx, 1, 'rgba(70,55,35,0.35)', -0.1);
    if (style === 'steppe') {
      for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) line(ctx, iso(x, y, 0), iso(x, y, 46), '#6a4a24', 2);
      line(ctx, iso(0.2, 0.8, 10), iso(0.8, 0.8, 30), '#5a3a1a', 1); line(ctx, iso(0.8, 0.8, 10), iso(0.8, 0.2, 30), '#5a3a1a', 1);
      box(ctx, 0.08, 0.08, 0.92, 0.92, 46, 54, P.wood, P.wood, P.woodD);
      const t = cone(ctx, 0.5, 0.5, 54, 0.5, 16, P.roof, P.roofD);
      flag(ctx, t[0], t[1], 10, col.main, col.dark, true, 8, 5);
      return;
    }
    if (style === 'byz') { box(ctx, 0.18, 0.18, 0.82, 0.82, 0, 50, P.wallL, P.plaster, shade(P.plaster, 0.8)); }
    else stoneBox(ctx, 0.18, 0.18, 0.82, 0.82, 0, 50, P);
    winL(ctx, 0.5, 0.82, 30, 0.08, 6); winR(ctx, 0.82, 0.5, 38, 0.08, 6);
    doorL(ctx, 0.5, 0.82, 0.22, 8, '#2a1c12');
    box(ctx, 0.08, 0.08, 0.92, 0.92, 50, 56, P.wallL, P.wall, P.wallD);
    merlonsL(ctx, 0.08, 0.92, 0.92, 56, P, 0.12, 3); merlonsR(ctx, 0.92, 0.08, 0.92, 56, P, 0.12, 3);
    let t;
    if (style === 'byz') t = dome(ctx, 0.5, 0.5, 58, 0.36, 10, P.dome, P.domeD);
    else { roofHip(ctx, 0.12, 0.12, 0.88, 0.88, 58, 18, 0.04, P.slate, P.slateD); t = iso(0.5, 0.5, 76); }
    flag(ctx, t[0], t[1], 10, col.main, col.dark, true, 8, 5);
    banner(ctx, 0.5, 0.82, 48, col, 8);
  },
  palisade(ctx, s, P, col, style, extra) { drawWall(ctx, P, col, extra, false); },
  stonewall(ctx, s, P, col, style, extra) { drawWall(ctx, P, col, extra, true); },
  gate(ctx, s, P, col, style, extra) {
    const mask = +extra || 0;
    const alongX = (mask & 5) || !(mask & 10);
    if (alongX) {
      stoneBox(ctx, 0, 0.3, 0.22, 0.7, 0, 30, P); stoneBox(ctx, 0.78, 0.3, 1, 0.7, 0, 30, P);
      stoneBox(ctx, 0.22, 0.3, 0.78, 0.7, 18, 30, P);
      poly(ctx, [iso(0.22, 0.7, 0), iso(0.78, 0.7, 0), iso(0.78, 0.7, 18), iso(0.22, 0.7, 18)], '#6a4424', '#3a2414', 0.8);
      for (let x = 0.3; x < 0.78; x += 0.12) line(ctx, iso(x, 0.7, 0), iso(x, 0.7, 18), '#4a2e16', 0.5);
      merlonsL(ctx, 0, 1, 0.7, 30, P, 0.1, 3);
      banner(ctx, 0.5, 0.7, 28, col, 7);
    } else {
      stoneBox(ctx, 0.3, 0, 0.7, 0.22, 0, 30, P); stoneBox(ctx, 0.3, 0.78, 0.7, 1, 0, 30, P);
      stoneBox(ctx, 0.3, 0.22, 0.7, 0.78, 18, 30, P);
      poly(ctx, [iso(0.7, 0.78, 0), iso(0.7, 0.22, 0), iso(0.7, 0.22, 18), iso(0.7, 0.78, 18)], '#6a4424', '#3a2414', 0.8);
      for (let y = 0.3; y < 0.78; y += 0.12) line(ctx, iso(0.7, y, 0), iso(0.7, y, 18), '#4a2e16', 0.5);
      merlonsR(ctx, 0.7, 0, 1, 30, P, 0.1, 3);
      banner(ctx, 0.7, 0.5, 28, col, 7, 'R');
    }
  },
  wonder(ctx, s, P, col, style) {
    groundPad(ctx, s, 'rgba(140,120,90,0.5)', -0.25);
    // stepped plinth
    stoneBox(ctx, 0.1, 0.1, 4.9, 4.9, 0, 5, P);
    stoneBox(ctx, 0.3, 0.3, 4.7, 4.7, 5, 9, P);
    if (style === 'byz') {
      const minaret = (x, y) => { cylinder(ctx, x, y, 9, 80, 0.2, P.wallL, P.wallD); cone(ctx, x, y, 80, 0.24, 18, P.dome, P.domeD); };
      minaret(0.5, 0.5); minaret(4.5, 0.5); minaret(0.5, 4.5);
      stoneBox(ctx, 0.7, 0.7, 4.3, 4.3, 9, 44, P);
      for (let i = 0; i < 4; i++) { winL(ctx, 1.2 + i * 0.85, 4.3, 22, 0.3, 12, '#3a3a5a'); winR(ctx, 4.3, 1.2 + i * 0.85, 22, 0.3, 12, '#3a3a5a'); }
      dome(ctx, 2.5, 4.3, 30, 0.9, 16, P.dome, P.domeD);
      cylinder(ctx, 2.5, 2.5, 44, 56, 1.4, P.wallL, P.wallD);
      for (let i = 0; i < 16; i++) { const a = Math.PI * (i / 16); const [wx, wy] = iso(2.5 + Math.cos(a + Math.PI * 0.25) * 1.38, 2.5 + Math.sin(a + Math.PI * 0.25) * 1.38, 50); ctx.fillStyle = '#2a2a40'; ctx.fillRect(wx - 1, wy - 3, 2, 4); }
      const t = dome(ctx, 2.5, 2.5, 56, 1.45, 38, P.dome, P.domeD);
      line(ctx, [t[0], t[1]], [t[0], t[1] - 12], P.gold, 2); line(ctx, [t[0] - 4, t[1] - 8], [t[0] + 4, t[1] - 8], P.gold, 2);
      minaret(4.5, 4.5);
      banner(ctx, 2.5, 4.3, 40, col, 18);
      return;
    }
    if (style === 'steppe') {
      cylinder(ctx, 2.5, 2.5, 9, 22, 2.1, P.wallL, P.wallD);
      cylinder(ctx, 2.5, 2.5, 22, 34, 1.6, P.felt, P.feltD);
      ctx.save(); const [sx, sy, rx] = iso(2.5, 2.5, 28).concat([1.6 * HW * 1.414]); ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx * 0.5, 0, 0, Math.PI); ctx.strokeStyle = P.pattern; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      cylinder(ctx, 2.5, 2.5, 34, 44, 1.1, P.wallL, P.wallD);
      const t = dome(ctx, 2.5, 2.5, 44, 1.15, 34, P.trim, shade(P.trim, 0.6));
      line(ctx, [t[0], t[1]], [t[0], t[1] - 20], P.gold || '#d6ad3d', 2);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#d6ad3d'; ctx.beginPath(); ctx.arc(t[0], t[1] - 6 - i * 5, 2.6 - i * 0.5, 0, Math.PI * 2); ctx.fill(); }
      for (const [x, y] of [[0.6, 0.6], [4.4, 0.6], [0.6, 4.4], [4.4, 4.4]]) { const tt = iso(x, y, 9); flag(ctx, tt[0], tt[1], 34, col.main, col.dark, true, 12, 7); }
      return;
    }
    // cathedral
    stoneBox(ctx, 0.7, 1.6, 4.0, 3.4, 9, 46, P);
    for (let i = 0; i < 4; i++) winL(ctx, 1.1 + i * 0.75, 3.4, 22, 0.22, 16, '#3a3a6a');
    stoneBox(ctx, 1.9, 0.7, 2.9, 4.3, 9, 46, P);
    roofGableX(ctx, 0.7, 1.6, 4.0, 3.4, 46, 26, 0.1, P.slate, shade(P.slate, 0.85), P.wall, 'rgba(0,0,0,0.15)');
    roofGableY(ctx, 1.9, 0.7, 2.9, 4.3, 46, 26, 0.1, P.slate, shade(P.slate, 0.85), P.wall, 'rgba(0,0,0,0.15)');
    // west front towers (on +x side)
    for (const y of [1.3, 3.0]) {
      stoneBox(ctx, 3.9, y, 4.6, y + 0.7, 9, 82, P);
      winL(ctx, 4.25, y + 0.7, 60, 0.14, 12, '#1a1410'); winR(ctx, 4.6, y + 0.35, 60, 0.14, 12, '#1a1410');
      roofHip(ctx, 3.9, y, 4.6, y + 0.7, 82, 34, 0.03, P.slate, P.slateD);
      const tt = iso(4.25, y + 0.35, 116);
      flag(ctx, tt[0], tt[1], 10, col.main, col.dark, true, 9, 5);
    }
    stoneBox(ctx, 3.9, 2.0, 4.6, 3.0, 9, 54, P);
    // rose window
    const [rx, ry] = iso(4.6, 2.5, 38);
    const g = ctx.createRadialGradient(rx, ry, 1, rx, ry, 7);
    g.addColorStop(0, '#f0d060'); g.addColorStop(0.4, '#c03a6a'); g.addColorStop(0.8, '#3a4aa8'); g.addColorStop(1, '#2a2040');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(rx, ry, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
    doorR(ctx, 4.6, 2.5, 0.45, 18, '#3a2414', '#c0a050');
    banner(ctx, 2.4, 4.3, 40, col, 16);
  },
};

function drawWall(ctx, P, col, extra, stone) {
  const mask = +extra || 0;
  const H = stone ? 22 : 18;
  const seg = (x0, y0, x1, y1) => {
    if (stone) {
      stoneBox(ctx, x0, y0, x1, y1, 0, H, P);
      if (x1 - x0 > y1 - y0) merlonsL(ctx, x0, x1, y1, H, P, 0.1, 3); else merlonsR(ctx, x1, y0, y1, H, P, 0.1, 3);
    } else {
      // row of sharpened stakes
      const along = x1 - x0 > y1 - y0;
      const n = Math.max(2, Math.round((along ? x1 - x0 : y1 - y0) / 0.13));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = along ? x0 + (x1 - x0) * t : (x0 + x1) / 2, y = along ? (y0 + y1) / 2 : y0 + (y1 - y0) * t;
        const [bx, by] = iso(x, y, 0);
        const hh = H - (i % 3) * 1.5;
        ctx.fillStyle = i % 2 ? '#8a6438' : '#7a5630';
        ctx.beginPath(); ctx.moveTo(bx - 2, by); ctx.lineTo(bx - 2, by - hh); ctx.lineTo(bx, by - hh - 3.5); ctx.lineTo(bx + 2, by - hh); ctx.lineTo(bx + 2, by); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(40,24,10,0.6)'; ctx.lineWidth = 0.5; ctx.stroke();
      }
      const a = along ? iso(x0, (y0 + y1) / 2, 8) : iso((x0 + x1) / 2, y0, 8), b = along ? iso(x1, (y0 + y1) / 2, 8) : iso((x0 + x1) / 2, y1, 8);
      line(ctx, a, b, '#4a2e16', 1);
    }
  };
  const t0 = 0.3, t1 = 0.7;
  if (mask & 8) seg(t0, 0, t1, 0.5);       // -y (behind)
  if (mask & 4) seg(0, t0, 0.5, t1);       // -x (behind)
  if (stone) { stoneBox(ctx, 0.25, 0.25, 0.75, 0.75, 0, H + 3, P); merlonsL(ctx, 0.25, 0.75, 0.75, H + 3, P, 0.1, 3); }
  else seg(0.3, 0.3, 0.7, 0.7);
  if (mask & 1) seg(0.5, t0, 1, t1);       // +x (front)
  if (mask & 2) seg(t0, 0.5, t1, 1);       // +y (front)
  if (stone && !mask) banner(ctx, 0.5, 0.75, H, col, 6);
}

// ------------------------------------------------------------------ sprite cache
const BSPRITES = new Map();
function getBuildingSprite(type, style, colorIdx, stage, extra = '') {
  const key = `${type}|${style}|${colorIdx}|${stage}|${extra}`;
  let s = BSPRITES.get(key);
  if (s) return s;
  const def = BUILDINGS[type];
  const sz = def.size;
  const pad = 24;
  const top = BLD_TOP[type] || (sz === 1 ? 70 : 90);
  const w = sz * TW + pad * 2, h = sz * TH + top + pad;
  const c = makeCanvas(w * SPR_SCALE, h * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE);
  const ox = sz * HW + pad, oy = top;
  ctx.translate(ox, oy);
  const P = STYLES[style] || STYLES.west;
  const col = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  const draw = BUILD_DRAW[type];
  if (type === 'farm') draw(ctx, sz, P, col, style, stage === 'done' ? extra : 'b');
  else if (stage === 'b0') foundation(ctx, sz, P);
  else if (stage === 'b1') {
    foundation(ctx, sz, P);
    const [x0, y0, x1, y1, hh] = mainVolume(type, sz);
    if (def.wall || def.gate) draw(ctx, sz, P, col, style, extra);
    else {
      if (type === 'house' && style === 'steppe') cylinder(ctx, sz / 2, sz / 2, 0, 7, 0.68, P.felt, P.feltD);
      else stoneBox(ctx, x0, y0, x1, y1, 0, hh * 0.45, P);
      scaffolding(ctx, x0, y0, x1, y1, hh * 0.8);
    }
  } else {
    draw(ctx, sz, P, col, style, extra);
    if (stage === 'b2' && !def.wall && !def.gate) {
      const [x0, y0, x1, y1, hh] = mainVolume(type, sz);
      scaffolding(ctx, x0, y0, x1, y1, hh);
    }
  }
  s = { c, w, h, ox, oy };
  BSPRITES.set(key, s);
  return s;
}

// Rubble left behind by a destroyed building
function getRubbleSprite(size) {
  const key = 'rubble|' + size;
  let s = BSPRITES.get(key);
  if (s) return s;
  const w = size * TW + 20, h = size * TH + 30;
  const c = makeCanvas(w * SPR_SCALE, h * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE);
  ctx.translate(w / 2, 20 + size * HH);
  const r = mulberry32(size * 77);
  ctx.fillStyle = 'rgba(50,40,30,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 0, size * HW * 0.9, size * HH * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < size * 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * 0.45;
    const [x, y] = iso(Math.cos(a) * d, Math.sin(a) * d, 0);
    const sz = 1.5 + r() * 3;
    ctx.fillStyle = ['#7a7468', '#8e887c', '#5a544a', '#6a4a2a'][i % 4];
    ctx.beginPath(); ctx.moveTo(x - sz, y); ctx.lineTo(x - sz * 0.4, y - sz * 1.2); ctx.lineTo(x + sz, y - sz * 0.5); ctx.lineTo(x + sz * 0.6, y + sz * 0.3); ctx.closePath(); ctx.fill();
  }
  for (let i = 0; i < size * 3; i++) {
    const [x, y] = iso((r() - 0.5) * size * 0.8, (r() - 0.5) * size * 0.8, 0);
    line(ctx, [x - 5, y - r() * 3], [x + 5, y + r() * 3], '#3a2614', 1.6);
  }
  s = { c, w, h, ox: w / 2, oy: 20 + size * HH };
  BSPRITES.set(key, s);
  return s;
}
