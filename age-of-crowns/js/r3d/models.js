'use strict';
// ============================================================================
//  3D models built from primitives: buildings (4 architectural styles,
//  construction stages), trees, mines, bushes, carcasses.
//  Building local space: footprint x∈[0,s], z∈[0,s], ground at y=0.
//  The camera looks from +x/+z, so doors, windows and banners face +x / +z.
// ============================================================================

const PROTOS = new Map();

function initModelGeo() {
  initGeo();
  if (GEO.slopes) return;
  // roof slopes only (ridge along x), and the two gable-end triangles
  const slopes = new THREE.BufferGeometry();
  slopes.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
  ], 3));
  slopes.computeVertexNormals();
  GEO.slopes = slopes;
  const ends = new THREE.BufferGeometry();
  ends.setAttribute('position', new THREE.Float32BufferAttribute([
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ], 3));
  ends.computeVertexNormals();
  GEO.ends = ends;
  GEO.disc = new THREE.CylinderGeometry(1, 1, 1, 16);
  GEO.torus = new THREE.TorusGeometry(1, 0.08, 6, 20);
}

// --------------------------------------------------------------------------- building helpers
class BB extends ModelBuilder {
  constructor(P, s) { super(); this.P = P; this.s = s; }
  pad(col = '#8a7656', grow = 0.08) { const s = this.s; return this.box('plain', col, s / 2, -0.04, s / 2, s + grow * 2, 0.06, s + grow * 2); }
  stone(x0, z0, x1, z1, y0, h, col) { return this.box('stone', col || this.P.wall, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, h, z1 - z0); }
  plaster(x0, z0, x1, z1, y0, h) { return this.box('plaster', this.P.plaster, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, h, z1 - z0); }
  planks(x0, z0, x1, z1, y0, h, col) { return this.box('wood', col || this.P.wood, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, h, z1 - z0); }
  // timber framing on the two visible faces (+z, +x)
  timber(x0, z0, x1, z1, y0, h) {
    const c = this.P.beam, t = 0.05, p = 0.012;
    const nx = Math.max(2, Math.round((x1 - x0) / 0.32)), nz = Math.max(2, Math.round((z1 - z0) / 0.32));
    for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx; this.box('wood', c, x, y0, z1 + p, t, h, t); }
    for (let i = 0; i <= nz; i++) { const z = z0 + (z1 - z0) * i / nz; this.box('wood', c, x1 + p, y0, z, t, h, t); }
    for (const y of [y0, y0 + h / 2 - t / 2, y0 + h - t]) {
      this.box('wood', c, (x0 + x1) / 2, y, z1 + p, x1 - x0 + t, t, t);
      this.box('wood', c, x1 + p, y, (z0 + z1) / 2, t, t, z1 - z0 + t);
    }
    // diagonal braces
    const bw = (x1 - x0) / nx;
    this.boxR('wood', c, x0 + bw / 2, y0 + h * 0.25, z1 + p, t * 0.8, Math.hypot(bw, h / 2), t * 0.8, 0, 0, Math.atan2(bw, h / 2));
    this.boxR('wood', c, x1 - bw / 2, y0 + h * 0.25, z1 + p, t * 0.8, Math.hypot(bw, h / 2), t * 0.8, 0, 0, -Math.atan2(bw, h / 2));
    return this;
  }
  // gable roof with wall-coloured gable ends; ridge along 'x' or 'z'
  roof(x0, z0, x1, z1, y, h, roofCol, endCol, axis = 'x', ov = 0.1, mat = 'tiles') {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = axis === 'x' ? x1 - x0 : z1 - z0, wid = axis === 'x' ? z1 - z0 : x1 - x0;
    const ry = axis === 'x' ? 0 : Math.PI / 2;
    this.add(mat, GEO.slopes, mtx(cx, y, cz, 0, ry, 0, len + ov * 2, h, wid + ov * 2), roofCol);
    this.add('plaster', GEO.ends, mtx(cx, y, cz, 0, ry, 0, len, h * (wid / (wid + ov * 2)), wid), endCol || this.P.plaster);
    // ridge cap
    const rx = axis === 'x' ? len + ov * 2 : 0.07, rz = axis === 'x' ? 0.07 : len + ov * 2;
    this.box(mat, shade(roofCol, 0.7), cx, y + h - 0.03, cz, rx, 0.06, rz);
    return this;
  }
  hip(x0, z0, x1, z1, y, h, col, ov = 0.1, mat = 'tiles') { return super.hip(mat, col, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, z1 - z0, h, ov); }
  door(face, a, w, h, y0 = 0) {
    const dark = '#2a1a0e', fr = this.P.beam || '#5a3a20';
    if (face === 'z') { this.box('wood', fr, a, y0, this.zf + 0.02, w + 0.08, h + 0.05, 0.03); this.box('dark', dark, a, y0, this.zf + 0.035, w, h, 0.03); }
    else { this.box('wood', fr, this.xf + 0.02, y0, a, 0.03, h + 0.05, w + 0.08); this.box('dark', dark, this.xf + 0.035, y0, a, 0.03, h, w); }
    return this;
  }
  win(face, a, y, w = 0.14, h = 0.18) {
    if (face === 'z') { this.box('dark', '#1c1610', a, y, this.zf + 0.012, w, h, 0.03); this.box('wood', '#6a4a2a', a, y - 0.03, this.zf + 0.03, w + 0.06, 0.03, 0.05); }
    else { this.box('dark', '#1c1610', this.xf + 0.012, y, a, 0.03, h, w); this.box('wood', '#6a4a2a', this.xf + 0.03, y - 0.03, a, 0.05, 0.03, w + 0.06); }
    return this;
  }
  faces(x1, z1) { this.xf = x1; this.zf = z1; return this; }
  merlons(x0, z0, x1, z1, y, step = 0.2, h = 0.14, col) {
    const c = col || this.P.wall, w = step * 0.55;
    for (let x = x0 + w / 2; x <= x1 - w / 2 + 1e-3; x += step) { this.box('stone', c, x, y, z0 + w / 2, w, h, w); this.box('stone', c, x, y, z1 - w / 2, w, h, w); }
    for (let z = z0 + w / 2 + step; z <= z1 - w / 2 - step + 1e-3; z += step) { this.box('stone', c, x0 + w / 2, y, z, w, h, w); this.box('stone', c, x1 - w / 2, y, z, w, h, w); }
    return this;
  }
  flag(x, y, z, h = 0.6, big = 1) {
    this.cyl('wood', '#4a3424', x, y, z, 0.015, 0.02, h, 6);
    this.box('cloth', '#ffffff', x + 0.14 * big, y + h - 0.13 * big, z, 0.26 * big, 0.16 * big, 0.012);
    this.sphere('gold', '#d8b84a', x, y + h + 0.02, z, 0.03, 0.03, 0.03);
    return this;
  }
  banner(face, a, ytop, h = 0.4) {
    if (face === 'z') { this.box('cloth', '#ffffff', a, ytop - h, this.zf + 0.03, 0.16, h, 0.015); this.box('gold', '#d4aa3a', a, ytop - 0.02, this.zf + 0.04, 0.2, 0.025, 0.02); }
    else { this.box('cloth', '#ffffff', this.xf + 0.03, ytop - h, a, 0.015, h, 0.16); this.box('gold', '#d4aa3a', this.xf + 0.04, ytop - 0.02, a, 0.02, 0.025, 0.2); }
    return this;
  }
  tower(x, z, r, h, roofKind, P) {
    this.cyl('stone', P.wall, x, 0, z, r, r * 1.05, h, 14);
    this.cyl('stone', P.wallL || P.wall, x, h, z, r * 1.12, r * 1.12, 0.08, 14);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; this.box('stone', P.wall, x + Math.cos(a) * r * 1.02, h + 0.08, z + Math.sin(a) * r * 1.02, 0.09, 0.12, 0.09, -a); }
    if (roofKind === 'cone') this.cone('tiles', P.slate, x, h + 0.08, z, r * 1.2, r * 2.4, 14);
    else if (roofKind === 'dome') this.dome('plain', P.dome || '#7e95a9', x, h + 0.08, z, r * 0.95, r * 1.1);
    return this;
  }
  yurt(cx, cz, r, h, P, y0 = 0) {
    this.cyl('felt', P.felt, cx, y0, cz, r, r, h, 18);
    this.cyl('plain', P.pattern, cx, y0 + h * 0.45, cz, r * 1.012, r * 1.012, h * 0.12, 18);
    this.add('felt', coneGeo(18), mtx(cx, y0 + h + r * 0.28, cz, 0, 0, 0, r * 1.06, r * 0.56, r * 1.06), P.roof);
    this.cyl('wood', P.wood, cx, y0 + h + r * 0.5, cz, r * 0.18, r * 0.2, 0.06, 10);
    // door facing the camera
    const a = Math.PI / 4;
    this.boxR('plain', P.pattern, cx + Math.cos(a) * r * 0.97, y0 + h * 0.32, cz + Math.sin(a) * r * 0.97, 0.03, h * 0.62, r * 0.42, 0, -a, 0);
    return this;
  }
  scaffold(x0, z0, x1, z1, h) {
    const c = '#8a6a3a';
    for (let i = 0; i <= 3; i++) { const x = x0 + (x1 - x0) * i / 3; this.box('wood', c, x, 0, z1 + 0.12, 0.04, h, 0.04); }
    for (let i = 0; i <= 3; i++) { const z = z0 + (z1 - z0) * i / 3; this.box('wood', c, x1 + 0.12, 0, z, 0.04, h, 0.04); }
    for (let y = 0.3; y < h; y += 0.4) { this.box('wood', '#a07a40', (x0 + x1) / 2, y, z1 + 0.12, x1 - x0 + 0.2, 0.04, 0.12); this.box('wood', '#a07a40', x1 + 0.12, y, (z0 + z1) / 2, 0.12, 0.04, z1 - z0 + 0.2); }
    return this;
  }
}

// Main body volume per type (for construction stages): [x0,z0,x1,z1,h]
function mainVol3(type, s) {
  switch (type) {
    case 'house': return [0.3, 0.3, 1.7, 1.7, 0.6];
    case 'towncenter': return [0.3, 0.3, 3.7, 3.7, 0.9];
    case 'castle': return [0.25, 0.25, 3.75, 3.75, 1.1];
    case 'wonder': return [0.5, 0.5, 4.5, 4.5, 1.4];
    case 'watchtower': return [0.2, 0.2, 0.8, 0.8, 1.6];
    case 'mill': case 'lumbercamp': case 'miningcamp': return [0.3, 0.3, 1.7, 1.7, 0.5];
    case 'siegeworkshop': return [0.3, 0.3, 3.7, 2.8, 0.9];
    default: return [0.3, 0.3, s - 0.3, s - 0.3, 0.75];
  }
}

const BUILD3 = {
  house(B, s, P, style) {
    B.pad();
    if (style === 'steppe') { B.yurt(1, 1, 0.62, 0.42, P); return; }
    if (style === 'byz') {
      B.faces(1.7, 1.7).plaster(0.3, 0.3, 1.7, 1.7, 0, 0.62);
      B.door('z', 1.0, 0.22, 0.38).win('x', 0.8, 0.36).win('x', 1.25, 0.36);
      B.hip(0.3, 0.3, 1.7, 1.7, 0.62, 0.36, P.roof);
      return;
    }
    B.faces(1.7, 1.65).stone(0.3, 0.35, 1.7, 1.65, 0, 0.12).plaster(0.3, 0.35, 1.7, 1.65, 0.12, 0.52).timber(0.3, 0.35, 1.7, 1.65, 0.12, 0.52);
    B.door('z', 1.12, 0.22, 0.4).win('x', 0.75, 0.38).win('x', 1.3, 0.38);
    B.stone(0.5, 0.5, 0.72, 0.72, 0.6, 0.65);
    B.roof(0.3, 0.35, 1.7, 1.65, 0.64, 0.55, P.roof, P.plaster, 'x');
  },
  towncenter(B, s, P, style) {
    B.pad('#8a7656', 0.15);
    if (style === 'steppe') {
      B.planks(0.15, 0.15, 3.85, 3.85, 0, 0.12);
      B.yurt(0.95, 0.95, 0.5, 0.42, P, 0.12); B.yurt(3.0, 0.9, 0.45, 0.4, P, 0.12); B.yurt(0.85, 3.1, 0.45, 0.4, P, 0.12);
      B.yurt(2.15, 2.15, 1.2, 0.8, P, 0.12);
      B.flag(2.15, 1.65, 2.15, 0.9, 1.4);
      return;
    }
    if (style === 'byz') {
      B.faces(3.7, 3.7).stone(0.3, 0.3, 3.7, 3.7, 0, 1.0);
      for (let i = 0; i < 3; i++) { B.door('z', 1.0 + i * 0.9, 0.34, 0.55); B.win('x', 0.9 + i * 0.9, 0.55, 0.22, 0.36); }
      for (const [x, z] of [[0.35, 0.35], [3.65, 0.35], [0.35, 3.65], [3.65, 3.65]]) { B.cyl('plaster', P.wallL, x, 0, z, 0.3, 0.32, 1.35, 14); B.dome('plain', P.dome, x, 1.35, z, 0.3, 0.3); }
      B.cyl('plaster', P.wallL, 2, 1.0, 2, 1.0, 1.05, 0.45, 20);
      B.dome('plain', P.dome, 2, 1.45, 2, 1.0, 0.95);
      B.cyl('gold', P.gold, 2, 2.38, 2, 0.02, 0.02, 0.35, 6); B.box('gold', P.gold, 2, 2.6, 2, 0.2, 0.03, 0.03);
      B.banner('z', 2.0, 0.95, 0.5);
      return;
    }
    B.faces(3.7, 3.7).stone(0.3, 0.3, 3.7, 3.7, 0, 0.95);
    B.door('z', 2.0, 0.6, 0.7).win('x', 1.2, 0.5, 0.18, 0.26).win('x', 2.8, 0.5, 0.18, 0.26).win('z', 1.0, 0.5, 0.18, 0.26).win('z', 3.0, 0.5, 0.18, 0.26);
    B.faces(3.2, 3.2).plaster(0.8, 0.8, 3.2, 3.2, 0.95, 0.65).timber(0.8, 0.8, 3.2, 3.2, 0.95, 0.65);
    for (let i = 0; i < 2; i++) { B.win('z', 1.4 + i * 1.2, 1.15, 0.16, 0.22); B.win('x', 1.4 + i * 1.2, 1.15, 0.16, 0.22); }
    B.hip(0.8, 0.8, 3.2, 3.2, 1.6, 0.85, P.roof, 0.22);
    B.faces(2.25, 2.25).stone(1.75, 1.75, 2.25, 2.25, 2.1, 0.55);
    B.win('z', 2.0, 2.35, 0.12, 0.2);
    B.hip(1.75, 1.75, 2.25, 2.25, 2.65, 0.45, P.roof, 0.05);
    B.flag(2, 3.1, 2, 0.6, 1.2);
    B.faces(3.7, 3.7).banner('z', 1.1, 0.85, 0.42).banner('x', 1.1, 0.85, 0.42);
  },
  barracks(B, s, P, style) {
    B.pad();
    if (style === 'steppe') {
      B.faces(2.7, 2.7).planks(0.3, 0.3, 2.7, 2.7, 0, 0.6);
      B.door('z', 1.5, 0.4, 0.42);
      B.cone('felt', P.roof, 1.5, 0.6, 1.5, 1.75, 0.9, 16);
      B.flag(1.5, 1.45, 1.5, 0.5);
    } else {
      B.faces(2.7, 2.7).stone(0.3, 0.3, 2.7, 2.7, 0, 0.8);
      B.door('z', 1.5, 0.42, 0.5).win('x', 1.0, 0.45).win('x', 2.0, 0.45);
      if (style === 'byz') B.hip(0.3, 0.3, 2.7, 2.7, 0.8, 0.5, P.roof);
      else { B.roof(0.3, 0.3, 2.7, 2.7, 0.8, 0.7, P.slate, P.wall, 'z'); B.merlons(0.3, 0.3, 2.7, 2.7, 0.8, 0.22, 0.12); }
    }
    B.faces(2.7, 2.7).banner('z', 0.8, 0.72, 0.36).banner('z', 2.2, 0.72, 0.36);
    // weapon rack and training dummy
    B.box('wood', '#6a4a24', 2.95, 0, 2.2, 0.06, 0.45, 0.6);
    for (let i = 0; i < 4; i++) B.cyl('metal', '#9aa0a6', 2.98, 0, 1.95 + i * 0.15, 0.012, 0.012, 0.55, 5);
    B.cyl('wood', '#7a5a30', 3.0, 0, 0.6, 0.03, 0.03, 0.5, 6); B.cyl('thatch', '#c8a860', 3.0, 0.25, 0.6, 0.08, 0.08, 0.25, 8); B.sphere('thatch', '#c8a860', 3.0, 0.58, 0.6, 0.07, 0.07, 0.07);
  },
  archeryrange(B, s, P, style) {
    B.pad();
    const wallMat = style === 'byz' ? 'plaster' : 'wood';
    B.box(wallMat, style === 'byz' ? P.plaster : P.wood, 1.5, 0, 0.8, 2.4, 0.6, 1.0);
    for (const x of [0.4, 1.5, 2.6]) B.box('wood', P.wood, x, 0, 1.9, 0.08, 0.62, 0.08);
    B.roof(0.3, 0.3, 2.7, 1.95, 0.62, 0.42, style === 'byz' ? P.roof : P.slate, P.wood, 'x');
    for (const [x, z] of [[0.9, 2.55], [2.1, 2.45]]) {
      B.boxR('wood', '#6a4a24', x - 0.08, 0.2, z, 0.03, 0.45, 0.03, 0, 0, 0.2); B.boxR('wood', '#6a4a24', x + 0.08, 0.2, z, 0.03, 0.45, 0.03, 0, 0, -0.2);
      B.add('thatch', GEO.disc, mtx(x, 0.45, z + 0.02, Math.PI / 2, 0, 0, 0.2, 0.06, 0.2), '#d8c278');
      B.add('plain', GEO.disc, mtx(x, 0.45, z + 0.055, Math.PI / 2, 0, 0, 0.13, 0.01, 0.13), '#c03020');
      B.add('plain', GEO.disc, mtx(x, 0.45, z + 0.062, Math.PI / 2, 0, 0, 0.06, 0.01, 0.06), '#f0e0b0');
    }
    B.faces(2.7, 1.95).banner('z', 1.5, 0.6, 0.3);
  },
  stable(B, s, P, style) {
    B.pad();
    B.faces(2.7, 2.2).planks(0.3, 0.5, 2.7, 2.2, 0, 0.62);
    for (let i = 0; i < 3; i++) { const x = 0.7 + i * 0.75; B.box('dark', '#21150b', x, 0, 2.21, 0.4, 0.45, 0.02); B.box('wood', P.woodD || '#5a3a1e', x, 0, 2.23, 0.4, 0.22, 0.03); }
    if (style === 'byz') B.hip(0.3, 0.5, 2.7, 2.2, 0.62, 0.4, P.roof);
    else B.roof(0.3, 0.5, 2.7, 2.2, 0.62, 0.48, style === 'steppe' ? P.roof : P.slate, P.wood, 'x', 0.1, style === 'steppe' ? 'thatch' : 'tiles');
    B.box('thatch', '#e2c45a', 2.9, 0, 2.6, 0.32, 0.22, 0.28); B.box('thatch', '#e2c45a', 2.45, 0, 2.7, 0.32, 0.22, 0.28); B.box('thatch', '#e8cc64', 2.7, 0.22, 2.65, 0.3, 0.2, 0.26);
    B.box('wood', '#6a4a24', 1.5, 0, 2.75, 2.0, 0.05, 0.04); B.box('wood', '#6a4a24', 1.5, 0.25, 2.75, 2.0, 0.04, 0.04);
    for (let x = 0.5; x <= 2.5; x += 0.5) B.box('wood', '#6a4a24', x, 0, 2.75, 0.05, 0.35, 0.05);
  },
  blacksmith(B, s, P, style) {
    B.pad('#4a4036');
    if (style === 'byz') B.faces(2.7, 2.7).plaster(0.3, 0.3, 2.7, 2.7, 0, 0.7); else B.faces(2.7, 2.7).stone(0.3, 0.3, 2.7, 2.7, 0, 0.7);
    B.box('dark', '#1e120a', 1.6, 0, 2.71, 0.8, 0.45, 0.03);
    B.box('glow', '#ff8a2a', 1.6, 0.04, 2.73, 0.5, 0.18, 0.03);
    B.win('x', 1.3, 0.35, 0.2, 0.2);
    B.hip(0.3, 0.3, 2.7, 2.7, 0.7, 0.55, style === 'byz' ? P.roof : P.slate);
    B.stone(0.45, 0.45, 0.95, 0.95, 0.7, 1.25);
    B.box('dark', '#2a2420', 0.7, 1.95, 0.7, 0.42, 0.08, 0.42);
    // anvil
    B.box('metal', '#3e4146', 2.2, 0, 3.0, 0.14, 0.18, 0.1); B.box('metal', '#4a4e54', 2.2, 0.18, 3.0, 0.3, 0.07, 0.14);
    B.cyl('wood', '#5a3a1a', 2.6, 0, 3.0, 0.1, 0.11, 0.18, 8);
  },
  market(B, s, P, style) {
    B.pad('#7a6440');
    if (style === 'byz') B.faces(2.7, 1.3).plaster(0.3, 0.3, 2.7, 1.3, 0, 0.6);
    else B.faces(2.7, 1.3).plaster(0.3, 0.3, 2.7, 1.3, 0, 0.6).timber(0.3, 0.3, 2.7, 1.3, 0, 0.6);
    B.roof(0.3, 0.3, 2.7, 1.3, 0.6, 0.38, P.roof, P.plaster, 'x');
    const stall = (x0, z0, alt) => {
      for (const [x, z] of [[x0, z0], [x0 + 0.8, z0], [x0 + 0.8, z0 + 0.7], [x0, z0 + 0.7]]) B.cyl('wood', '#6a4a24', x, 0, z, 0.025, 0.025, 0.5, 6);
      for (let i = 0; i < 4; i++) B.boxR(i % 2 ? 'canvas' : 'cloth', i % 2 ? '#f0e8d8' : (alt ? '#e8b030' : '#ffffff'), x0 + 0.1 + i * 0.2, 0.52, z0 + 0.35, 0.2, 0.02, 0.85, -0.25, 0, 0);
      B.box('wood', '#9a7444', x0 + 0.4, 0, z0 + 0.35, 0.6, 0.22, 0.45);
      const r = mulberry32(Math.floor(x0 * 100 + z0 * 10));
      for (let k = 0; k < 7; k++) B.sphere('plain', ['#d03a2a', '#e8b030', '#6aa83a', '#8a3ac0'][k % 4], x0 + 0.2 + r() * 0.4, 0.25, z0 + 0.2 + r() * 0.3, 0.05, 0.05, 0.05);
    };
    stall(0.4, 1.7, false); stall(1.6, 1.8, true);
    B.box('wood', '#9a7444', 2.7, 0, 2.75, 0.3, 0.25, 0.25);
    B.sphere('plain', '#b8643a', 0.5, 0.15, 2.85, 0.1, 0.16, 0.1);
  },
  mill(B, s, P, style) {
    B.pad();
    if (style === 'steppe') B.faces(1.5, 1.5).planks(0.5, 0.5, 1.5, 1.5, 0, 1.0);
    else if (style === 'byz') B.faces(1.5, 1.5).plaster(0.5, 0.5, 1.5, 1.5, 0, 1.0);
    else B.faces(1.5, 1.5).stone(0.5, 0.5, 1.5, 1.5, 0, 0.45).plaster(0.5, 0.5, 1.5, 1.5, 0.45, 0.55).timber(0.5, 0.5, 1.5, 1.5, 0.45, 0.55);
    B.door('z', 1.0, 0.2, 0.32).win('x', 1.0, 0.65);
    B.hip(0.5, 0.5, 1.5, 1.5, 1.0, 0.55, style === 'byz' ? P.roof : P.slate);
    B.cyl('wood', '#4a3420', 1.58, 0.82, 1.0, 0.05, 0.05, 0.1, 8);
    for (const [x, z] of [[1.75, 1.6], [1.8, 1.3]]) B.sphere('canvas', '#e0d0a0', x, 0.1, z, 0.12, 0.11, 0.1);
  },
  lumbercamp(B, s, P, style) {
    B.pad('#5e4a30');
    for (const [x, z, h] of [[0.35, 0.35, 0.75], [1.65, 0.35, 0.6], [1.65, 1.1, 0.6], [0.35, 1.1, 0.75]]) B.box('wood', P.wood, x, 0, z, 0.07, h, 0.07);
    B.boxR(style === 'byz' ? 'tiles' : 'wood', style === 'byz' ? P.roof : P.wood, 1.0, 0.68, 0.72, 1.5, 0.05, 1.0, 0.15, 0, 0);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) B.add('bark', cylGeo(1, 8), mtx(0.55 + i * 0.25 + row * 0.12, 0.08 + row * 0.15, 1.55, Math.PI / 2, 0, 0, 0.08, 0.7, 0.08), '#7a5230');
    B.cyl('bark', '#7a5230', 1.75, 0, 1.75, 0.13, 0.14, 0.18, 10);
    B.boxR('wood', '#6a4a24', 1.8, 0.25, 1.75, 0.025, 0.26, 0.025, 0, 0, -0.5);
    B.boxR('metal', '#c4c8cc', 1.74, 0.21, 1.75, 0.01, 0.08, 0.06, 0, 0, -0.5);
    B.flag(0.35, 0.75, 1.1, 0.35, 0.8);
  },
  miningcamp(B, s, P, style) {
    B.pad('#5a5248');
    for (const [x, z, h] of [[0.35, 0.35, 0.75], [1.65, 0.35, 0.6], [1.65, 1.1, 0.6], [0.35, 1.1, 0.75]]) B.box('wood', P.wood, x, 0, z, 0.07, h, 0.07);
    B.boxR('tiles', style === 'byz' ? P.roof : P.slate, 1.0, 0.68, 0.72, 1.5, 0.05, 1.0, 0.15, 0, 0);
    for (let k = 0; k < 6; k++) B.ico('rock', '#8a8880', 0.45 + (k % 3) * 0.13, 0.06, 1.55 + Math.floor(k / 3) * 0.12, 0.09, k);
    for (let k = 0; k < 5; k++) B.ico('gold', '#e8c040', 1.1 + (k % 3) * 0.11, 0.06, 1.65 + Math.floor(k / 3) * 0.1, 0.06, k);
    B.box('wood', '#5a4a3a', 1.75, 0.08, 1.35, 0.3, 0.16, 0.22);
    for (const z of [1.25, 1.45]) for (const x of [1.65, 1.85]) B.add('plain', GEO.disc, mtx(x, 0.07, z, Math.PI / 2, 0, 0, 0.06, 0.02, 0.06), '#222');
    B.flag(0.35, 0.75, 1.1, 0.35, 0.8);
  },
  farm(B, s, P, style, extra) {
    const stage = extra || 'f3';
    B.box('plain', '#6e5030', 1.5, -0.03, 1.5, 2.9, 0.06, 2.9);
    for (let i = 0; i < 11; i++) B.box('plain', '#5a3e22', 1.5, 0.0, 0.25 + i * 0.25, 2.7, 0.04, 0.09);
    const crop = { f3: ['#d8b848', 0.22], f2: ['#a8b048', 0.16], f1: ['#7aa040', 0.09], f0: null, b: null }[stage];
    if (crop) {
      const r = mulberry32(13);
      for (let i = 0; i < 11; i++) for (let j = 0; j < 12; j++) {
        if (stage === 'f1' && r() < 0.35) continue;
        const h = crop[1] * (0.8 + r() * 0.4);
        B.add('foliage', coneGeo(4), mtx(0.25 + j * 0.23 + r() * 0.04, 0.02 + h / 2, 0.25 + i * 0.25, 0, r() * 3, 0, 0.06, h, 0.06), r() < 0.5 ? crop[0] : shade(crop[0], 0.85));
      }
    }
    for (const [x, z] of [[0.05, 0.05], [2.95, 0.05], [2.95, 2.95], [0.05, 2.95], [1.5, 2.95], [2.95, 1.5]]) B.cyl('wood', '#6a4a24', x, 0, z, 0.025, 0.03, 0.22, 6);
  },
  university(B, s, P, style) {
    B.pad();
    if (style === 'west' || style === 'west2') B.faces(2.7, 2.7).stone(0.3, 0.3, 2.7, 2.7, 0, 0.85); else B.faces(2.7, 2.7).plaster(0.3, 0.3, 2.7, 2.7, 0, 0.85);
    for (let i = 0; i < 5; i++) B.cyl('plaster', P.wallL, 0.55 + i * 0.5, 0, 2.82, 0.05, 0.055, 0.7, 10);
    B.box('plaster', P.wallL, 1.5, 0.7, 2.82, 2.4, 0.15, 0.16);
    B.win('x', 1.0, 0.45, 0.16, 0.3).win('x', 1.8, 0.45, 0.16, 0.3);
    B.hip(0.3, 0.3, 2.7, 2.7, 0.85, 0.38, style === 'byz' ? P.roof : P.slate);
    B.cyl('stone', P.wallL, 0.9, 0.85, 0.9, 0.42, 0.44, 0.7, 16);
    B.dome('plain', style === 'byz' ? P.dome : '#7a8a6a', 0.9, 1.55, 0.9, 0.45, 0.4);
    B.boxR('metal', '#c0a050', 1.0, 1.85, 0.95, 0.05, 0.5, 0.05, 0.3, 0, -0.7);
  },
  monastery(B, s, P, style) {
    B.pad();
    const stoneW = !(style === 'byz' || style === 'steppe');
    if (stoneW) B.faces(2.6, 2.3).stone(0.3, 0.7, 2.6, 2.3, 0, 0.85); else B.faces(2.6, 2.3).plaster(0.3, 0.7, 2.6, 2.3, 0, 0.85);
    for (let i = 0; i < 3; i++) B.box('glow', '#4a5aa8', 0.8 + i * 0.7, 0.32, 2.31, 0.14, 0.36, 0.02);
    B.door('z', 1.4, 0.3, 0.45);
    if (style === 'byz') {
      B.hip(0.3, 0.7, 2.6, 2.3, 0.85, 0.3, P.roof);
      B.cyl('plaster', P.wallL, 1.45, 1.0, 1.5, 0.58, 0.6, 0.25, 18);
      B.dome('plain', P.dome, 1.45, 1.25, 1.5, 0.6, 0.55);
      B.cyl('gold', P.gold, 1.45, 1.8, 1.5, 0.015, 0.015, 0.3, 5); B.box('gold', P.gold, 1.45, 2.0, 1.5, 0.15, 0.025, 0.025);
    } else {
      B.roof(0.3, 0.7, 2.6, 2.3, 0.85, 0.6, P.roof, stoneW ? P.wall : P.plaster, 'x');
      B.faces(2.8, 2.5).stone(2.2, 1.9, 2.8, 2.5, 0, 1.75);
      B.box('dark', '#1a1410', 2.5, 1.3, 2.51, 0.2, 0.25, 0.02);
      B.hip(2.2, 1.9, 2.8, 2.5, 1.75, 0.7, P.slate, 0.04);
      B.box('gold', '#d8b84a', 2.5, 2.45, 2.2, 0.03, 0.3, 0.03); B.box('gold', '#d8b84a', 2.5, 2.62, 2.2, 0.16, 0.03, 0.03);
    }
    B.faces(2.6, 2.3).banner('z', 0.6, 0.78, 0.36);
  },
  siegeworkshop(B, s, P, style) {
    B.pad('#5e4a30', 0.2);
    B.faces(3.7, 2.6).planks(0.3, 0.3, 3.7, 2.6, 0, 0.9);
    B.box('dark', '#21150b', 2.0, 0, 2.61, 1.6, 0.7, 0.02);
    B.box('wood', '#8a6a3a', 2.0, 0.06, 2.4, 0.9, 0.3, 0.4);
    B.roof(0.3, 0.3, 3.7, 2.6, 0.9, 0.65, style === 'byz' ? P.roof : P.slate, P.wood, 'x');
    // crane
    B.box('wood', '#6a4a24', 3.5, 0, 3.3, 0.08, 1.8, 0.08);
    B.boxR('wood', '#6a4a24', 3.2, 1.75, 3.3, 0.7, 0.07, 0.07, 0, 0, 0.25);
    B.box('wood', '#c8b080', 2.9, 1.0, 3.3, 0.015, 0.75, 0.015);
    B.box('stone', '#8a8478', 2.9, 0.85, 3.3, 0.16, 0.16, 0.16);
    for (let i = 0; i < 3; i++) B.box('wood', P.wood, 0.9, i * 0.06, 2.95 + i * 0.13, 1.0, 0.06, 0.11);
    B.faces(3.7, 2.6).banner('z', 0.8, 0.8, 0.4).banner('z', 3.3, 0.8, 0.4);
  },
  castle(B, s, P, style) {
    B.pad('#7a6a52', 0.15);
    const H = 1.05, TH = 1.5;
    B.faces(3.75, 3.75);
    // curtain walls
    B.stone(0.5, 0.25, 3.5, 0.7, 0, H); B.stone(0.25, 0.5, 0.7, 3.5, 0, H);
    B.stone(0.5, 3.3, 3.5, 3.75, 0, H); B.stone(3.3, 0.5, 3.75, 3.5, 0, H);
    B.merlons(0.25, 0.25, 3.75, 3.75, H, 0.22, 0.14);
    // keep
    B.stone(1.15, 1.15, 2.85, 2.85, 0, 2.1);
    B.merlons(1.15, 1.15, 2.85, 2.85, 2.1, 0.22, 0.14);
    B.faces(2.85, 2.85).win('z', 1.6, 1.45, 0.08, 0.26).win('z', 2.4, 1.45, 0.08, 0.26).win('x', 2.0, 1.45, 0.08, 0.26);
    B.flag(2, 2.1, 2, 0.8, 1.4);
    // corner towers
    for (const [x, z] of [[0.5, 0.5], [3.5, 0.5], [0.5, 3.5], [3.5, 3.5]]) {
      if (style === 'byz') { B.stone(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0, TH); B.merlons(x - 0.4, z - 0.4, x + 0.4, z + 0.4, TH, 0.18, 0.12); B.dome('plain', P.dome, x, TH, z, 0.3, 0.32); }
      else B.tower(x, z, 0.44, TH, style === 'steppe' ? 'cone' : 'cone', P);
    }
    B.faces(3.75, 3.75).door('z', 2.0, 0.5, 0.65);
    B.banner('z', 1.2, 0.95, 0.5).banner('z', 2.8, 0.95, 0.5).banner('x', 1.4, 0.95, 0.5).banner('x', 2.6, 0.95, 0.5);
  },
  watchtower(B, s, P, style) {
    B.add('plain', GEO.box, mtx(0.5, -0.02, 0.5, 0, 0, 0, 1.1, 0.05, 1.1), '#5e4e38');
    if (style === 'steppe') {
      for (const [x, z] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) B.box('wood', '#6a4a24', x, 0, z, 0.07, 1.7, 0.07);
      B.boxR('wood', '#5a3a1a', 0.5, 0.7, 0.8, 0.04, 0.9, 0.04, 0, 0, 0.6);
      B.planks(0.08, 0.08, 0.92, 0.92, 1.7, 0.28);
      B.cone('felt', P.roof, 0.5, 1.98, 0.5, 0.6, 0.6, 12);
      B.flag(0.5, 2.5, 0.5, 0.4, 0.7);
      return;
    }
    if (style === 'byz') B.faces(0.82, 0.82).plaster(0.18, 0.18, 0.82, 0.82, 0, 1.9); else B.faces(0.82, 0.82).stone(0.18, 0.18, 0.82, 0.82, 0, 1.9);
    B.win('z', 0.5, 1.2, 0.07, 0.2).win('x', 0.5, 1.45, 0.07, 0.2).door('z', 0.5, 0.18, 0.32);
    B.stone(0.08, 0.08, 0.92, 0.92, 1.9, 0.2);
    B.merlons(0.08, 0.08, 0.92, 0.92, 2.1, 0.17, 0.12);
    if (style === 'byz') B.dome('plain', P.dome, 0.5, 2.1, 0.5, 0.33, 0.36);
    else B.hip(0.12, 0.12, 0.88, 0.88, 2.2, 0.7, P.slate, 0.04);
    B.flag(0.5, style === 'byz' ? 2.45 : 2.85, 0.5, 0.35, 0.7);
  },
  palisade(B, s, P, style, extra) { wall3(B, P, +extra || 0, false); },
  stonewall(B, s, P, style, extra) { wall3(B, P, +extra || 0, true); },
  gate(B, s, P, style, extra) {
    const mask = +extra || 0;
    const alongX = (mask & 5) || !(mask & 10);
    const H = 1.15;
    if (alongX) {
      B.stone(0, 0.28, 0.22, 0.72, 0, H); B.stone(0.78, 0.28, 1, 0.72, 0, H); B.stone(0.22, 0.28, 0.78, 0.72, 0.7, H - 0.7);
      B.box('wood', '#6a4424', 0.5, 0, 0.66, 0.56, 0.7, 0.05);
      B.merlons(0, 0.28, 1, 0.72, H, 0.2, 0.12);
      B.faces(1, 0.72).banner('z', 0.5, H - 0.05, 0.25);
    } else {
      B.stone(0.28, 0, 0.72, 0.22, 0, H); B.stone(0.28, 0.78, 0.72, 1, 0, H); B.stone(0.28, 0.22, 0.72, 0.78, 0.7, H - 0.7);
      B.box('wood', '#6a4424', 0.66, 0, 0.5, 0.05, 0.7, 0.56);
      B.merlons(0.28, 0, 0.72, 1, H, 0.2, 0.12);
      B.faces(0.72, 1).banner('x', 0.5, H - 0.05, 0.25);
    }
  },
  wonder(B, s, P, style) {
    B.pad('#8a7a5a', 0.3);
    B.stone(0.1, 0.1, 4.9, 4.9, 0, 0.2); B.stone(0.3, 0.3, 4.7, 4.7, 0.2, 0.18);
    const y0 = 0.38;
    if (style === 'byz') {
      for (const [x, z] of [[0.5, 0.5], [4.5, 0.5], [0.5, 4.5], [4.5, 4.5]]) { B.cyl('plaster', P.wallL, x, y0, z, 0.16, 0.18, 2.9, 10); B.cone('plain', P.dome, x, y0 + 2.9, z, 0.2, 0.55, 10); }
      B.faces(4.3, 4.3).stone(0.7, 0.7, 4.3, 4.3, y0, 1.5);
      for (let i = 0; i < 4; i++) { B.box('glow', '#4a5aa8', 1.2 + i * 0.85, y0 + 0.5, 4.31, 0.2, 0.5, 0.02); B.box('glow', '#4a5aa8', 4.31, y0 + 0.5, 1.2 + i * 0.85, 0.02, 0.5, 0.2); }
      B.dome('plain', P.dome, 2.5, y0 + 1.5, 4.3, 0.9, 0.6);
      B.cyl('plaster', P.wallL, 2.5, y0 + 1.5, 2.5, 1.4, 1.45, 0.5, 24);
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; B.box('dark', '#2a2a40', 2.5 + Math.cos(a) * 1.42, y0 + 1.65, 2.5 + Math.sin(a) * 1.42, 0.08, 0.2, 0.08, -a); }
      B.dome('plain', P.dome, 2.5, y0 + 2.0, 2.5, 1.45, 1.3);
      B.cyl('gold', P.gold, 2.5, y0 + 3.3, 2.5, 0.02, 0.02, 0.45, 5); B.box('gold', P.gold, 2.5, y0 + 3.6, 2.5, 0.22, 0.04, 0.04);
      B.banner('z', 2.5, y0 + 1.4, 0.7);
      return;
    }
    if (style === 'steppe') {
      B.cyl('stone', P.wallL, 2.5, y0, 2.5, 2.0, 2.1, 0.5, 28);
      B.cyl('felt', P.felt, 2.5, y0 + 0.5, 2.5, 1.55, 1.6, 0.55, 28);
      B.cyl('plain', P.pattern, 2.5, y0 + 0.75, 2.5, 1.62, 1.62, 0.12, 28);
      B.cyl('stone', P.wallL, 2.5, y0 + 1.05, 2.5, 1.1, 1.15, 0.45, 24);
      B.dome('gold', P.trim, 2.5, y0 + 1.5, 2.5, 1.15, 1.2);
      B.cyl('gold', '#d6ad3d', 2.5, y0 + 2.7, 2.5, 0.025, 0.03, 0.7, 6);
      for (let i = 0; i < 3; i++) B.sphere('gold', '#d6ad3d', 2.5, y0 + 2.9 + i * 0.16, 2.5, 0.09 - i * 0.02, 0.09 - i * 0.02, 0.09 - i * 0.02);
      for (const [x, z] of [[0.6, 0.6], [4.4, 0.6], [0.6, 4.4], [4.4, 4.4]]) B.flag(x, y0, z, 1.3, 1.3);
      return;
    }
    // gothic cathedral
    B.faces(4.0, 3.4).stone(0.7, 1.6, 4.0, 3.4, y0, 1.6);
    for (let i = 0; i < 4; i++) B.box('glow', '#4a5aa8', 1.1 + i * 0.75, y0 + 0.45, 3.41, 0.2, 0.7, 0.02);
    B.faces(2.9, 4.3).stone(1.9, 0.7, 2.9, 4.3, y0, 1.6);
    B.roof(0.7, 1.6, 4.0, 3.4, y0 + 1.6, 1.0, P.slate, P.wall, 'x');
    B.roof(1.9, 0.7, 2.9, 4.3, y0 + 1.6, 1.0, P.slate, P.wall, 'z');
    for (const z of [1.3, 3.0]) {
      B.faces(4.6, z + 0.7).stone(3.9, z, 4.6, z + 0.7, y0, 3.0);
      B.win('z', 4.25, y0 + 2.2, 0.1, 0.4).win('x', z + 0.35, y0 + 2.2, 0.1, 0.4);
      B.hip(3.9, z, 4.6, z + 0.7, y0 + 3.0, 1.3, P.slate, 0.03);
      B.flag(4.25, y0 + 4.3, z + 0.35, 0.4, 0.8);
    }
    B.faces(4.6, 3.0).stone(3.9, 2.0, 4.6, 3.0, y0, 2.0);
    B.add('glow', GEO.disc, mtx(4.61, y0 + 1.45, 2.5, 0, 0, Math.PI / 2, 0.3, 0.02, 0.3), '#c03a6a');
    B.faces(4.6, 3.0).door('x', 2.5, 0.4, 0.7, y0);
    B.faces(2.9, 4.3).banner('z', 2.4, y0 + 1.5, 0.65);
  },
};

function wall3(B, P, mask, stone) {
  const H = stone ? 0.9 : 0.75;
  const seg = (x0, z0, x1, z1) => {
    if (stone) {
      B.stone(x0, z0, x1, z1, 0, H);
      // merlons along the segment
      const along = x1 - x0 > z1 - z0, len = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(len / 0.24));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (along) B.box('stone', P.wall, x0 + (x1 - x0) * t, H, (z0 + z1) / 2, 0.12, 0.13, z1 - z0);
        else B.box('stone', P.wall, (x0 + x1) / 2, H, z0 + (z1 - z0) * t, x1 - x0, 0.13, 0.12);
      }
    } else {
      const along = x1 - x0 > z1 - z0, len = along ? x1 - x0 : z1 - z0, n = Math.max(2, Math.round(len / 0.11));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, h = H - (i % 3) * 0.05;
        const x = along ? x0 + (x1 - x0) * t : (x0 + x1) / 2, z = along ? (z0 + z1) / 2 : z0 + (z1 - z0) * t;
        B.cyl('bark', i % 2 ? '#8a6438' : '#7a5630', x, 0, z, 0.05, 0.055, h, 6);
        B.cone('bark', '#9a7448', x, h, z, 0.05, 0.1, 6);
      }
      if (along) B.box('wood', '#4a2e16', (x0 + x1) / 2, 0.35, z1 + 0.01, x1 - x0, 0.05, 0.03);
      else B.box('wood', '#4a2e16', x1 + 0.01, 0.35, (z0 + z1) / 2, 0.03, 0.05, z1 - z0);
    }
  };
  const a = 0.32, b = 0.68;
  seg(a, a, b, b);
  if (mask & 1) seg(0.5, a, 1, b);
  if (mask & 4) seg(0, a, 0.5, b);
  if (mask & 2) seg(a, 0.5, b, 1);
  if (mask & 8) seg(a, 0, b, 0.5);
}

function foundation3(B, s, P) {
  B.box('plain', '#8a6e48', s / 2, -0.03, s / 2, s - 0.1, 0.06, s - 0.1);
  for (let i = 0.5; i < s; i += 0.5) { B.box('plain', '#6a5434', i, 0.0, s / 2, 0.02, 0.02, s - 0.1); B.box('plain', '#6a5434', s / 2, 0.0, i, s - 0.1, 0.02, 0.02); }
  for (const [x, z] of [[0.12, 0.12], [s - 0.12, 0.12], [s - 0.12, s - 0.12], [0.12, s - 0.12]]) B.cyl('wood', '#7a5a2a', x, 0, z, 0.025, 0.03, 0.35, 6);
  if (s >= 2) {
    B.box('stone', P.wall, s * 0.6, 0, s * 0.62, 0.35, 0.18, 0.28);
    for (let k = 0; k < 3; k++) B.box('wood', P.wood, s * 0.3, k * 0.06, s * 0.35 + k * 0.03, 0.6, 0.06, 0.1);
  }
}

// --------------------------------------------------------------------------- prototype cache
function buildingProto(type, style, stage, extra) {
  const key = `b|${type}|${style}|${stage}|${extra}`;
  let p = PROTOS.get(key);
  if (p) return p;
  initModelGeo();
  const def = BUILDINGS[type], s = def.size;
  const P = { ...(STYLES[style] || STYLES.west) };
  P.wallL = P.wallL || P.wall; P.dome = P.dome || '#7e95a9'; P.gold = P.gold || '#d6ad3d'; P.felt = P.felt || '#ede5cf'; P.pattern = P.pattern || '#a8352a'; P.trim = P.trim || '#d4b070';
  const B = new BB(P, s);
  const draw = BUILD3[type];
  if (type === 'farm') draw(B, s, P, style, stage === 'done' ? extra : 'b');
  else if (stage === 'b0') foundation3(B, s, P);
  else if (stage === 'b1') {
    foundation3(B, s, P);
    if (def.wall || def.gate) draw(B, s, P, style, extra);
    else { const [x0, z0, x1, z1, h] = mainVol3(type, s); B.stone(x0, z0, x1, z1, 0, h * 0.45); B.scaffold(x0, z0, x1, z1, h * 0.85); }
  } else {
    draw(B, s, P, style, extra);
    if (stage === 'b2' && !def.wall && !def.gate) { const [x0, z0, x1, z1, h] = mainVol3(type, s); B.scaffold(x0, z0, x1, z1, h); }
  }
  const parts = B.build();
  let top = 0;
  for (const q of parts) top = Math.max(top, q.geometry.boundingBox.max.y);
  p = { parts, height: top };
  PROTOS.set(key, p);
  return p;
}

// windmill blades (rotate about local X axis = facing +x)
function millBladesProto() {
  const key = 'mill-blades';
  let p = PROTOS.get(key);
  if (p) return p;
  initModelGeo();
  const B = new ModelBuilder();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    B.add('canvas', GEO.box, mtx(0, Math.cos(a) * 0.38, Math.sin(a) * 0.38, a, 0, 0, 0.02, 0.62, 0.17), '#e8dcbe');
    B.add('wood', GEO.box, mtx(0.015, Math.cos(a) * 0.38, Math.sin(a) * 0.38, a, 0, 0, 0.02, 0.66, 0.025), '#5a3a1e');
  }
  B.add('wood', GEO.sphere, mtx(0, 0, 0, 0, 0, 0, 0.05, 0.05, 0.05), '#3a2410');
  p = { parts: B.build(), height: 0.7 };
  PROTOS.set(key, p);
  return p;
}

// --------------------------------------------------------------------------- trees & resources
function treeProto(kind, sub, felled, lod = 0) {
  const key = `t|${kind}|${sub}|${felled ? 1 : 0}|${lod}`;
  let p = PROTOS.get(key);
  if (p) return p;
  initModelGeo();
  const B = new ModelBuilder();
  const r = mulberry32(kind * 100 + sub * 7 + 3);
  const trunkCol = kind === TREE.BIRCH ? '#e8e4da' : kind === TREE.PALM ? '#9a7a4a' : '#5e3e22';
  if (felled) {
    B.cyl('foliage', trunkCol, 0, 0, 0, 0.1, 0.11, 0.16, 8);
    B.add('foliage', GEO.disc, mtx(0, 0.165, 0, 0, 0, 0, 0.1, 0.01, 0.1), '#d8b47c');
    B.add('foliage', cylGeo(0.85, 8), mtx(0.42, 0.08, 0.1, 0, 0.4, Math.PI / 2, 0.08, 0.75, 0.08), trunkCol);
    B.add('foliage', GEO.disc, mtx(0.05, 0.08, -0.05, 0, 0.4, Math.PI / 2, 0.085, 0.01, 0.085), '#d8b47c');
  } else if (kind === TREE.PINE || kind === TREE.SNOWPINE) {
    const h = 1.9 + r() * 0.7, w = 0.42 + r() * 0.1;
    B.cyl('foliage', '#4a3018', 0, 0, 0, 0.05, 0.08, 0.5, 6);
    const tiers = lod ? 2 : 4;
    for (let i = 0; i < tiers; i++) {
      const k = lod ? i * 2 : i;
      const y = 0.35 + k * h * 0.19, rr = w * (1 - k * 0.2), hh = h * (lod ? 0.55 : 0.36);
      B.cone('foliage', ['#2c5a2c', '#245026', '#306030', '#1e4a24'][k], 0, y, 0, rr, hh, lod ? 5 : 7, r() * 3);
      if (kind === TREE.SNOWPINE) B.cone('foliage', '#f4f8fa', 0, y + hh * 0.45, 0, rr * 0.55, hh * 0.55, lod ? 5 : 7);
    }
  } else if (kind === TREE.PALM) {
    const h = 1.6 + r() * 0.5, lean = (r() - 0.5) * 0.35;
    for (let i = 0; i < 6; i++) { const t = i / 6; B.add('foliage', cylGeo(0.9, 6), mtx(lean * t * t, t * h + h / 12, 0, 0, 0, -lean * 0.5, 0.06, h / 6 + 0.02, 0.06), i % 2 ? '#8a6a3a' : '#9a7a4a'); }
    const tx = lean, ty = h;
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + r() * 0.3;
      B.add('foliage', GEO.box, mtx(tx + Math.cos(a) * 0.32, ty - 0.05, Math.sin(a) * 0.32, 0, -a, -0.45, 0.65, 0.025, 0.16), i % 2 ? '#3e7a2a' : '#5a9a34');
    }
    B.sphere('foliage', '#5a3a1a', tx, ty - 0.08, 0.05, 0.06, 0.06, 0.06);
  } else {
    const birch = kind === TREE.BIRCH;
    const th = birch ? 0.85 : 0.6;
    B.cyl('foliage', trunkCol, 0, 0, 0, 0.06, 0.09, th + 0.3, 7);
    if (birch) for (let i = 0; i < 4; i++) B.box('foliage', '#2a2622', 0, 0.15 + i * 0.2, 0.07, 0.08, 0.03, 0.02);
    const cy = th + 0.45, rad = birch ? 0.42 : 0.55;
    const cols = birch ? ['#6a9a32', '#7aaa3a', '#5a8a2e'] : ['#2e5a22', '#3a6a28', '#447a2e'];
    for (let i = 0; i < (lod ? 2 : 6); i++) {
      const a = r() * Math.PI * 2, d = r() * rad * (lod ? 0.3 : 0.55);
      const s = rad * (lod ? 0.8 : 0.5 + r() * 0.35);
      B.ico('foliage', cols[i % 3], Math.cos(a) * d, cy + (r() - 0.3) * rad * 0.6, Math.sin(a) * d, s, r() * 3);
    }
    if (!lod) B.ico('foliage', cols[2], 0, cy + rad * 0.45, 0, rad * 0.55, 1.3);
  }
  p = { parts: B.build(), height: 2 };
  PROTOS.set(key, p);
  return p;
}

function resourceProto(type, stage, sub) {
  const key = `r|${type}|${stage}|${sub}`;
  let p = PROTOS.get(key);
  if (p) return p;
  initModelGeo();
  const B = new ModelBuilder();
  const r = mulberry32(sub * 13 + stage * 7 + type.length);
  const k = [1, 0.8, 0.6, 0.4][stage];
  if (type === 'berry') {
    for (const [x, z, s] of [[-0.15, -0.05, 0.22], [0.15, -0.08, 0.2], [0, 0.12, 0.22], [0.02, -0.02, 0.24]]) B.ico('foliage', '#3f7a2e', x, 0.18, z, s, r() * 3);
    const nb = Math.round(18 * k * k);
    for (let i = 0; i < nb; i++) { const a = r() * Math.PI * 2, d = 0.15 + r() * 0.1; B.sphere('plain', r() < 0.5 ? '#c02a4a' : '#8a1a5a', Math.cos(a) * d, 0.12 + r() * 0.25, Math.sin(a) * d, 0.035, 0.035, 0.035); }
  } else if (type === 'gold' || type === 'stone') {
    const gold = type === 'gold';
    const n = Math.round(5 * k) + 2;
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 0.7 * k, z = (r() - 0.5) * 0.7 * k, s = (0.12 + r() * 0.16) * (0.6 + k * 0.4);
      B.ico('rock', gold ? '#8a7a5e' : '#9a968c', x, s * 0.5, z, s, r() * 5);
      if (gold) for (let j = 0; j < 3; j++) B.ico('gold', '#f2c832', x + (r() - 0.5) * s, s * (0.5 + r() * 0.6), z + (r() - 0.5) * s, 0.035 + r() * 0.03, r() * 4);
    }
  } else if (type === 'carcass') {
    const col = { sheep: '#e8e6dc', deer: '#9a6634', boar: '#4a3626', wolf: '#86847a' }[sub] || '#9a6634';
    B.sphere('plain', col, 0, 0.08, 0, 0.26 * k + 0.05, 0.09, 0.14);
    B.sphere('plain', '#b8322a', 0.02, 0.12, 0, 0.14 * k + 0.03, 0.05, 0.08);
    for (const x of [-0.06, 0.04, 0.12]) B.box('plain', '#f0d8c8', x, 0.12, 0, 0.02, 0.06, 0.1);
  }
  p = { parts: B.build(), height: 0.5 };
  PROTOS.set(key, p);
  return p;
}
