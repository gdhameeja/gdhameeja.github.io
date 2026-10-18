'use strict';
// ============================================================================
//  Shared graphics helpers: canvases, colours, isometric primitives.
// ============================================================================

const SPR_SCALE = 2;  // sprites are rasterised at 2x for crisp zooming

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

function hexRgb(h) {
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
const SHADE_CACHE = new Map();
function shade(hex, f) {
  const k = hex + f;
  let v = SHADE_CACHE.get(k);
  if (v) return v;
  const [r, g, b] = hexRgb(hex);
  v = f <= 1 ? rgbHex(r * f, g * f, b * f) : rgbHex(r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1));
  SHADE_CACHE.set(k, v);
  return v;
}
function mixc(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// ---- isometric projection in tile units (z in pixels, up)
const iso = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];

function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function line(ctx, a, b, col, lw = 1) {
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
}
const OUTLINE = 'rgba(20,14,8,0.45)';

// An axis-aligned box in tile space. Visible faces: left (y=y1), right (x=x1), top.
// Vertical wall shading: light at the top, ambient occlusion near the ground
function wallGrad(ctx, col, a, b, h) {
  if (typeof col !== 'string' || h < 5) return col;
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, shade(col, 1.1)); g.addColorStop(0.55, col);
  g.addColorStop(Math.max(0.6, 1 - 5 / h), shade(col, 0.86)); g.addColorStop(1, shade(col, 0.62));
  return g;
}
function box(ctx, x0, y0, x1, y1, z0, z1, top, left, right, outline = OUTLINE) {
  const h = z1 - z0;
  poly(ctx, [iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)], wallGrad(ctx, left, iso(x0, y1, z1), iso(x0, y1, z0), h), outline, 0.6);
  poly(ctx, [iso(x1, y1, z0), iso(x1, y0, z0), iso(x1, y0, z1), iso(x1, y1, z1)], wallGrad(ctx, right, iso(x1, y1, z1), iso(x1, y1, z0), h), outline, 0.6);
  if (top) poly(ctx, [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)], top, outline, 0.6);
  // sunlit edge highlight
  if (h >= 8) line(ctx, iso(x1, y1, z0 + 1), iso(x1, y1, z1), 'rgba(255,245,220,0.25)', 0.8);
}
// Rows of roof tiles across a quad slope (eave a->b, ridge d->c)
function roofTiles(ctx, a, b, c, d, rows, cols, dark) {
  ctx.save();
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.clip();
  const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  // eave-to-ridge shading
  const g = ctx.createLinearGradient(...L(a, b, 0.5), ...L(d, c, 0.5));
  g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(255,240,210,0.16)');
  ctx.fillStyle = g; ctx.fillRect(-500, -500, 1000, 1000);
  ctx.lineWidth = 0.6;
  for (let r = 1; r < rows; r++) {
    const t = r / rows;
    const p = L(a, d, t), q = L(b, c, t);
    ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,210,0.16)'; ctx.beginPath(); ctx.moveTo(p[0], p[1] - 0.7); ctx.lineTo(q[0], q[1] - 0.7); ctx.stroke();
    // staggered joints between the rows
    const t0 = (r - 1) / rows;
    for (let k = (r % 2 ? 0.5 : 1); k < cols; k++) {
      const u = k / cols;
      const e = L(L(a, d, t0), L(b, c, t0), u), f = L(p, q, u);
      ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(f[0], f[1]); ctx.stroke();
    }
  }
  ctx.restore();
}

// Masonry courses + staggered joints on the left face (y = y) and right face (x = x)
function bricksL(ctx, x0, x1, y, z0, z1, rowH, bw, col) {
  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = 0.5;
  ctx.beginPath();
  let row = 0;
  for (let z = z0 + rowH; z < z1 - 0.5; z += rowH, row++) {
    const a = iso(x0, y, z), b = iso(x1, y, z);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  row = 0;
  for (let z = z0; z < z1 - 0.5; z += rowH, row++) {
    for (let x = x0 + (row % 2 ? bw / 2 : bw); x < x1 - 0.05; x += bw) {
      const a = iso(x, y, z), b = iso(x, y, Math.min(z1, z + rowH));
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
  }
  ctx.stroke();
  ctx.restore();
}
function bricksR(ctx, x, y0, y1, z0, z1, rowH, bw, col) {
  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = 0.5;
  ctx.beginPath();
  let row = 0;
  for (let z = z0 + rowH; z < z1 - 0.5; z += rowH) {
    const a = iso(x, y0, z), b = iso(x, y1, z);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  for (let z = z0; z < z1 - 0.5; z += rowH, row++) {
    for (let y = y0 + (row % 2 ? bw / 2 : bw); y < y1 - 0.05; y += bw) {
      const a = iso(x, y, z), b = iso(x, y, Math.min(z1, z + rowH));
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
  }
  ctx.stroke();
  ctx.restore();
}
// vertical planks / timber beams
function beamsL(ctx, x0, x1, y, z0, z1, step, col, lw = 1.2) {
  for (let x = x0; x <= x1 + 1e-3; x += step) line(ctx, iso(x, y, z0), iso(x, y, z1), col, lw);
}
function beamsR(ctx, x, y0, y1, z0, z1, step, col, lw = 1.2) {
  for (let y = y0; y <= y1 + 1e-3; y += step) line(ctx, iso(x, y, z0), iso(x, y, z1), col, lw);
}

// door (arched) centred at u on the left face
function doorL(ctx, xc, y, w, h, col = '#2a1c12', frame = null) {
  const a = iso(xc - w / 2, y, 0), b = iso(xc + w / 2, y, 0), c = iso(xc + w / 2, y, h), d = iso(xc - w / 2, y, h);
  const top = iso(xc, y, h + w * 9);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(d[0], d[1]);
  ctx.quadraticCurveTo(top[0] - (c[0] - d[0]) * 0.1, top[1], c[0], c[1]);
  ctx.lineTo(b[0], b[1]); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 1; ctx.stroke(); }
}
function doorR(ctx, x, yc, w, h, col = '#2a1c12', frame = null) {
  const a = iso(x, yc + w / 2, 0), b = iso(x, yc - w / 2, 0), c = iso(x, yc - w / 2, h), d = iso(x, yc + w / 2, h);
  const top = iso(x, yc, h + w * 9);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(d[0], d[1]);
  ctx.quadraticCurveTo(top[0], top[1], c[0], c[1]);
  ctx.lineTo(b[0], b[1]); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 1; ctx.stroke(); }
}
function winL(ctx, xc, y, z, w, h, col = '#1e1812') {
  poly(ctx, [iso(xc - w / 2, y, z), iso(xc + w / 2, y, z), iso(xc + w / 2, y, z + h), iso(xc - w / 2, y, z + h)], col);
}
function winR(ctx, x, yc, z, w, h, col = '#1e1812') {
  poly(ctx, [iso(x, yc + w / 2, z), iso(x, yc - w / 2, z), iso(x, yc - w / 2, z + h), iso(x, yc + w / 2, z + h)], col);
}

// Roofs ---------------------------------------------------------------
function roofGableX(ctx, x0, y0, x1, y1, z, h, ov, cFront, cBack, cEnd, lines = null) {
  const ym = (y0 + y1) / 2;
  poly(ctx, [iso(x0 - ov, y0 - ov, z), iso(x1 + ov, y0 - ov, z), iso(x1 + ov, ym, z + h), iso(x0 - ov, ym, z + h)], cBack, OUTLINE, 0.6);
  poly(ctx, [iso(x1, y1, z), iso(x1, y0, z), iso(x1, ym, z + h)], cEnd, OUTLINE, 0.6);
  poly(ctx, [iso(x0 - ov, y1 + ov, z), iso(x1 + ov, y1 + ov, z), iso(x1 + ov, ym, z + h), iso(x0 - ov, ym, z + h)], cFront, OUTLINE, 0.6);
  roofTiles(ctx, iso(x0 - ov, y1 + ov, z), iso(x1 + ov, y1 + ov, z), iso(x1 + ov, ym, z + h), iso(x0 - ov, ym, z + h), Math.max(3, Math.round(h / 2.6)), Math.max(4, Math.round((x1 - x0) * 7)), lines || 'rgba(0,0,0,0.25)');
  line(ctx, iso(x0 - ov, ym, z + h), iso(x1 + ov, ym, z + h), shade(cFront, 0.6), 1.3);
}
function roofGableY(ctx, x0, y0, x1, y1, z, h, ov, cFront, cBack, cEnd, lines = null) {
  const xm = (x0 + x1) / 2;
  poly(ctx, [iso(x0 - ov, y0 - ov, z), iso(x0 - ov, y1 + ov, z), iso(xm, y1 + ov, z + h), iso(xm, y0 - ov, z + h)], cBack, OUTLINE, 0.6);
  poly(ctx, [iso(x0, y1, z), iso(x1, y1, z), iso(xm, y1, z + h)], cEnd, OUTLINE, 0.6);
  poly(ctx, [iso(x1 + ov, y0 - ov, z), iso(x1 + ov, y1 + ov, z), iso(xm, y1 + ov, z + h), iso(xm, y0 - ov, z + h)], cFront, OUTLINE, 0.6);
  roofTiles(ctx, iso(x1 + ov, y1 + ov, z), iso(x1 + ov, y0 - ov, z), iso(xm, y0 - ov, z + h), iso(xm, y1 + ov, z + h), Math.max(3, Math.round(h / 2.6)), Math.max(4, Math.round((y1 - y0) * 7)), lines || 'rgba(0,0,0,0.25)');
  line(ctx, iso(xm, y0 - ov, z + h), iso(xm, y1 + ov, z + h), shade(cFront, 0.6), 1.3);
}
function roofHip(ctx, x0, y0, x1, y1, z, h, ov, cLight, cDark, lines = null) {
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const a = [x0 - ov, y0 - ov], b = [x1 + ov, y0 - ov], c = [x1 + ov, y1 + ov], d = [x0 - ov, y1 + ov];
  const ap = iso(xm, ym, z + h);
  poly(ctx, [iso(a[0], a[1], z), iso(b[0], b[1], z), ap], shade(cDark, 1.1), OUTLINE, 0.6);
  poly(ctx, [iso(a[0], a[1], z), iso(d[0], d[1], z), ap], shade(cLight, 1.05), OUTLINE, 0.6);
  poly(ctx, [iso(b[0], b[1], z), iso(c[0], c[1], z), ap], cDark, OUTLINE, 0.6);
  poly(ctx, [iso(d[0], d[1], z), iso(c[0], c[1], z), ap], cLight, OUTLINE, 0.6);
  const rows = Math.max(3, Math.round(h / 3));
  roofTiles(ctx, iso(d[0], d[1], z), iso(c[0], c[1], z), ap, ap, rows, Math.max(4, Math.round((x1 - x0) * 6)), lines || 'rgba(0,0,0,0.22)');
  roofTiles(ctx, iso(c[0], c[1], z), iso(b[0], b[1], z), ap, ap, rows, Math.max(4, Math.round((y1 - y0) * 6)), lines || 'rgba(0,0,0,0.22)');
}
function cylinder(ctx, cx, cy, z0, z1, r, col, colDark, topCol) {
  const [sx, sy0] = iso(cx, cy, z0), sy1 = sy0 - (z1 - z0);
  const rx = r * HW * 1.414, ry = r * HH * 1.414;
  const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
  g.addColorStop(0, shade(col, 1.08)); g.addColorStop(0.45, col); g.addColorStop(1, colDark);
  ctx.beginPath();
  ctx.moveTo(sx - rx, sy1); ctx.lineTo(sx - rx, sy0);
  ctx.ellipse(sx, sy0, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(sx + rx, sy1);
  ctx.ellipse(sx, sy1, rx, ry, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.6; ctx.stroke();
  if (topCol) { ctx.beginPath(); ctx.ellipse(sx, sy1, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = topCol; ctx.fill(); ctx.stroke(); }
  return [sx, sy1, rx, ry];
}
function cone(ctx, cx, cy, z, r, h, col, colDark) {
  const [sx, sy] = iso(cx, cy, z);
  const rx = r * HW * 1.414, ry = r * HH * 1.414;
  const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
  g.addColorStop(0, shade(col, 1.1)); g.addColorStop(0.5, col); g.addColorStop(1, colDark);
  ctx.beginPath();
  ctx.moveTo(sx - rx, sy); ctx.lineTo(sx, sy - h); ctx.lineTo(sx + rx, sy);
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.6; ctx.stroke();
  return [sx, sy - h];
}
function dome(ctx, cx, cy, z, r, h, col, colDark) {
  const [sx, sy] = iso(cx, cy, z);
  const rx = r * HW * 1.414, ry = r * HH * 1.414;
  const g = ctx.createRadialGradient(sx - rx * 0.35, sy - h * 0.6, rx * 0.1, sx, sy - h * 0.3, rx * 1.2);
  g.addColorStop(0, shade(col, 1.35)); g.addColorStop(0.5, col); g.addColorStop(1, colDark);
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, h, 0, Math.PI, Math.PI * 2, false);
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.6; ctx.stroke();
  return [sx, sy - h];
}
function flag(ctx, x, y, poleH, col, dark, swallow = false, w = 10, h = 6) {
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - poleH); ctx.stroke();
  const t = y - poleH;
  ctx.beginPath();
  ctx.moveTo(x, t);
  ctx.bezierCurveTo(x + w * 0.35, t - 2, x + w * 0.65, t + 2, x + w, t);
  if (swallow) { ctx.lineTo(x + w * 0.75, t + h / 2); ctx.lineTo(x + w, t + h); }
  else ctx.lineTo(x + w, t + h);
  ctx.bezierCurveTo(x + w * 0.65, t + h + 2, x + w * 0.35, t + h - 2, x, t + h);
  ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 0.5; ctx.stroke();
  ctx.fillStyle = '#d8b84a';
  ctx.beginPath(); ctx.arc(x, t - 1, 1.2, 0, Math.PI * 2); ctx.fill();
}
function ellipseShadow(ctx, x, y, rx, ry, a = 0.28) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
