'use strict';
// ============================================================================
//  Renderer: camera, cached terrain chunks, depth-sorted entities, particles,
//  fog of war overlay and the minimap.
// ============================================================================

const CH = 8;              // tiles per terrain chunk side
const CHUNK_LIMIT = 260;   // LRU cache size
// approximate drawn height of each building above its footprint's top corner (for HP bars / picking)
const BAR_H = { house: 34, towncenter: 92, castle: 62, wonder: 120, watchtower: 84, mill: 46, lumbercamp: 20, miningcamp: 20, barracks: 40, archeryrange: 28, stable: 30, blacksmith: 50, market: 28, university: 46, monastery: 70, siegeworkshop: 44, palisade: 24, stonewall: 28, gate: 34 };

// Half-resolution copy of a 2x sprite, used when zoomed out
function mipOf(s) {
  if (s.mip) return s.mip;
  const c = makeCanvas(s.c.width / SPR_SCALE, s.c.height / SPR_SCALE);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(s.c, 0, 0, c.width, c.height);
  return (s.mip = c);
}

class Renderer {
  constructor(canvas, game) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.g = game;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.vw = canvas.clientWidth || 800; this.vh = canvas.clientHeight || 600;
    this.dpr = 1;
    this.chunks = new Map();
    const n = game.n;
    this.fogCv = makeCanvas(n, n);
    this.fogCtx = this.fogCv.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(n, n);
    this.fogTick = -1;
    this.particles = [];
    this.markers = [];
    this.list = [];
    this.ground = [];
    this.hitList = [];
    this.time = 0;
    this.hover = null;
    this.ghost = null;           // building placement preview
    this.selBox = null;
    this.showHp = 'damaged';     // 'all' | 'damaged' | 'selected'
    this.styles = game.players.map(p => p.civ ? p.civ.style : 'west');
    this.waveSpr = this.makeWave();
    this.blobDark = this.makeBlob('20,30,0', 0.13);
    this.blobLight = this.makeBlob('255,250,200', 0.09);
    this.foam = this.makeBlob('245,252,250', 0.38);
    this.chunkBudget = 0;
    this.light = this.buildLighting();
    this.dragLine = null;
    this.stats = { entities: 0, chunksDrawn: 0 };
  }

  // Baked terrain lighting, one pixel per tile (drawn smoothed under an iso transform):
  // rolling-hill shading lit from the north-west, darker deep water, wet shorelines.
  buildLighting() {
    const g = this.g, n = g.n, terr = g.terrain;
    const noise = makeNoise(((g.opts.seed || 7) % 99991) + 31);
    const H = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) H[y * n + x] = noise(x / 15, y / 15, 3) * 1.0 + noise(x / 5 + 40, y / 5 + 9, 2) * 0.16;
    // distance to the shore (water side) and to water (land side)
    const isW = i => terr[i] === T.WATER || terr[i] === T.SHALLOW;
    const dist = new Int16Array(n * n).fill(-1);
    const q = [];
    for (let i = 0; i < n * n; i++) {
      const x = i % n, y = (i - x) / n;
      const w = isW(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (isW(ny * n + nx) !== w) { dist[i] = 1; q.push(i); break; }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % n, y = (c - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        if (dist[ni] >= 0 || isW(ni) !== isW(c) || dist[c] >= 12) continue;
        dist[ni] = dist[c] + 1; q.push(ni);
      }
    }
    const cv = makeCanvas(n, n), ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, t = terr[i], o = i * 4;
      let R = 0, G = 0, B = 0, A = 0;
      if (t === T.WATER) {
        const dd = dist[i] < 0 ? 12 : dist[i];
        R = 6; G = 22; B = 48; A = Math.min(0.55, 0.06 + dd * 0.06);
      } else if (t === T.SHALLOW) {
        R = 230; G = 250; B = 240; A = 0.08;
      } else {
        const hx = H[y * n + Math.min(n - 1, x + 1)] - H[y * n + Math.max(0, x - 1)];
        const hy = H[Math.min(n - 1, y + 1) * n + x] - H[Math.max(0, y - 1) * n + x];
        // light from the north-west: slopes rising towards +x/+y face it
        const sh = clamp((hx * 0.9 + hy * 0.45) * 9.5, -1, 1);
        if (sh > 0) { R = 255; G = 240; B = 205; A = sh * 0.2; } else { R = 18; G = 22; B = 48; A = -sh * 0.32; }
        if (dist[i] === 1) { R = 40; G = 32; B = 22; A = Math.max(A, 0.22); }   // wet shoreline
        else if (dist[i] === 2) { R = 40; G = 32; B = 22; A = Math.max(A, 0.1); }
      }
      d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = Math.round(A * 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  makeBlob(rgb, a) {
    const c = makeCanvas(128, 64), x = c.getContext('2d');
    x.translate(64, 32); x.scale(1, 0.5);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 64);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(-64, -64, 128, 128);
    return c;
  }

  makeWave() {
    const c = makeCanvas(24, 8), x = c.getContext('2d');
    x.strokeStyle = 'rgba(220,240,255,0.7)'; x.lineWidth = 1.2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(2, 5); x.quadraticCurveTo(7, 1, 12, 4); x.quadraticCurveTo(17, 7, 22, 3); x.stroke();
    return c;
  }

  resize(w, h, dpr) {
    this.vw = w; this.vh = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
  }

  // ------------------------------------------------------------------ camera
  centerOn(x, y) { const [wx, wy] = iso(x, y); this.cam.x = wx; this.cam.y = wy; this.clampCam(); }
  clampCam() {
    const n = this.g.n;
    const t = this.worldToTile(this.cam.x, this.cam.y);
    const cx = clamp(t.x, 0, n), cy = clamp(t.y, 0, n);
    if (cx !== t.x || cy !== t.y) { const [wx, wy] = iso(cx, cy); this.cam.x = wx; this.cam.y = wy; }
  }
  worldToTile(wx, wy) { return { x: (wx / HW + wy / HH) / 2, y: (wy / HH - wx / HW) / 2 }; }
  screenToWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.zoom + this.cam.x, (sy - this.vh / 2) / this.cam.zoom + this.cam.y]; }
  screenToTile(sx, sy) { const [wx, wy] = this.screenToWorld(sx, sy); return this.worldToTile(wx, wy); }
  tileToScreen(x, y, z = 0) { const [wx, wy] = iso(x, y, z); return [(wx - this.cam.x) * this.cam.zoom + this.vw / 2, (wy - this.cam.y) * this.cam.zoom + this.vh / 2]; }
  setZoom(z, sx = this.vw / 2, sy = this.vh / 2) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = clamp(z, 0.5, 2);
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before[0] - after[0]; this.cam.y += before[1] - after[1];
    this.clampCam();
  }
  viewRect(margin = 0) {
    const z = this.cam.zoom;
    return { x0: this.cam.x - this.vw / 2 / z - margin, x1: this.cam.x + this.vw / 2 / z + margin, y0: this.cam.y - this.vh / 2 / z - margin, y1: this.cam.y + this.vh / 2 / z + margin };
  }

  // ------------------------------------------------------------------ terrain chunks
  getChunk(cx, cy, force) {
    const key = cx * 1000 + cy;
    let c = this.chunks.get(key);
    if (c && c.ver === this.g.terrainVersion) { this.chunks.delete(key); this.chunks.set(key, c); return c; }
    if (!force && this.chunkBudget <= 0) return null;
    this.chunkBudget--;
    c = this.renderChunk(cx, cy, c);
    this.chunks.set(key, c);
    if (this.chunks.size > CHUNK_LIMIT) { const k = this.chunks.keys().next().value; this.chunks.delete(k); }
    return c;
  }

  renderChunk(cx, cy, old) {
    const g = this.g, n = g.n, terr = g.terrain;
    const M = 4;   // margin so neighbouring chunks overlap slightly (no seams)
    const W = 2 * CH * HW + M * 2, H = 2 * CH * HH + M * 2;
    const left = (cx - cy - 1) * CH * HW - M, top = (cx + cy) * CH * HH - M;
    const cv = old ? old.cv : makeCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(-left, -top);
    const x0 = cx * CH, y0 = cy * CH, x1 = x0 + CH, y1 = y0 + CH;
    ctx.save();
    const tiles = [];
    for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      tiles.push(y * n + x);
      const t = terr[y * n + x];
      const [sx, sy] = iso(x, y);
      ctx.drawImage(TEX.base[t][Math.floor(hash2(x, y, 3) * TERRAIN_VARIANTS)], sx - HW - 1, sy - 1);
    }
    // feathered blending: higher-priority terrain spills onto lower neighbours
    tiles.sort((a, b) => TERRAINS[terr[a]].prio - TERRAINS[terr[b]].prio);
    for (const i of tiles) {
      const x = i % n, y = (i - x) / n, t = terr[i], pr = TERRAINS[t].prio;
      let edge = false;
      for (let d = 0; d < 8 && !edge; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (TERRAINS[terr[ny * n + nx]].prio < pr) edge = true;
      }
      if (!edge) continue;
      const b = TEX.blend[t][Math.floor(hash2(x, y, 4) * TERRAIN_VARIANTS)];
      const [sx, sy] = iso(x + 0.5, y + 0.5);
      ctx.drawImage(b, sx - b.width / 2, sy - b.height / 2);
    }
    // baked lighting (hills, water depth, wet shores)
    {
      const lx0 = Math.max(0, x0 - 1), ly0 = Math.max(0, y0 - 1), lx1 = Math.min(n, x1 + 1), ly1 = Math.min(n, y1 + 1);
      ctx.save();
      ctx.transform(HW, HH, -HW, HH, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.light, lx0, ly0, lx1 - lx0, ly1 - ly0, lx0, ly0, lx1 - lx0, ly1 - ly0);
      ctx.restore();
    }
    // large-scale tonal variation in world space (seamless across chunks)
    for (let y = y0 - 4; y <= y1 + 3; y++) for (let x = x0 - 4; x <= x1 + 3; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const h = hash2(x, y, 31);
      if (h > 0.12) continue;
      const t = terr[y * n + x];
      if (t === T.WATER) continue;
      const [sx, sy] = iso(x + 0.5, y + 0.5);
      const rad = 50 + hash2(x, y, 32) * 90;
      ctx.drawImage(hash2(x, y, 33) < 0.55 ? this.blobDark : this.blobLight, sx - rad, sy - rad / 2, rad * 2, rad);
    }
    // ground decorations
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (x >= n || y >= n) continue;
      const t = terr[y * n + x];
      const h = hash2(x, y, 9);
      const dens = t === T.WATER || t === T.SHALLOW ? 0 : t === T.ICE ? 0 : 0.6;
      if (h < dens) {
        const [sx, sy] = iso(x + 0.3 + hash2(x, y, 11) * 0.4, y + 0.3 + hash2(x, y, 12) * 0.4);
        drawDecor(ctx, t, sx, sy, h);
      }
    }
    // soft foam where shallows meet land
    for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n || terr[y * n + x] !== T.SHALLOW) continue;
      let land = 0, lx = 0, ly = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const tt = terr[ny * n + nx];
        if (tt !== T.WATER && tt !== T.SHALLOW) { land++; lx += dx; ly += dy; }
      }
      if (!land) continue;
      const [sx, sy] = iso(x + 0.5 + lx * 0.32, y + 0.5 + ly * 0.32);
      ctx.drawImage(this.foam, sx - 30, sy - 12, 60, 24);
    }
    // trim to this chunk's diamond in one compositing pass (cheaper than clipping every draw)
    ctx.globalCompositeOperation = 'destination-in';
    const [tX, tY] = iso(x0, y0), [rX, rY] = iso(x1, y0), [bX, bY] = iso(x1, y1), [lX, lY] = iso(x0, y1);
    poly(ctx, [[tX, tY - 1.5], [rX + 3, rY], [bX, bY + 1.5], [lX - 3, lY]], '#000');
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    return { cv, left, top, ver: g.terrainVersion };
  }

  drawTerrain(ctx, vr) {
    const g = this.g, n = g.n;
    const nc = Math.ceil(n / CH);
    // tile-space bounds of the view
    const corners = [this.worldToTile(vr.x0, vr.y0), this.worldToTile(vr.x1, vr.y0), this.worldToTile(vr.x0, vr.y1), this.worldToTile(vr.x1, vr.y1)];
    const tx0 = Math.min(...corners.map(c => c.x)), tx1 = Math.max(...corners.map(c => c.x));
    const ty0 = Math.min(...corners.map(c => c.y)), ty1 = Math.max(...corners.map(c => c.y));
    const cx0 = clamp(Math.floor(tx0 / CH), 0, nc - 1), cx1 = clamp(Math.floor(tx1 / CH), 0, nc - 1);
    const cy0 = clamp(Math.floor(ty0 / CH), 0, nc - 1), cy1 = clamp(Math.floor(ty1 / CH), 0, nc - 1);
    let drawn = 0;
    const W = 2 * CH * HW, H = 2 * CH * HH;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const left = (cx - cy - 1) * CH * HW, top = (cx + cy) * CH * HH;
      if (left > vr.x1 || left + W < vr.x0 || top > vr.y1 || top + H < vr.y0) continue;
      const c = this.getChunk(cx, cy, false);
      if (c) ctx.drawImage(c.cv, c.left, c.top);
      else {
        // not rendered yet (budget exhausted this frame): flat placeholder in the dominant terrain colour
        const t = g.terrain[Math.min(n - 1, cy * CH + 4) * n + Math.min(n - 1, cx * CH + 4)];
        poly(ctx, [iso(cx * CH, cy * CH), iso(cx * CH + CH, cy * CH), iso(cx * CH + CH, cy * CH + CH), iso(cx * CH, cy * CH + CH)], TERRAINS[t].base[0]);
        this.missing = true;
      }
      drawn++;
    }
    this.stats.chunksDrawn = drawn;
    this.tileBounds = { x0: Math.max(0, Math.floor(tx0)), x1: Math.min(n - 1, Math.ceil(tx1)), y0: Math.max(0, Math.floor(ty0)), y1: Math.min(n - 1, Math.ceil(ty1)) };
  }

  // render one chunk just outside the view so panning rarely hits a cold chunk
  prewarm() {
    const n = this.g.n, nc = Math.ceil(n / CH);
    const vr = this.viewRect(CH * HW * 2);
    const W = 2 * CH * HW, H = 2 * CH * HH;
    const c0 = this.worldToTile(this.cam.x, this.cam.y);
    const ccx = Math.floor(c0.x / CH), ccy = Math.floor(c0.y / CH);
    for (let r = 1; r <= 4; r++) for (let cy = ccy - r; cy <= ccy + r; cy++) for (let cx = ccx - r; cx <= ccx + r; cx++) {
      if (cx < 0 || cy < 0 || cx >= nc || cy >= nc) continue;
      const left = (cx - cy - 1) * CH * HW, top = (cx + cy) * CH * HH;
      if (left > vr.x1 || left + W < vr.x0 || top > vr.y1 || top + H < vr.y0) continue;
      const c = this.chunks.get(cx * 1000 + cy);
      if (c && c.ver === this.g.terrainVersion) continue;
      this.getChunk(cx, cy, true);
      return;
    }
  }

  drawWater(ctx) {
    const g = this.g, n = g.n, tb = this.tileBounds;
    if (!tb) return;
    const t = this.time;
    const spr = this.waveSpr;
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.globalAlpha = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.3 + bucket * 2.1));
      for (let y = tb.y0; y <= tb.y1; y++) for (let x = tb.x0; x <= tb.x1; x++) {
        const tt = g.terrain[y * n + x];
        if (tt !== T.WATER) continue;
        const h = hash2(x, y, 21);
        if (h > 0.3 || Math.floor(h * 10) % 3 !== bucket) continue;
        const ph = t * 0.35 + h * 20;
        const [sx, sy] = iso(x + 0.5 + Math.sin(ph) * 0.15, y + 0.5 + Math.cos(ph * 0.7) * 0.1);
        ctx.drawImage(spr, sx - 12, sy - 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ fog
  updateFog(force) {
    const g = this.g;
    if (!g.viewer) return;
    if (!force && this.fogTick === g.tickN) return;
    this.fogTick = g.tickN;
    const d = this.fogImg.data, vis = g.vis, ex = g.explored, nn = g.n * g.n;
    const reveal = g.reveal === 'all';
    for (let i = 0, j = 3; i < nn; i++, j += 4) d[j] = reveal ? 0 : ex[i] ? (vis[i] ? 0 : 120) : 255;
    this.fogCtx.putImageData(this.fogImg, 0, 0);
  }

  // ------------------------------------------------------------------ main render
  render(alpha, dt) {
    const g = this.g, ctx = this.ctx;
    this.time += dt;
    const z = this.cam.zoom, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(z * dpr, 0, 0, z * dpr, (this.vw / 2 - this.cam.x * z) * dpr, (this.vh / 2 - this.cam.y * z) * dpr);
    ctx.imageSmoothingEnabled = true;
    const vr = this.viewRect(0);
    this.chunkBudget = this.firstFrame === undefined ? 999 : 1;
    this.firstFrame = false;
    this.missing = false;
    this.lowRes = z * dpr <= 1.02;
    this.drawTerrain(ctx, vr);
    this.drawWater(ctx);
    this.collect(alpha);
    // ground layer: farms, rubble, corpses, carcasses
    for (const it of this.ground) this.drawItem(ctx, it, alpha);
    this.drawMarkers(ctx, true);
    // selection rings under units
    for (const it of this.list) if (it.e && it.e.selected && it.kind === 'unit') this.drawSelRing(ctx, it);
    for (const it of this.list) this.drawItem(ctx, it, alpha);
    this.drawProjectiles(ctx);
    this.updateParticles(dt);
    this.drawParticles(ctx);
    // fog of war
    if (g.viewer && g.reveal !== 'all') {
      this.updateFog();
      ctx.save();
      ctx.transform(HW, HH, -HW, HH, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCv, 0, 0);
      ctx.restore();
    }
    this.drawOverlays(ctx, alpha);
    this.drawMarkers(ctx, false);
    if (!this.missing && this.chunkBudget > 0 && (this.frameN = (this.frameN || 0) + 1) % 3 === 0) this.prewarm();
    if (this.ghost) this.drawGhost(ctx);
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.selBox) {
      const b = this.selBox;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }

  isAllyOfViewer(owner) {
    const g = this.g;
    if (!g.viewer) return true;
    return owner !== 0 && g.players[g.viewer].isAlly(owner);
  }

  collect(alpha) {
    const g = this.g;
    const vr = this.viewRect(140);
    const list = this.list, ground = this.ground, hit = this.hitList;
    list.length = 0; ground.length = 0; hit.length = 0;
    const viewer = g.viewer;
    // resources
    for (const r of g.resources) {
      if (r.dead) continue;
      const [wx, wy] = iso(r.x, r.y);
      if (wx < vr.x0 || wx > vr.x1 || wy < vr.y0 || wy > vr.y1) continue;
      if (viewer && !g.isExplored(r.x, r.y)) continue;
      const it = { kind: 'res', e: r, d: r.x + r.y, wx, wy };
      (r.type === 'carcass' ? ground : list).push(it);
    }
    // buildings
    for (const b of g.buildings) {
      if (b.dead) continue;
      const [wx, wy] = iso(b.x, b.y);
      const m = b.w * HW + 80;
      if (wx < vr.x0 - m || wx > vr.x1 + m || wy < vr.y0 - m || wy > vr.y1 + m) continue;
      if (viewer && !this.isAllyOfViewer(b.owner) && !b.seen) continue;
      const it = { kind: 'bld', e: b, d: b.x + b.y };
      (b.type === 'farm' ? ground : list).push(it);
    }
    // units
    for (const u of g.units) {
      if (u.dead || u.garrisonedIn) continue;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      const [wx, wy] = iso(x, y);
      if (wx < vr.x0 || wx > vr.x1 || wy < vr.y0 || wy > vr.y1) continue;
      if (viewer && !this.isAllyOfViewer(u.owner) && !g.isVisible(x, y)) continue;
      list.push({ kind: 'unit', e: u, d: x + y, wx, wy, x, y });
    }
    // corpses and rubble
    const t = g.time;
    for (const c of g.corpses) {
      const [wx, wy] = iso(c.x, c.y);
      if (wx < vr.x0 || wx > vr.x1 || wy < vr.y0 || wy > vr.y1) continue;
      if (viewer && !g.isVisible(c.x, c.y)) continue;
      ground.push({ kind: 'corpse', e: c, d: c.x + c.y, wx, wy, a: clamp((40 - (t - c.t0)) / 10, 0, 1) });
    }
    for (const f of g.fx) {
      if (f.type !== 'rubble') continue;
      const [wx, wy] = iso(f.x, f.y);
      if (wx < vr.x0 - 200 || wx > vr.x1 + 200 || wy < vr.y0 - 100 || wy > vr.y1 + 100) continue;
      if (viewer && !g.isExplored(f.x, f.y)) continue;
      ground.push({ kind: 'rubble', e: f, d: -1, wx, wy, a: clamp((f.life - (t - f.t0)) / 10, 0, 1) });
    }
    list.sort((a, b) => a.d - b.d);
    this.stats.entities = list.length;
  }

  unitFrame(u) {
    const a = u.anim, t = u.animT;
    if (a === 'walk') return [ 'walk', Math.floor(t * 7 * Math.max(0.6, u.st.speed / 0.9)) % 4 ];
    if (a === 'attack') {
      const R = Math.max(0.6, u.st.reload);
      const style = u.st.proj ? 'r' : 'm';
      if (u.isVillager) return ['attack', t < 0.2 ? 2 : t < 0.45 ? 3 : t > 1.2 ? 0 : 1];
      if (style === 'r') return ['attack', t < 0.18 ? 3 : t > R - 0.35 ? 2 : t > R - 0.8 ? 1 : 0];
      return ['attack', t < 0.14 ? 2 : t < 0.32 ? 3 : t > R - 0.3 ? 0 : 1];
    }
    if ((a === 'gather' || a === 'build') && u.isVillager) {
      const P = WORK_CYCLE[u.task] || 0.8;
      return [a, Math.floor((t % P) / P * WORK_FRAMES) % WORK_FRAMES];
    }
    if (a === 'gather' || a === 'build') return [a, Math.floor((t % 0.8) / 0.2)];
    if (a === 'pray') return ['pray', Math.floor(t * 2) % 2];
    if (u.st.animal) return ['idle', Math.floor(t / 1.6 + u.id) % 2];
    return ['idle', 0];
  }

  drawItem(ctx, it, alpha) {
    switch (it.kind) {
      case 'unit': this.drawUnit(ctx, it); break;
      case 'bld': this.drawBuilding(ctx, it); break;
      case 'res': this.drawResource(ctx, it); break;
      case 'corpse': {
        const c = it.e;
        const spr = getUnitSprite(c.type, this.g.players[c.owner].colorIdx, 'dead', 0, c.type === 'villager' ? 'v' + (c.variant || 0) : '', null, null, c.variant || 0);
        ctx.globalAlpha = it.a;
        this.blit(ctx, spr, it.wx, it.wy, c.facing);
        ctx.globalAlpha = 1;
        break;
      }
      case 'rubble': {
        const s = getRubbleSprite(it.e.size);
        ctx.globalAlpha = it.a;
        ctx.drawImage(s.c, it.wx - s.ox, it.wy - s.oy, s.w, s.h);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  blit(ctx, s, wx, wy, facing) {
    const img = this.lowRes ? mipOf(s) : s.c;
    if (facing < 0) {
      ctx.save(); ctx.translate(wx, wy); ctx.scale(-1, 1);
      ctx.drawImage(img, -s.ax, -s.ay, s.w, s.h);
      ctx.restore();
    } else ctx.drawImage(img, wx - s.ax, wy - s.ay, s.w, s.h);
  }

  drawSelRing(ctx, it) {
    const u = it.e;
    const r = u.radius * HW * 1.6 + 3;
    const col = this.g.players[u.owner].color;
    ctx.strokeStyle = u.owner === this.g.viewer || !this.g.viewer ? 'rgba(255,255,255,0.85)' : col.light;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(it.wx, it.wy, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  }

  drawUnit(ctx, it) {
    const u = it.e, g = this.g;
    const [act, fr] = this.unitFrame(u);
    let extra = '';
    if (u.isVillager) extra = `v${u.variant}|${u.task || ''}|${u.carry >= 1 ? u.carryType : ''}`;
    else if (UNITS[u.type].sprite.body === 'human' || UNITS[u.type].sprite.body === 'horse' || UNITS[u.type].sprite.body === 'monk') extra = 'v' + (u.variant & 1);
    const s = getUnitSprite(u.type, g.players[u.owner].colorIdx, act, fr, extra, u.task, u.carry >= 1 ? u.carryType : null, u.variant);
    this.blit(ctx, s, it.wx, it.wy, u.facing);
    // impact effects synced to the swing
    if (u.isVillager && (act === 'gather' || act === 'build')) {
      const hitF = Math.round(WORK_HIT * WORK_FRAMES);
      if (fr === hitF && u._rf !== hitF) this.workImpact(u);
      u._rf = fr;
    } else u._rf = -1;
    // hit box in screen space (for picking)
    const body = UNITS[u.type].sprite.body;
    const hw = Math.max(8, u.radius * HW * 1.1), hh = body === 'trebuchet' ? 70 : u.st.classes.includes('cavalry') ? 34 : u.st.classes.includes('siege') ? 28 : 26;
    this.hitList.push({ e: u, x0: it.wx - hw, x1: it.wx + hw, y0: it.wy - hh, y1: it.wy + 4 });
    const showBar = u.selected || this.hover === u || g.time - u.lastHitT < 3 || this.showHp === 'all';
    if (showBar && !u.st.animal) it.bar = { x: it.wx, y: it.wy - hh - 4, f: u.hp / u.st.hp, w: 22, col: g.players[u.owner].color.main };
    else if (showBar && u.st.animal && (u.selected || this.hover === u)) it.bar = { x: it.wx, y: it.wy - hh + 4, f: u.hp / u.st.hp, w: 18, col: '#bbb' };
  }

  wallMask(b) {
    const g = this.g, n = g.n;
    let m = 0;
    const chk = (x, y, bit) => {
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      const e = g.ents.get(g.occ[y * n + x]);
      if (e && e.kind === 'building' && (e.def.wall || e.def.gate) && e.owner === b.owner) m |= bit;
    };
    chk(b.tx + 1, b.ty, 1); chk(b.tx, b.ty + 1, 2); chk(b.tx - 1, b.ty, 4); chk(b.tx, b.ty - 1, 8);
    return m;
  }

  drawBuilding(ctx, it) {
    const b = it.e, g = this.g;
    const style = this.styles[b.owner] || 'west';
    let stage = b.built ? 'done' : b.progress < 0.33 ? 'b0' : b.progress < 0.66 ? 'b1' : 'b2';
    let extra = '';
    if (b.type === 'farm') {
      const f = b.foodMax ? b.food / b.foodMax : 0;
      extra = !b.built ? 'b' : f > 0.66 ? 'f3' : f > 0.33 ? 'f2' : f > 0.05 ? 'f1' : 'f0';
      if (!b.built) stage = 'done';
    } else if (b.def.wall || b.def.gate) extra = String(this.wallMask(b));
    const s = getBuildingSprite(b.type, style, g.players[b.owner].colorIdx, stage, extra);
    const [wx, wy] = iso(b.tx, b.ty);
    if (b.selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
      poly(ctx, [iso(b.tx, b.ty), iso(b.tx + b.w, b.ty), iso(b.tx + b.w, b.ty + b.h), iso(b.tx, b.ty + b.h)], null, 'rgba(255,255,255,0.8)', 1.2);
    }
    ctx.drawImage(this.lowRes ? mipOf(s) : s.c, wx - s.ox, wy - s.oy, s.w, s.h);
    // animated details
    if (b.built) {
      if (b.type === 'mill') this.drawMillBlades(ctx, b);
      const dmg = 1 - b.hp / b.maxHp;
      if (dmg > 0.35 && Math.random() < dmg * 0.5 * (b.w / 2)) this.spawnFire(b, dmg);
      if ((b.type === 'blacksmith' && Math.random() < 0.08) || (b.type === 'house' && style !== 'steppe' && style !== 'byz' && Math.random() < 0.012)) {
        const [cx, cy] = b.type === 'blacksmith' ? iso(b.tx + 0.72, b.ty + 0.72, 50) : iso(b.tx + 0.65, b.ty + 0.65, 30);
        this.particles.push({ t: 'smoke', x: cx, y: cy, vx: 3 + Math.random() * 3, vy: -10 - Math.random() * 5, life: 3, age: 0, s: 2 + Math.random() * 2 });
      }
    }
    const fx0 = iso(b.tx, b.ty + b.h)[0], fx1 = iso(b.tx + b.w, b.ty)[0];
    const bh = !b.built ? (b.progress < 0.33 ? 10 : 30) : (BAR_H[b.type] || 52);
    const top = wy - bh, bottom = iso(b.tx + b.w, b.ty + b.h)[1];
    this.hitList.push({ e: b, x0: fx0 + 6, x1: fx1 - 6, y0: top, y1: bottom, bld: true });
    const showBar = b.selected || this.hover === b || g.time - b.lastHitT < 3 || !b.built || this.showHp === 'all';
    if (showBar && b.type !== 'farm' && !(b.def.wall && !b.selected && this.hover !== b)) {
      it.bar = { x: (fx0 + fx1) / 2, y: top - 6, f: b.hp / b.maxHp, w: Math.min(70, 20 + b.w * 12), col: g.players[b.owner].color.main, prog: b.built ? null : b.progress };
    }
  }

  workImpact(u) {
    const t = u.order && this.g.ents.get(u.order.target);
    const task = u.task;
    if (task === 'wood' && t) {
      t._shakeT = this.time;
      this.burst('chips', t.x, t.y, 4);
      if (Math.random() < 0.5) this.burst('leaf', t.x, t.y, 2);
    } else if ((task === 'gold' || task === 'stone') && t) {
      this.burst(task === 'gold' ? 'sparkle' : 'stonechip', u.x + (t.x - u.x) * 0.6, u.y + (t.y - u.y) * 0.6, task === 'gold' ? 4 : 3);
    } else if (task === 'farm') {
      this.burst('dirt', u.x + u.facing * 0.25, u.y, 3);
    } else if (task === 'build' && t) {
      this.burst('dust', u.x + (t.x - u.x) * 0.2, u.y + (t.y - u.y) * 0.2, 1);
    } else if (task === 'forage' && t) {
      this.burst('leaf', t.x, t.y, 1);
    }
  }

  drawMillBlades(ctx, b) {
    const [hx, hy] = iso(b.tx + 1.5, b.ty + 1.0, 22);
    const a0 = this.time * 1.4 + b.id;
    ctx.save(); ctx.translate(hx + 2, hy);
    for (let i = 0; i < 4; i++) {
      const a = a0 + i * Math.PI / 2;
      ctx.save(); ctx.rotate(a); ctx.scale(0.75, 1);
      ctx.fillStyle = 'rgba(232,220,190,0.92)'; ctx.fillRect(1.5, -2.2, 19, 4.4);
      ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 0.7; ctx.strokeRect(1.5, -2.2, 19, 4.4);
      ctx.beginPath(); for (let k = 5; k < 20; k += 4) { ctx.moveTo(k, -2.2); ctx.lineTo(k, 2.2); } ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#3a2410'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawResource(ctx, it) {
    const r = it.e;
    let s;
    const sub = Math.floor(hash2(r.tx, r.ty, 7) * 4);
    if (r.type === 'tree') {
      const gt = this.g.time;
      if (r.fellAt != null && gt - r.fellAt < 0.9) {
        // toppling: rotate the standing tree about its base, then show the felled log
        const k = clamp((gt - r.fellAt) / 0.9, 0, 1);
        const full = getTreeSprite(r.variant, sub, false);
        const dir = hash2(r.tx, r.ty, 8) < 0.5 ? -1 : 1;
        ctx.save(); ctx.translate(it.wx, it.wy); ctx.rotate(dir * k * k * 1.35); ctx.scale(1, 1 - k * 0.25);
        ctx.drawImage(this.lowRes ? mipOf(full) : full.c, -full.ax, -full.ay, full.w, full.h);
        ctx.restore();
        if (k > 0.95 && !r._landed) { r._landed = true; this.burst('dust', r.x + dir * 0.6, r.y + dir * 0.6, 6); this.burst('leaf', r.x + dir * 0.8, r.y + dir * 0.8, 5); }
        this.hitList.push({ e: r, x0: it.wx - 14, x1: it.wx + 14, y0: it.wy - 30, y1: it.wy + 6, res: true });
        return;
      }
      s = getTreeSprite(r.variant, sub, r.amount < r.max - 0.01);
      if (r._shakeT != null && this.time - r._shakeT < 0.3 && r.amount >= r.max - 0.01) {
        const k = (this.time - r._shakeT) / 0.3;
        ctx.save(); ctx.translate(it.wx, it.wy); ctx.rotate(Math.sin(k * 18) * 0.035 * (1 - k));
        ctx.drawImage(this.lowRes ? mipOf(s) : s.c, -s.ax, -s.ay, s.w, s.h);
        ctx.restore();
        this.hitList.push({ e: r, x0: it.wx - 14, x1: it.wx + 14, y0: it.wy - 72, y1: it.wy + 6, res: true });
        return;
      }
    }
    else if (r.type === 'carcass') s = getCarcassSprite(r.animal);
    else {
      const f = r.amount / r.max;
      s = getResourceSprite(r.type, f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : 3, sub);
    }
    this.blit(ctx, s, it.wx, it.wy, r.type === 'carcass' ? r.facing : 1);
    if (r.type === 'tree') this.hitList.push({ e: r, x0: it.wx - 14, x1: it.wx + 14, y0: it.wy - 72, y1: it.wy + 6, res: true });
    else this.hitList.push({ e: r, x0: it.wx - 16, x1: it.wx + 16, y0: it.wy - 20, y1: it.wy + 8, res: true });
  }

  drawProjectiles(ctx) {
    const g = this.g;
    for (const p of g.projectiles) {
      if (g.viewer && !g.isVisible(p.x, p.y) && !g.isVisible(p.sx, p.sy)) continue;
      const [wx, wy0] = iso(p.x, p.y);
      const wy = wy0 - p.z;
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      switch (p.type) {
        case 'arrow': case 'bolt': {
          const L = p.type === 'bolt' ? 6 : 8;
          ctx.strokeStyle = '#4a3218'; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(wx - ca * L, wy - sa * L); ctx.lineTo(wx + ca * L * 0.4, wy + sa * L * 0.4); ctx.stroke();
          ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(wx + ca * L * 0.2, wy + sa * L * 0.2); ctx.lineTo(wx + ca * L * 0.6, wy + sa * L * 0.6); ctx.stroke();
          break;
        }
        case 'javelin': case 'spear': {
          ctx.strokeStyle = '#7a5428'; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(wx - ca * 8, wy - sa * 8); ctx.lineTo(wx + ca * 6, wy + sa * 6); ctx.stroke();
          ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(wx + ca * 5, wy + sa * 5); ctx.lineTo(wx + ca * 8, wy + sa * 8); ctx.stroke();
          break;
        }
        case 'axe': {
          const a = this.time * 18;
          ctx.save(); ctx.translate(wx, wy); ctx.rotate(a);
          ctx.strokeStyle = '#6a4a24'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.stroke();
          ctx.fillStyle = '#c8ccd0'; ctx.beginPath(); ctx.moveTo(2, -1); ctx.lineTo(5, -3); ctx.lineTo(5, 2); ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'stone': case 'boulder': {
          const r = p.type === 'boulder' ? 3.6 : 2.6;
          ellipseShadow(ctx, wx, wy0, r * 1.4, r * 0.6, 0.25);
          ctx.fillStyle = '#6a665e'; ctx.beginPath(); ctx.arc(wx, wy, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#9a968c'; ctx.beginPath(); ctx.arc(wx - r * 0.3, wy - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
    }
    // impacts and stuck arrows
    const t = g.time;
    for (const f of g.fx) {
      if (f.type === 'impact') {
        const k = (t - f.t0) / f.life;
        if (k > 1) continue;
        const [wx, wy] = iso(f.x, f.y);
        ctx.strokeStyle = `rgba(120,100,70,${0.6 * (1 - k)})`; ctx.lineWidth = 2;
        const r = (f.size * HW + 6) * (0.4 + k);
        ctx.beginPath(); ctx.ellipse(wx, wy, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (f.type === 'stuck') {
        const k = (t - f.t0) / f.life;
        if (k > 1 || (g.viewer && !g.isVisible(f.x, f.y))) continue;
        const [wx, wy] = iso(f.x, f.y);
        ctx.strokeStyle = `rgba(70,50,25,${1 - k})`; ctx.lineWidth = 1;
        const ca = Math.cos(f.a), sa = Math.sin(f.a);
        ctx.beginPath(); ctx.moveTo(wx - ca * 5, wy - f.z - sa * 5); ctx.lineTo(wx, wy - f.z); ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ particles
  spawnFire(b, dmg) {
    const px = b.tx + 0.3 + Math.random() * (b.w - 0.6), py = b.ty + 0.3 + Math.random() * (b.h - 0.6);
    const [x, y] = iso(px, py, 10 + Math.random() * 20 * b.w / 2);
    this.particles.push({ t: 'fire', x, y, vx: (Math.random() - 0.5) * 4, vy: -14 - Math.random() * 10, life: 0.7 + Math.random() * 0.4, age: 0, s: 2 + dmg * 3 });
    if (Math.random() < 0.5) this.particles.push({ t: 'smoke', x, y: y - 8, vx: 4 + Math.random() * 4, vy: -12 - Math.random() * 6, life: 2.5, age: 0, s: 3 + dmg * 3, dark: true });
  }
  burst(type, x, y, n = 6) {
    const [wx, wy] = iso(x, y);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 25;
      if (type === 'chips') this.particles.push({ t: 'chip', x: wx, y: wy - 10, vx: Math.cos(a) * sp, vy: -20 - Math.random() * 20, life: 0.6, age: 0, s: 1.2, g: 90 });
      else if (type === 'blood') this.particles.push({ t: 'blood', x: wx, y: wy - 12, vx: Math.cos(a) * sp * 0.6, vy: -15 - Math.random() * 15, life: 0.5, age: 0, s: 1.3, g: 120 });
      else if (type === 'dust') this.particles.push({ t: 'dust', x: wx + Math.cos(a) * 6, y: wy + Math.sin(a) * 3, vx: Math.cos(a) * sp * 0.5, vy: -4 - Math.random() * 6, life: 1 + Math.random(), age: 0, s: 3 + Math.random() * 4 });
      else if (type === 'bigdust') this.particles.push({ t: 'dust', x: wx + Math.cos(a) * 30, y: wy + Math.sin(a) * 15, vx: Math.cos(a) * sp, vy: -6 - Math.random() * 10, life: 2 + Math.random() * 1.5, age: 0, s: 8 + Math.random() * 10 });
      else if (type === 'sparkle') this.particles.push({ t: 'spark', x: wx, y: wy - 20, vx: Math.cos(a) * sp * 0.4, vy: -10 - Math.random() * 20, life: 1.2, age: 0, s: 1.5 });
      else if (type === 'leaf') this.particles.push({ t: 'leaf', x: wx + (Math.random() - 0.5) * 16, y: wy - 30 - Math.random() * 20, vx: (Math.random() - 0.5) * 14, vy: 4 + Math.random() * 6, life: 1.6, age: 0, s: 1.6, ph: Math.random() * 6 });
      else if (type === 'stonechip') this.particles.push({ t: 'stonechip', x: wx, y: wy - 6, vx: Math.cos(a) * sp, vy: -18 - Math.random() * 18, life: 0.5, age: 0, s: 1.3, g: 120 });
      else if (type === 'dirt') this.particles.push({ t: 'dirt', x: wx + Math.cos(a) * 4, y: wy - 1, vx: Math.cos(a) * sp * 0.4, vy: -10 - Math.random() * 10, life: 0.45, age: 0, s: 1.4, g: 90 });
    }
  }
  updateParticles(dt) {
    const out = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.g) p.vy += p.g * dt;
      out.push(p);
    }
    if (out.length > 900) out.splice(0, out.length - 900);
    this.particles = out;
  }
  drawParticles(ctx) {
    for (const p of this.particles) {
      const k = p.age / p.life;
      switch (p.t) {
        case 'smoke': ctx.fillStyle = p.dark ? `rgba(40,36,32,${0.35 * (1 - k)})` : `rgba(200,200,200,${0.35 * (1 - k)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + k * 2.5), 0, Math.PI * 2); ctx.fill(); break;
        case 'fire': ctx.fillStyle = `rgba(255,${Math.round(200 - k * 150)},40,${0.85 * (1 - k)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - k * 0.6), 0, Math.PI * 2); ctx.fill(); break;
        case 'dust': ctx.fillStyle = `rgba(150,128,95,${0.4 * (1 - k)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + k), 0, Math.PI * 2); ctx.fill(); break;
        case 'chip': ctx.fillStyle = `rgba(190,150,90,${1 - k})`; ctx.fillRect(p.x, p.y, 1.6, 1.2); break;
        case 'blood': ctx.fillStyle = `rgba(150,20,20,${1 - k})`; ctx.fillRect(p.x, p.y, 1.4, 1.4); break;
        case 'spark': ctx.fillStyle = `rgba(255,240,170,${1 - k})`; ctx.fillRect(p.x, p.y, 1.8, 1.8); break;
        case 'leaf': ctx.fillStyle = `rgba(90,140,50,${1 - k * k})`; ctx.fillRect(p.x + Math.sin(p.age * 6 + p.ph) * 3, p.y, 1.8, 1.2); break;
        case 'stonechip': ctx.fillStyle = `rgba(150,148,140,${1 - k})`; ctx.fillRect(p.x, p.y, 1.5, 1.3); break;
        case 'dirt': ctx.fillStyle = `rgba(110,82,50,${1 - k})`; ctx.fillRect(p.x, p.y, 1.5, 1.5); break;
      }
    }
  }

  // ------------------------------------------------------------------ overlays
  addMarker(x, y, type) { this.markers.push({ x, y, type, t: 0 }); }
  // pulse a building's footprint so the player sees the order landed
  flashBuilding(b) { this.markers.push({ x: b.x, y: b.y, type: 'bld', b, t: 0 }); }
  drawMarkers(ctx, under) {
    const out = [];
    for (const m of this.markers) {
      m.t += under ? 0 : 1 / 60;
      if (m.t > (m.type === 'bld' ? 1.1 : 0.7)) continue;
      out.push(m);
      if (m.type === 'bld') {
        if (under) continue;
        const b = m.b, k = m.t / 1.1, e = (1 - k) * 0.35;
        const pulse = 0.5 + 0.5 * Math.sin(m.t * 18);
        const pts = [iso(b.tx - e, b.ty - e), iso(b.tx + b.w + e, b.ty - e), iso(b.tx + b.w + e, b.ty + b.h + e), iso(b.tx - e, b.ty + b.h + e)];
        poly(ctx, pts, `rgba(255,220,90,${0.18 * (1 - k)})`, `rgba(255,225,110,${(0.6 + 0.4 * pulse) * (1 - k)})`, 2.2);
        continue;
      }
      if (!under) continue;
      const [wx, wy] = iso(m.x, m.y);
      const k = m.t / 0.7;
      const col = m.type === 'attack' ? '255,80,60' : m.type === 'gather' ? '240,210,90' : '120,230,120';
      ctx.strokeStyle = `rgba(${col},${1 - k})`; ctx.lineWidth = 1.6;
      for (let i = 0; i < 2; i++) { const r = 12 * (1 - k) + i * 5; ctx.beginPath(); ctx.ellipse(wx, wy, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (!under) this.markers = out;
  }

  drawOverlays(ctx) {
    const g = this.g;
    // rally points of selected buildings
    for (const it of this.list) {
      const b = it.e;
      if (it.kind !== 'bld' || !b.selected || !b.rally || b.owner !== g.viewer) continue;
      const [bx, by] = iso(b.x, b.y);
      const [rx, ry] = iso(b.rally.x, b.rally.y);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
      flag(ctx, rx, ry, 16, g.players[b.owner].color.main, g.players[b.owner].color.dark, false, 9, 6);
    }
    // health bars
    for (const it of this.list) {
      const b = it.bar;
      if (!b) continue;
      const w = b.w, x = b.x - w / 2, y = b.y;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = b.f > 0.5 ? '#3ac43a' : b.f > 0.25 ? '#e0c030' : '#e03a2a';
      ctx.fillRect(x, y, w * clamp(b.f, 0, 1), 3);
      if (b.prog != null) { ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y + 4, w + 2, 4); ctx.fillStyle = '#e8d080'; ctx.fillRect(x, y + 5, w * b.prog, 2); }
    }
    // wall drag line preview
    if (this.dragLine) {
      for (const [x, y, ok] of this.dragLine) {
        poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], ok ? 'rgba(80,220,80,0.35)' : 'rgba(230,60,50,0.35)', ok ? 'rgba(80,220,80,0.8)' : 'rgba(230,60,50,0.8)', 1);
      }
    }
  }

  drawGhost(ctx) {
    const gh = this.ghost, g = this.g;
    const d = BUILDINGS[gh.type];
    const style = this.styles[g.viewer] || 'west';
    const ok = gh.ok;
    for (let y = gh.ty; y < gh.ty + d.size; y++) for (let x = gh.tx; x < gh.tx + d.size; x++) {
      poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], ok ? 'rgba(80,220,80,0.22)' : 'rgba(230,60,50,0.3)');
    }
    const s = getBuildingSprite(gh.type, style, g.players[g.viewer].colorIdx, 'done', gh.type === 'farm' ? 'f3' : d.wall || d.gate ? '0' : '');
    const [wx, wy] = iso(gh.tx, gh.ty);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(s.c, wx - s.ox, wy - s.oy, s.w, s.h);
    ctx.globalAlpha = 1;
    poly(ctx, [iso(gh.tx, gh.ty), iso(gh.tx + d.size, gh.ty), iso(gh.tx + d.size, gh.ty + d.size), iso(gh.tx, gh.ty + d.size)], null, ok ? 'rgba(120,255,120,0.9)' : 'rgba(255,90,80,0.9)', 1.2);
    // range preview for towers
    if (d.range) {
      const p = g.players[g.viewer];
      const r = d.range + p.mods.towerRange + d.size / 2;
      const [cx, cy] = iso(gh.tx + d.size / 2, gh.ty + d.size / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(cx, cy, r * HW * 1.414, r * HH * 1.414, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // entity under a screen point (CSS px)
  pick(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const pad = (this.pickPad || 0) / this.cam.zoom;
    let best = null;
    for (let i = this.hitList.length - 1; i >= 0; i--) {
      const h = this.hitList[i];
      if (wx < h.x0 - pad || wx > h.x1 + pad || wy < h.y0 - pad || wy > h.y1 + pad) continue;
      if (h.e.dead) continue;
      if (!h.bld && !h.res) return h.e;
      if (!best) best = h.e;
    }
    // footprint test for buildings
    const t = this.worldToTile(wx, wy);
    const g = this.g;
    if (t.x >= 0 && t.y >= 0 && t.x < g.n && t.y < g.n) {
      const e = g.ents.get(g.occ[Math.floor(t.y) * g.n + Math.floor(t.x)]);
      if (e && !e.dead && (e.kind === 'building' ? (!g.viewer || this.isAllyOfViewer(e.owner) || e.seen) : g.isExplored(t.x, t.y))) {
        if (!best || best.kind === 'resource') return e;
      }
    }
    return best;
  }

  // units whose screen position lies inside a rectangle (CSS px)
  pickBox(x0, y0, x1, y1) {
    const out = [];
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (const it of this.list) {
      if (it.kind !== 'unit') continue;
      const [sx, sy] = [(it.wx - this.cam.x) * this.cam.zoom + this.vw / 2, (it.wy - 12 - this.cam.y) * this.cam.zoom + this.vh / 2];
      if (sx >= ax && sx <= bx && sy >= ay && sy <= by) out.push(it.e);
    }
    return out;
  }
}

// ============================================================================
//  Minimap
// ============================================================================
class Minimap {
  constructor(canvas, game, renderer) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.g = game; this.r = renderer;
    this.base = makeCanvas(game.n, game.n);
    this.baseVer = -1; this.baseT = -99;
    this.pings = [];
    this.W = canvas.width; this.H = canvas.height;
  }
  // tile -> minimap px
  toMini(x, y) { const n = this.g.n, s = this.W / (2 * n); return [(x - y) * s + this.W / 2, (x + y) * s / 2 + (this.H - this.W / 2) / 2]; }
  fromMini(mx, my) { const n = this.g.n, s = this.W / (2 * n); const a = (mx - this.W / 2) / s, b = (my - (this.H - this.W / 2) / 2) / (s / 2); return { x: (a + b) / 2, y: (b - a) / 2 }; }
  rebuildBase() {
    const g = this.g, n = g.n;
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(n, n);
    const d = img.data;
    const cache = TERRAINS.map(t => hexRgb(t.mini));
    for (let i = 0; i < n * n; i++) {
      let c = cache[g.terrain[i]];
      const id = g.occ[i];
      if (id) {
        const e = g.ents.get(id);
        if (e && e.kind === 'resource') c = e.type === 'tree' ? [38, 78, 30] : e.type === 'gold' ? [232, 196, 50] : e.type === 'stone' ? [170, 170, 165] : e.type === 'berry' ? [200, 90, 140] : c;
      }
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.baseVer = g.resVersion;
  }
  ping(x, y, col = '#ff4030') { this.pings.push({ x, y, t: 0, col }); }
  draw(dt) {
    const g = this.g, ctx = this.ctx, n = g.n;
    if (this.baseVer !== g.resVersion && performance.now() - this.baseT > 3000) { this.rebuildBase(); this.baseT = performance.now(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const s = this.W / (2 * n);
    const oy = (this.H - this.W / 2) / 2;
    ctx.save();
    ctx.setTransform(s, s / 2, -s, s / 2, this.W / 2, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);
    // buildings and units
    for (const b of g.buildings) {
      if (b.dead || (g.viewer && !this.r.isAllyOfViewer(b.owner) && !b.seen)) continue;
      ctx.fillStyle = b.type === 'farm' ? shade(g.players[b.owner].color.main, 0.6) : g.players[b.owner].color.main;
      ctx.fillRect(b.tx, b.ty, b.w, b.h);
    }
    for (const u of g.units) {
      if (u.dead || u.garrisonedIn) continue;
      if (g.viewer && !this.r.isAllyOfViewer(u.owner) && !g.isVisible(u.x, u.y)) continue;
      ctx.fillStyle = u.owner === 0 ? '#e8e0c8' : u.selected ? '#ffffff' : g.players[u.owner].color.light;
      const sz = u.st.classes.includes('siege') ? 2.2 : 1.6;
      ctx.fillRect(u.x - sz / 2, u.y - sz / 2, sz, sz);
    }
    if (g.viewer && g.reveal !== 'all') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.r.fogCv, 0, 0);
    }
    ctx.restore();
    // camera view
    const r = this.r;
    const corners = [[0, 0], [r.vw, 0], [r.vw, r.vh], [0, r.vh]].map(([x, y]) => { const t = r.screenToTile(x, y); return this.toMini(t.x, t.y); });
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); corners.forEach((c, i) => i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])); ctx.closePath(); ctx.stroke();
    // pings
    const out = [];
    for (const p of this.pings) {
      p.t += dt;
      if (p.t > 3) continue;
      out.push(p);
      const [mx, my] = this.toMini(p.x, p.y);
      const k = (p.t % 1);
      ctx.strokeStyle = p.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 3 + k * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.pings = out;
  }
}
