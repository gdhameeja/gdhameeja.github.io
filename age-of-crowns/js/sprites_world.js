'use strict';
// ============================================================================
//  World sprites: terrain textures (+ feathered blend masks), decorations,
//  trees, berry bushes, mines, and UI resource icons.
// ============================================================================

const TERRAIN_VARIANTS = 4;
const TEX = { base: [], blend: [] };

function diamondPath(ctx, cx, cy, hw, hh) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath();
}

// Paint a texture patch for a terrain into ctx over the rect (w x h)
function paintTerrainTexture(ctx, t, v, w, h, seed) {
  const T_ = TERRAINS[t];
  const r = mulberry32(seed);
  ctx.fillStyle = T_.base[0];
  ctx.fillRect(0, 0, w, h);
  // soft blotches (kept subtle so tile edges don't read as a grid)
  for (let i = 0; i < 7; i++) {
    const x = r() * w, y = r() * h, rad = 6 + r() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = T_.base[(v + i + 1) % T_.base.length];
    g.addColorStop(0, rgba(c, 0.3)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const sp = () => T_.speck[Math.floor(r() * T_.speck.length)];
  switch (t) {
    case T.GRASS: case T.LEAVES: {
      // short blades leaning in slightly different directions
      for (let i = 0; i < 230; i++) {
        const x = r() * w, y = r() * h, len = 1 + r() * 2.2, lean = (r() - 0.5) * 1.4;
        ctx.strokeStyle = rgba(sp(), 0.55 + r() * 0.45); ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lean, y - len); ctx.stroke();
      }
      if (t === T.LEAVES) for (let i = 0; i < 26; i++) {
        const x = r() * w, y = r() * h;
        ctx.fillStyle = ['#7a5a2a', '#8e6a30', '#5e4420', '#9a7a3a'][Math.floor(r() * 4)];
        ctx.save(); ctx.translate(x, y); ctx.rotate(r() * 3); ctx.beginPath(); ctx.ellipse(0, 0, 1.4, 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      break;
    }
    case T.DIRT: {
      for (let i = 0; i < 90; i++) { ctx.fillStyle = rgba(sp(), 0.7); ctx.fillRect(r() * w, r() * h, 1 + r(), 1); }
      for (let i = 0; i < 14; i++) {
        const x = r() * w, y = r() * h, rr = 0.7 + r() * 1.1;
        ctx.fillStyle = 'rgba(70,56,36,0.8)'; ctx.beginPath(); ctx.ellipse(x, y + 0.4, rr, rr * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(190,170,130,0.8)'; ctx.beginPath(); ctx.ellipse(x - 0.2, y, rr * 0.7, rr * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(80,60,36,0.35)'; ctx.lineWidth = 0.5;
      for (let i = 0; i < 3; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3 + r() * 4, y + (r() - 0.5) * 2); ctx.lineTo(x + 6 + r() * 4, y + (r() - 0.5) * 3); ctx.stroke(); }
      break;
    }
    case T.SAND: {
      for (let i = 0; i < 7; i++) {
        const y = r() * h, x = r() * w;
        ctx.strokeStyle = 'rgba(170,140,85,0.32)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.bezierCurveTo(x - 4, y - 1.5, x + 2, y + 1.2, x + 10, y - 0.5); ctx.stroke();
        ctx.strokeStyle = 'rgba(250,236,200,0.35)';
        ctx.beginPath(); ctx.moveTo(x - 10, y - 0.8); ctx.bezierCurveTo(x - 4, y - 2.3, x + 2, y + 0.4, x + 10, y - 1.3); ctx.stroke();
      }
      for (let i = 0; i < 50; i++) { ctx.fillStyle = rgba(sp(), 0.7); ctx.fillRect(r() * w, r() * h, 0.8, 0.8); }
      break;
    }
    case T.SNOW: {
      for (let i = 0; i < 5; i++) {
        const x = r() * w, y = r() * h, rad = 5 + r() * 8;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(150,175,210,0.25)'); g.addColorStop(1, 'rgba(150,175,210,0)');
        ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? '#ffffff' : 'rgba(170,190,215,0.8)'; ctx.fillRect(r() * w, r() * h, 1, 1); }
      break;
    }
    case T.ICE: {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.6;
      for (let i = 0; i < 4; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4 + r() * 5, y + (r() - 0.5) * 4); ctx.lineTo(x + 8 + r() * 6, y + (r() - 0.5) * 5); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7, y - 3.5); ctx.stroke(); }
      break;
    }
    case T.WATER: case T.SHALLOW: {
      ctx.strokeStyle = t === T.WATER ? 'rgba(130,180,220,0.22)' : 'rgba(210,235,235,0.25)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 6; i++) {
        const x = r() * w, y = r() * h;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y - 1.5, x + 8, y); ctx.stroke();
      }
      if (t === T.SHALLOW) for (let i = 0; i < 18; i++) { ctx.fillStyle = 'rgba(200,180,120,0.35)'; ctx.fillRect(r() * w, r() * h, 1.2, 0.8); }
      break;
    }
  }
}

function buildTerrainTextures() {
  for (let t = 0; t < TERRAINS.length; t++) {
    TEX.base[t] = []; TEX.blend[t] = [];
    for (let v = 0; v < TERRAIN_VARIANTS; v++) {
      // base diamond tile (slightly oversized to hide seams)
      const c = makeCanvas(TW + 2, TH + 2);
      const ctx = c.getContext('2d');
      diamondPath(ctx, (TW + 2) / 2, (TH + 2) / 2, HW + 1, HH + 1);
      ctx.save(); ctx.clip();
      paintTerrainTexture(ctx, t, v, TW + 2, TH + 2, t * 100 + v * 7 + 1);
      ctx.restore();
      TEX.base[t][v] = c;
      // feathered blob for blending into neighbours (1.6x tile)
      const bw = Math.round(TW * 1.6), bh = Math.round(TH * 1.6);
      const b = makeCanvas(bw, bh);
      const bx = b.getContext('2d');
      paintTerrainTexture(bx, t, v, bw, bh, t * 100 + v * 7 + 50);
      bx.globalCompositeOperation = 'destination-in';
      bx.save();
      bx.translate(bw / 2, bh / 2); bx.scale(1, 0.5);
      const g = bx.createRadialGradient(0, 0, bw * 0.18, 0, 0, bw * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      bx.fillStyle = g; bx.fillRect(-bw / 2, -bw / 2, bw, bw);
      bx.restore();
      TEX.blend[t][v] = b;
    }
  }
}

// Small ground decorations drawn into terrain chunks
function drawDecor(ctx, t, x, y, h) {
  const r = mulberry32(Math.floor(h * 1e9));
  const k = r();
  const tuft = (cx, cy, col, n = 5, hgt = 3.5) => {
    ctx.lineWidth = 0.9;
    for (let i = 0; i < n; i++) {
      const dx = (r() - 0.5) * 5;
      ctx.strokeStyle = i % 2 ? col : shade(col, 1.25);
      ctx.beginPath(); ctx.moveTo(cx + dx, cy); ctx.quadraticCurveTo(cx + dx + (r() - 0.5) * 2, cy - hgt * 0.6, cx + dx + (r() - 0.5) * 3, cy - hgt - r() * 2); ctx.stroke();
    }
  };
  const rock = (cx, cy, s, col = '#8a8478', snow = false) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(cx + 1, cy + 0.6, s * 1.3, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(col, 0.75); ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx - s * 0.6, cy - s * 0.9); ctx.lineTo(cx + s * 0.5, cy - s); ctx.lineTo(cx + s, cy - s * 0.2); ctx.lineTo(cx + s * 0.6, cy + s * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx - s * 0.6, cy - s * 0.9); ctx.lineTo(cx + s * 0.5, cy - s); ctx.lineTo(cx + s * 0.1, cy - s * 0.3); ctx.lineTo(cx - s * 0.7, cy - s * 0.3); ctx.closePath(); ctx.fill();
    if (snow) { ctx.fillStyle = '#f6fafc'; ctx.beginPath(); ctx.ellipse(cx - 0.1, cy - s * 0.85, s * 0.6, s * 0.25, 0, 0, Math.PI * 2); ctx.fill(); }
  };
  const shrub = (cx, cy, col) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(cx + 2, cy + 0.5, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    for (const [dx, dy, rr] of [[-2, -2, 2.6], [1.8, -2.4, 2.4], [0, -3.8, 2.6]]) { ctx.fillStyle = shade(col, 0.8); ctx.beginPath(); ctx.arc(cx + dx + 0.5, cy + dy + 0.5, rr, 0, Math.PI * 2); ctx.fill(); }
    for (const [dx, dy, rr] of [[-2, -2.3, 2], [1.8, -2.7, 1.8], [0, -4.1, 2]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = shade(col, 1.3); ctx.beginPath(); ctx.arc(cx - 0.8, cy - 4.8, 1, 0, Math.PI * 2); ctx.fill();
  };
  if (t === T.GRASS || t === T.LEAVES) {
    if (k < 0.42) tuft(x, y, t === T.GRASS ? '#4f8228' : '#3e5c22', 5 + Math.floor(r() * 4));
    else if (k < 0.56 && t === T.GRASS) {
      const fc = ['#f2e660', '#f6f6f6', '#d878c8', '#e8653c', '#8aa8f0'][Math.floor(r() * 5)];
      for (let i = 0; i < 6; i++) { const fx = x + (r() - 0.5) * 9, fy = y + (r() - 0.5) * 4; ctx.strokeStyle = '#4a7a24'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(fx, fy + 1.5); ctx.lineTo(fx, fy); ctx.stroke(); ctx.fillStyle = fc; ctx.fillRect(fx - 0.7, fy - 0.7, 1.5, 1.5); }
    } else if (k < 0.66) rock(x, y, 1.6 + r() * 1.4, t === T.LEAVES ? '#7a7466' : '#8f897d');
    else if (k < 0.76) shrub(x, y, t === T.GRASS ? '#4a7d2c' : '#3f6426');
    else if (t === T.LEAVES) { ctx.strokeStyle = '#5a4428'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y - 1.2); ctx.moveTo(x, y - 0.6); ctx.lineTo(x + 1.5, y - 2.2); ctx.stroke(); }
  } else if (t === T.DIRT) {
    if (k < 0.45) rock(x, y, 1.2 + r() * 1.6, '#9a8a6c');
    else if (k < 0.65) tuft(x, y, '#6e8a34', 4, 2.8);
    else if (k < 0.72) { ctx.strokeStyle = '#6a4e2a'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y - 1); ctx.stroke(); }
  } else if (t === T.SAND) {
    if (k < 0.3) tuft(x, y, '#9a9440', 6, 4);
    else if (k < 0.5) rock(x, y, 1.3 + r(), '#c2ac7c');
    else if (k < 0.56) { ctx.strokeStyle = '#7a8a3a'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (i - 2) * 2.2, y - 3 - r() * 2); ctx.stroke(); } }
  } else if (t === T.SNOW) {
    if (k < 0.3) { ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 3, y + 1, 1, 1); ctx.fillRect(x - 2, y + 2, 1, 1); }
    else if (k < 0.48) rock(x, y, 1.6 + r() * 1.4, '#7c7a76', true);
    else if (k < 0.56) tuft(x, y, '#7a7a5a', 4, 3);
  }
}

// ------------------------------------------------------------------ trees
const WSPRITES = new Map();
function getTreeSprite(kind, sub, chopped) {
  const key = `tree|${kind}|${sub}|${chopped ? 1 : 0}`;
  let s = WSPRITES.get(key);
  if (s) return s;
  const W = 84, H = 128, ax = 42, ay = 116;
  const c = makeCanvas(W * SPR_SCALE, H * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE); ctx.translate(ax, ay);
  const r = mulberry32(kind * 1000 + sub * 37 + 5);
  if (chopped) {
    ellipseShadow(ctx, 0, 0, 10, 3.5, 0.25);
    const trunk = kind === TREE.BIRCH ? '#e8e4da' : kind === TREE.PALM ? '#9a7a4a' : '#6a4626';
    // fallen log
    ctx.save(); ctx.rotate(-0.25);
    ctx.fillStyle = trunk; ctx.fillRect(-2, -5, 20, 4.5);
    ctx.fillStyle = '#d8b47c'; ctx.beginPath(); ctx.ellipse(-2, -2.75, 1.5, 2.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = trunk; ctx.fillRect(-3, -6, 6, 6);
    ctx.fillStyle = '#d8b47c'; ctx.beginPath(); ctx.ellipse(0, -6, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.ellipse(0, -6, 1.6, 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    s = { c, w: W, h: H, ax, ay }; WSPRITES.set(key, s); return s;
  }
  const sc = 1.15 + r() * 0.35;
  ellipseShadow(ctx, 3, 0, 15 * sc, 5 * sc, 0.28);
  if (kind === TREE.PINE || kind === TREE.SNOWPINE) {
    const h = 56 * sc, wd = 15 * sc;
    ctx.fillStyle = '#4a3018'; ctx.fillRect(-2, -10, 4, 10);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const y0 = -8 - i * (h / tiers) * 0.85, y1 = y0 - h / tiers * 1.5, w = wd * (1 - i * 0.2);
      const g = ctx.createLinearGradient(-w, 0, w, 0);
      g.addColorStop(0, '#3d6a34'); g.addColorStop(0.5, '#28502a'); g.addColorStop(1, '#173a1e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-w, y0); ctx.lineTo(0, y1); ctx.lineTo(w, y0); ctx.quadraticCurveTo(0, y0 + 3, -w, y0); ctx.fill();
      if (kind === TREE.SNOWPINE) {
        ctx.fillStyle = '#f4f8fa';
        ctx.beginPath(); ctx.moveTo(-w * 0.55, y1 + (y0 - y1) * 0.45); ctx.lineTo(0, y1); ctx.lineTo(w * 0.4, y1 + (y0 - y1) * 0.4); ctx.quadraticCurveTo(0, y1 + (y0 - y1) * 0.6, -w * 0.55, y1 + (y0 - y1) * 0.45); ctx.fill();
        ctx.fillRect(-w * 0.8, y0 - 1.5, w * 0.7, 1.4);
      }
    }
  } else if (kind === TREE.PALM) {
    const lean = (r() - 0.5) * 10;
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 0.2, -25, lean, -46 * sc); ctx.stroke();
    ctx.strokeStyle = '#6a4a22'; ctx.lineWidth = 0.6;
    for (let t = 0.1; t < 1; t += 0.1) { const y = -46 * sc * t, x = lean * t * t; ctx.beginPath(); ctx.moveTo(x - 1.8, y); ctx.lineTo(x + 1.8, y - 1); ctx.stroke(); }
    const tx = lean, ty = -46 * sc;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.3, len = 14 + r() * 5;
      const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.5 + 5;
      ctx.strokeStyle = i % 2 ? '#3e7a2a' : '#5a9a34'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + ex) / 2, ty - 6, ex, ey); ctx.stroke();
    }
    ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.arc(tx - 1.5, ty + 2, 1.6, 0, Math.PI * 2); ctx.arc(tx + 1.6, ty + 2.4, 1.6, 0, Math.PI * 2); ctx.fill();
  } else {
    const birch = kind === TREE.BIRCH;
    const th = (birch ? 26 : 20) * sc;
    ctx.fillStyle = birch ? '#ece8de' : '#5e3e22';
    ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-1.6, -th); ctx.lineTo(1.6, -th); ctx.lineTo(2.6, 0); ctx.closePath(); ctx.fill();
    if (birch) { ctx.fillStyle = '#2a2622'; for (let i = 0; i < 5; i++) ctx.fillRect(-2 + r() * 2, -4 - i * 4.5, 2 + r() * 1.5, 0.9); }
    else { ctx.fillStyle = '#4a2e18'; ctx.fillRect(0.4, -th, 1.2, th); }
    const cy = -th - 10 * sc, rad = (birch ? 10 : 13) * sc;
    const dark = birch ? '#5a8a2e' : '#2e5a22', mid = birch ? '#7aa83a' : '#41752c', light = birch ? '#a8c858' : '#62953a';
    const blobs = [];
    for (let i = 0; i < 7; i++) { const a = r() * Math.PI * 2, d = r() * rad * 0.6; blobs.push([Math.cos(a) * d, cy + Math.sin(a) * d * 0.75, rad * (0.55 + r() * 0.3)]); }
    ctx.fillStyle = dark;
    for (const [x, y, rr] of blobs) { ctx.beginPath(); ctx.arc(x + 1.5, y + 2, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = mid;
    for (const [x, y, rr] of blobs) { ctx.beginPath(); ctx.arc(x, y, rr * 0.9, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = light;
    for (const [x, y, rr] of blobs) { ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.35, rr * 0.45, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(20,40,10,0.35)';
    for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2, d = r() * rad; ctx.fillRect(Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 1.2, 1.2); }
  }
  s = { c, w: W, h: H, ax, ay };
  WSPRITES.set(key, s);
  return s;
}

function getResourceSprite(type, stage, sub) {
  const key = `res|${type}|${stage}|${sub}`;
  let s = WSPRITES.get(key);
  if (s) return s;
  const W = 64, H = 48, ax = 32, ay = 36;
  const c = makeCanvas(W * SPR_SCALE, H * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE); ctx.translate(ax, ay);
  const r = mulberry32(sub * 13 + stage * 7 + type.length);
  const k = [1, 0.8, 0.6, 0.4][stage];
  if (type === 'berry') {
    ellipseShadow(ctx, 2, 0, 15, 5, 0.25);
    const blobs = [[-7, -6, 7], [6, -6, 7], [0, -10, 8], [-2, -4, 7], [4, -3, 6]];
    for (const [x, y, rr] of blobs) { ctx.fillStyle = '#2c5a24'; ctx.beginPath(); ctx.arc(x + 1, y + 1, rr, 0, Math.PI * 2); ctx.fill(); }
    for (const [x, y, rr] of blobs) { ctx.fillStyle = '#3f7a2e'; ctx.beginPath(); ctx.arc(x, y, rr * 0.85, 0, Math.PI * 2); ctx.fill(); }
    for (const [x, y, rr] of blobs) { ctx.fillStyle = '#5a9a3a'; ctx.beginPath(); ctx.arc(x - 2, y - 2, rr * 0.4, 0, Math.PI * 2); ctx.fill(); }
    const nb = Math.round(22 * k * k);
    for (let i = 0; i < nb; i++) {
      const a = r() * Math.PI * 2, d = r() * 10;
      const x = Math.cos(a) * d, y = -7 + Math.sin(a) * d * 0.6;
      ctx.fillStyle = r() < 0.5 ? '#c02a4a' : '#8a1a5a'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x - 0.6, y - 0.8, 0.6, 0.6);
    }
  } else {
    const gold = type === 'gold';
    ellipseShadow(ctx, 0, 0, 20 * k + 4, 7 * k + 2, 0.3);
    const rocks = [];
    const n = Math.round(7 * k) + 2;
    for (let i = 0; i < n; i++) rocks.push([(r() - 0.5) * 26 * k, -r() * 4 * k, (4 + r() * 6) * (0.6 + k * 0.4)]);
    rocks.sort((a, b) => a[1] - b[1]);
    for (const [x, y, rr] of rocks) {
      const base = gold ? '#8a7a5e' : '#8e8a82', lt = gold ? '#b0a080' : '#bab6ac', dk = gold ? '#5a4c36' : '#5e5a54';
      ctx.fillStyle = dk;
      ctx.beginPath(); ctx.moveTo(x - rr, y); ctx.lineTo(x - rr * 0.6, y - rr * 1.1); ctx.lineTo(x + rr * 0.4, y - rr * 1.3); ctx.lineTo(x + rr, y - rr * 0.3); ctx.lineTo(x + rr * 0.6, y + rr * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.moveTo(x - rr, y); ctx.lineTo(x - rr * 0.6, y - rr * 1.1); ctx.lineTo(x + rr * 0.4, y - rr * 1.3); ctx.lineTo(x + rr * 0.1, y - rr * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lt;
      ctx.beginPath(); ctx.moveTo(x - rr * 0.6, y - rr * 1.1); ctx.lineTo(x + rr * 0.4, y - rr * 1.3); ctx.lineTo(x, y - rr * 0.7); ctx.closePath(); ctx.fill();
      if (gold) {
        for (let j = 0; j < 3; j++) {
          const gx = x + (r() - 0.5) * rr, gy = y - r() * rr;
          ctx.fillStyle = '#f2c832'; ctx.beginPath(); ctx.arc(gx, gy, 1.2 + r() * 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff4b0'; ctx.fillRect(gx - 0.5, gy - 0.9, 0.8, 0.8);
        }
      } else {
        ctx.strokeStyle = 'rgba(60,56,50,0.5)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x - rr * 0.3, y - rr * 0.9); ctx.lineTo(x + rr * 0.2, y - rr * 0.3); ctx.stroke();
      }
    }
  }
  s = { c, w: W, h: H, ax, ay };
  WSPRITES.set(key, s);
  return s;
}

// ------------------------------------------------------------------ UI icons (resources / misc)
function resIcon(res, size = 20) {
  const c = makeCanvas(size * 2, size * 2);
  const ctx = c.getContext('2d');
  ctx.scale(2 * size / 20, 2 * size / 20);
  ctx.translate(10, 10);
  if (res === 'food') {
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(-1, 1, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8705a'; ctx.beginPath(); ctx.arc(-3, -1, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-1, -5); ctx.lineTo(1, -8.5); ctx.stroke();
    ctx.fillStyle = '#4a8a2a'; ctx.beginPath(); ctx.ellipse(3, -7, 3, 1.4, -0.4, 0, Math.PI * 2); ctx.fill();
  } else if (res === 'wood') {
    ctx.fillStyle = '#7a4c26'; ctx.beginPath(); ctx.ellipse(-1, 3, 8, 3.2, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a5a30'; ctx.beginPath(); ctx.ellipse(1, -2, 8, 3.2, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0bc84'; ctx.beginPath(); ctx.ellipse(7.5, -4.4, 2, 2.8, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(7.5, -4.4, 1, 0, Math.PI * 2); ctx.stroke();
  } else if (res === 'gold') {
    for (const [x, y] of [[-3, 3], [3, 3], [0, -2]]) {
      ctx.fillStyle = '#a07a10'; ctx.beginPath(); ctx.ellipse(x, y + 1, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2c832'; ctx.beginPath(); ctx.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff0a0'; ctx.fillRect(x - 2, y - 1.5, 2, 1);
    }
  } else if (res === 'stone') {
    ctx.fillStyle = '#6e6a62'; ctx.beginPath(); ctx.moveTo(-8, 5); ctx.lineTo(-6, -4); ctx.lineTo(1, -7); ctx.lineTo(8, -2); ctx.lineTo(7, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a8a49a'; ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(1, -7); ctx.lineTo(8, -2); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d0ccc2'; ctx.beginPath(); ctx.moveTo(-3, -4.6); ctx.lineTo(1, -6.2); ctx.lineTo(2, -3.6); ctx.closePath(); ctx.fill();
  } else if (res === 'pop') {
    ctx.fillStyle = '#e8d8b0'; ctx.beginPath(); ctx.arc(-3.5, -3, 3, 0, Math.PI * 2); ctx.arc(3.5, -3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-3.5, 5, 4.5, 4, 0, Math.PI, Math.PI * 2); ctx.ellipse(3.5, 5, 4.5, 4, 0, Math.PI, Math.PI * 2); ctx.fill();
  } else if (res === 'time') {
    ctx.strokeStyle = '#e8d8b0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -5); ctx.moveTo(0, 0); ctx.lineTo(4, 2); ctx.stroke();
  }
  return c;
}
