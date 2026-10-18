'use strict';
// ============================================================================
//  Renderer3D — WebGL renderer with the same interface as the 2D Renderer.
//  Camera: fixed yaw (looking from +x/+z like the isometric view), adjustable
//  zoom. `cam.x/cam.y` keep the 2D renderer's pan semantics so input code is
//  shared; the vertical axis is scaled for the steeper 3D pitch.
// ============================================================================

const GFX_QUALITY = {
  high:   { shadow: 2048, texPx: 30, detail: 1, aa: true, maxDpr: 2, minZoom: 0.45 },
  medium: { shadow: 1024, texPx: 20, detail: 0.6, aa: true, maxDpr: 1.5, minZoom: 0.6 },
  low:    { shadow: 0, texPx: 14, detail: 0.25, aa: false, maxDpr: 1, minZoom: 0.6 },
};
const CAM_PITCH = 52 * Math.PI / 180, CAM_FOV = 30;
const HH3 = HW * Math.sin(CAM_PITCH);
const PX = 0.022;   // 2D projectile height (px) -> world units

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

class Renderer3D {
  constructor(canvas, game, qualityName = 'high') {
    this.is3D = true;
    this.cv = canvas; this.g = game;
    const q = this.q = GFX_QUALITY[qualityName] || GFX_QUALITY.high;
    initModelGeo(); initUnitGeo();
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance' });
    this.gl.outputEncoding = THREE.sRGBEncoding;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = q.shadow > 0;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 600);
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.vw = canvas.clientWidth || 800; this.vh = canvas.clientHeight || 600; this.dpr = 1;
    this.time = 0;
    this.styles = game.players.map(p => p.civ ? p.civ.style : 'west');
    this.showHp = 'damaged';
    this.list = []; this.hitList = []; this.bars = [];
    this.markers = []; this.particles = [];
    this.ghost = null; this.selBox = null; this.dragLine = null; this.hover = null; this.pickPad = 0;
    this.stats = { entities: 0, chunksDrawn: 0 };
    const n = game.n;
    R3.uniforms.mapSize.value = n;
    // fog of war texture (alpha = darkness)
    this.fogCv = makeCanvas(n, n);
    this.fogCtx = this.fogCv.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(n, n);
    this.fogTex = new THREE.CanvasTexture(this.fogCv);
    this.fogTex.minFilter = this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.wrapS = this.fogTex.wrapT = THREE.ClampToEdgeWrapping;
    this.fogTex.flipY = false;   // row 0 of the canvas = tile row 0 (world z = 0)
    R3.uniforms.fogMap.value = this.fogTex;
    R3.uniforms.fogOn.value = game.viewer && game.reveal !== 'all' ? 1 : 0;
    this.fogTick = -1;
    R3.uniforms.cloudMap.value = this.cloudTexture();
    this.setupLights();
    this.terrain = new Terrain3D(game, this.scene, q);
    this.units = new UnitRenderer(this.scene, q.shadow > 0);
    this.bb = new Map();         // building / resource batches
    this.treeChunks = new Map();
    this.treeBuckets = null; this.treeVer = -1;
    this.setupParticles();
    this.setupOverlay();
    this.flattened = new Set();
  }

  // ------------------------------------------------------------------ setup
  setupLights() {
    const map = this.g.opts.map;
    const warm = map === 'oasis' || map === 'arabia', cold = map === 'frozennorth';
    const sky = cold ? '#c8dcf0' : warm ? '#f2e2c4' : '#d8e8f4';
    this.hemi = new THREE.HemisphereLight(lin(sky), lin(cold ? '#6a6a78' : '#5a4a32'), cold ? 0.75 : 0.62);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(lin(cold ? '#e8eeff' : warm ? '#fff0d0' : '#fff6e4'), cold ? 1.9 : 2.2);
    this.sunDir = new THREE.Vector3(-0.55, 1.25, 0.75).normalize();
    this.sun.castShadow = this.q.shadow > 0;
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.02;
      this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 120;
    }
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    const fogCol = cold ? '#a8b8c8' : warm ? '#c8b496' : '#9fb0a8';
    this.scene.fog = new THREE.Fog(lin(fogCol), 60, 200);
    this.scene.background = lin('#06070a');
  }

  cloudTexture() {
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const nz = fbmTile(301, 4, 5);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = nz(x / S * 4, y / S * 4), o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255; img.data[o + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return canvasTex(c, { srgb: false });
  }

  setupOverlay() {
    let ov = document.getElementById('overlay2d');
    if (!ov) {
      ov = document.createElement('canvas');
      ov.id = 'overlay2d';
      ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;width:100%;height:100%';
      this.cv.parentNode.insertBefore(ov, this.cv.nextSibling);
    }
    ov.hidden = false;
    this.ov = ov; this.octx = ov.getContext('2d');
    // placement tiles
    const tg = new THREE.PlaneGeometry(0.94, 0.94); tg.rotateX(-Math.PI / 2);
    this.tileMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }), 128);
    this.tileMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(128 * 3), 3);
    this.tileMesh.frustumCulled = false; this.tileMesh.count = 0; this.tileMesh.renderOrder = 3;
    this.scene.add(this.tileMesh);
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x80ff80, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.8 });
  }

  setupParticles() {
    const CAP = 2500;
    const mk = (additive) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('pcolor', new THREE.BufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 400 } },
        vertexShader: `attribute vec4 pcolor; attribute float psize; varying vec4 vC; uniform float scale;
          void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = vC.a * smoothstep(0.25, 0.05, r); gl_FragColor = vec4(vC.rgb, a); }`,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false; p.renderOrder = 5;
      this.scene.add(p);
      return { pts: p, geo: g, cap: CAP };
    };
    this.pNormal = mk(false); this.pAdd = mk(true);
  }

  // ------------------------------------------------------------------ camera (same API as 2D)
  resize(w, h, dpr) {
    this.vw = w; this.vh = h;
    this.dpr = Math.min(dpr || 1, this.q.maxDpr, window.devicePixelRatio || 1);
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(w, h, false);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const od = Math.min(2, window.devicePixelRatio || 1);
    this.ov.width = Math.round(w * od); this.ov.height = Math.round(h * od); this.odpr = od;
  }
  worldToTile(wx, wy) { return { x: (wx / HW + wy / HH3) / 2, y: (wy / HH3 - wx / HW) / 2 }; }
  centerOn(x, y) { this.cam.x = (x - y) * HW; this.cam.y = (x + y) * HH3; this.clampCam(); }
  clampCam() {
    const n = this.g.n, t = this.worldToTile(this.cam.x, this.cam.y);
    const cx = clamp(t.x, 0, n), cy = clamp(t.y, 0, n);
    if (cx !== t.x || cy !== t.y) { this.cam.x = (cx - cy) * HW; this.cam.y = (cx + cy) * HH3; }
  }
  setZoom(z, sx = this.vw / 2, sy = this.vh / 2) {
    const before = this.screenToTile(sx, sy);
    this.cam.zoom = clamp(z, this.q.minZoom, 2.2);
    this.updateCamera();
    const after = this.screenToTile(sx, sy);
    const t = this.worldToTile(this.cam.x, this.cam.y);
    this.centerOn(t.x + before.x - after.x, t.y + before.y - after.y);
  }
  camDist() { return (this.vh / 2) / (45.25 * this.cam.zoom * Math.tan(CAM_FOV / 2 * Math.PI / 180)); }
  updateCamera() {
    const t = this.worldToTile(this.cam.x, this.cam.y);
    const tx = clamp(t.x, 0, this.g.n), ty = clamp(t.y, 0, this.g.n);
    const th = this.terrain ? Math.max(0, this.terrain.hAt(tx, ty)) : 0;
    const D = this.camDist();
    const hz = Math.cos(CAM_PITCH) * D / Math.SQRT2;
    this.camera.position.set(tx + hz, th + Math.sin(CAM_PITCH) * D, ty + hz);
    this.camera.lookAt(tx, th, ty);
    this.camera.updateMatrixWorld();
    this.camTarget = { x: tx, y: ty, h: th };
    this.scene.fog.near = D * 1.15; this.scene.fog.far = D * 3.2;
    // shadows follow the view
    if (this.sun.castShadow) {
      const R = Math.min(70, D * 0.75 + 6);
      const sc = this.sun.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.updateProjectionMatrix();
    }
    this.sun.position.set(tx + this.sunDir.x * 50, th + this.sunDir.y * 50, ty + this.sunDir.z * 50);
    this.sun.target.position.set(tx, th, ty);
    this.sun.target.updateMatrixWorld();
  }
  screenToTile(sx, sy) {
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    const v = this._v2 || (this._v2 = new THREE.Vector2());
    v.set(sx / this.vw * 2 - 1, -(sy / this.vh) * 2 + 1);
    ray.setFromCamera(v, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let h = this.camTarget ? this.camTarget.h : 0;
    let x = 0, z = 0;
    for (let it = 0; it < 3; it++) {
      const t = (h - o.y) / (d.y || -1e-6);
      x = o.x + d.x * t; z = o.z + d.z * t;
      h = this.terrain.hAt(x, z);
      if (h < WATER_Y) h = WATER_Y;
    }
    return { x, y: z };
  }
  tileToScreen(x, y, z = 0) {
    const v = this._pv || (this._pv = new THREE.Vector3());
    v.set(x, Math.max(WATER_Y, this.terrain.hAt(x, y)) + z, y).project(this.camera);
    return [(v.x + 1) / 2 * this.vw, (1 - v.y) / 2 * this.vh, v.z];
  }
  project(x, h, y) {
    const v = this._pv2 || (this._pv2 = new THREE.Vector3());
    v.set(x, h, y).project(this.camera);
    return [(v.x + 1) / 2 * this.vw, (1 - v.y) / 2 * this.vh, v.z];
  }
  isAllyOfViewer(owner) { const g = this.g; if (!g.viewer) return true; return owner !== 0 && g.players[g.viewer].isAlly(owner); }

  // ------------------------------------------------------------------ fog
  updateFog() {
    const g = this.g;
    if (!g.viewer || this.fogTick === g.tickN) return;
    this.fogTick = g.tickN;
    const d = this.fogImg.data, vis = g.vis, ex = g.explored, nn = g.n * g.n;
    const reveal = g.reveal === 'all';
    for (let i = 0, j = 3; i < nn; i++, j += 4) d[j] = reveal ? 0 : ex[i] ? (vis[i] ? 0 : 110) : 255;
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ batches for prototypes
  protoBatch(key, part) {
    const k = key + '|' + part.mat;
    let b = this.bb.get(k);
    if (!b) { b = new Batch(this.scene, part.geometry, getMat(part.mat), { shadow: this.q.shadow > 0 }); this.bb.set(k, b); }
    return b;
  }
  pushProto(key, proto, matrix, pcol) {
    for (const part of proto.parts) this.protoBatch(key, part).push(matrix, part.mat === 'cloth' ? pcol : WHITE);
  }

  // ------------------------------------------------------------------ trees (static chunks)
  rebuildTreeBuckets() {
    const CHK = 16, n = this.g.n, nc = Math.ceil(n / CHK);
    const b = new Map();
    for (const r of this.g.resources) {
      if (r.dead || r.type !== 'tree') continue;
      const k = Math.floor(r.ty / CHK) * nc + Math.floor(r.tx / CHK);
      let a = b.get(k); if (!a) b.set(k, a = []);
      a.push(r);
    }
    this.treeBuckets = b; this.treeCHK = CHK; this.treeNC = nc;
    this.treeVer = this.g.resVersion;
  }
  syncTrees(view) {
    if (this.treeVer !== this.g.resVersion) this.rebuildTreeBuckets();
    const CHK = this.treeCHK, nc = this.treeNC, gt = this.g.time;
    const cx0 = Math.max(0, Math.floor(view.x0 / CHK)), cx1 = Math.min(nc - 1, Math.floor(view.x1 / CHK));
    const cy0 = Math.max(0, Math.floor(view.y0 / CHK)), cy1 = Math.min(nc - 1, Math.floor(view.y1 / CHK));
    const live = new Set();
    let drawn = 0;
    const lod = this.cam.zoom < 0.8 ? 1 : 0;
    const shadows = this.q.shadow > 0 && this.cam.zoom >= 0.7;
    let budget = this.treeBudget == null ? 999 : 2;
    this.treeBudget = 2;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cy * nc + cx;
      live.add(k);
      const trees = this.treeBuckets.get(k) || [];
      // signature: alive count + felled count + toppling trees (drawn dynamically)
      let felled = 0, falling = 0;
      for (const r of trees) {
        if (r.dead) continue;
        if (r.fellAt != null) { if (gt - r.fellAt < 0.9) { falling++; this.drawFalling(r, gt); } else felled++; }
      }
      const sig = trees.length * 1e6 + felled * 1e3 + falling + lod * 0.5;
      let ch = this.treeChunks.get(k);
      if ((!ch || ch.sig !== sig) && (budget > 0 || !ch)) {
        budget--;
        if (ch) this.disposeChunk(ch);
        ch = this.buildTreeChunk(trees, cx, cy, gt, lod); ch.sig = sig; this.treeChunks.set(k, ch);
      }
      for (const m of ch.meshes) { m.visible = true; m.castShadow = shadows; }
      drawn++;
    }
    // hide chunks out of view (keep a few cached)
    for (const [k, ch] of this.treeChunks) if (!live.has(k)) { for (const m of ch.meshes) m.visible = false; }
    if (this.treeChunks.size > 120) for (const [k, ch] of this.treeChunks) { if (!live.has(k)) { this.disposeChunk(ch); this.treeChunks.delete(k); if (this.treeChunks.size <= 90) break; } }
    this.stats.chunksDrawn = drawn;
  }
  treeMatrix(r, out) {
    const s = 0.88 + hash2(r.tx, r.ty, 12) * 0.3;
    this._e = this._e || new THREE.Euler(); this._q = this._q || new THREE.Quaternion();
    this._e.set(0, hash2(r.tx, r.ty, 13) * 6.28, 0); this._q.setFromEuler(this._e);
    return out.compose(new THREE.Vector3(r.x + (hash2(r.tx, r.ty, 14) - 0.5) * 0.2, this.terrain.hAt(r.x, r.y), r.y + (hash2(r.tx, r.ty, 15) - 0.5) * 0.2), this._q, new THREE.Vector3(s, s, s));
  }
  buildTreeChunk(trees, cx, cy, gt, lod) {
    const groups = new Map();
    const m = new THREE.Matrix4();
    for (const r of trees) {
      if (r.dead) continue;
      const felled = r.fellAt != null;
      if (felled && gt - r.fellAt < 0.9) continue;
      const key = `${r.variant}|${Math.floor(hash2(r.tx, r.ty, 7) * 2)}|${felled ? 1 : 0}`;
      let a = groups.get(key); if (!a) groups.set(key, a = []);
      a.push(this.treeMatrix(r, m).clone());
    }
    const meshes = [];
    for (const [key, mats] of groups) {
      const [kind, sub, f] = key.split('|').map(Number);
      const proto = treeProto(kind, sub, !!f, lod);
      for (const part of proto.parts) {
        // shared geometry; chunks outside the view are hidden by syncTrees, so no per-mesh culling
        const im = new THREE.InstancedMesh(part.geometry, getMat(part.mat), mats.length);
        mats.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.frustumCulled = false;
        im.castShadow = this.q.shadow > 0; im.receiveShadow = true;
        this.scene.add(im);
        meshes.push(im);
      }
    }
    return { meshes };
  }
  disposeChunk(ch) { for (const m of ch.meshes) { this.scene.remove(m); m.dispose(); } }
  drawFalling(r, gt) {
    const k = clamp((gt - r.fellAt) / 0.9, 0, 1);
    const sub = Math.floor(hash2(r.tx, r.ty, 7) * 2);
    const proto = treeProto(r.variant, sub, false, 0);
    const dir = hash2(r.tx, r.ty, 8) < 0.5 ? -1 : 1;
    const m = this.treeMatrix(r, new THREE.Matrix4());
    const rot = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, -1).normalize(), dir * k * k * 1.45);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    m.setPosition(0, 0, 0); m.premultiply(rot); m.setPosition(p);
    this.pushProto(`t|${r.variant}|${sub}|0`, proto, m, WHITE);
    if (k > 0.95 && !r._landed) { r._landed = true; this.burst('dust', r.x + dir * 0.6, r.y - dir * 0.6, 6); this.burst('leaf', r.x + dir * 0.8, r.y - dir * 0.8, 6); }
  }

  // ------------------------------------------------------------------ main render
  render(alpha, dt) {
    const g = this.g;
    this.time += dt;
    R3.uniforms.time.value = this.time;
    this.updateCamera();
    this.updateFog();
    this.terrain.update(this.time);
    const view = this.viewTiles();
    this.terrain.showDetail(view);
    this.list.length = 0; this.hitList.length = 0; this.bars.length = 0;
    const viewer = g.viewer;
    const camPos = this.camera.position;
    const hits = [];
    // ---- buildings
    for (const b of g.buildings) {
      if (b.dead) continue;
      if (b.x < view.x0 - 3 || b.x > view.x1 + 3 || b.y < view.y0 - 3 || b.y > view.y1 + 3) continue;
      if (viewer && !this.isAllyOfViewer(b.owner) && !b.seen) continue;
      if (!this.flattened.has(b.id)) { this.flattened.add(b.id); b._baseY = this.terrain.flattenRect(b.tx, b.ty, b.w, b.h); this.terrain.clearDetailAt(b.tx, b.ty, b.w, b.h); }
      this.drawBuilding(b, hits);
    }
    // ---- trees and other resources
    this.syncTrees(view);
    const m = this._m || (this._m = new THREE.Matrix4());
    for (const r of g.resources) {
      if (r.dead) continue;
      if (r.x < view.x0 - 1 || r.x > view.x1 + 1 || r.y < view.y0 - 1 || r.y > view.y1 + 1) continue;
      if (viewer && !g.isExplored(r.x, r.y)) continue;
      const h = this.terrain.hAt(r.x, r.y);
      if (r.type === 'tree') {
        if (r._shakeT != null && this.time - r._shakeT < 0.3 && r.fellAt == null) { /* shake handled by wind */ }
        const [sx, sy, sz] = this.project(r.x, h, r.y), [, ty] = this.project(r.x, h + 1.9, r.y);
        hits.push({ e: r, x0: sx - 16, x1: sx + 16, y0: ty, y1: sy + 6, res: true, z: sz });
        continue;
      }
      let proto, key;
      if (r.type === 'carcass') { key = `r|carcass|0|${r.animal}`; proto = resourceProto('carcass', 0, r.animal); }
      else { const f = r.amount / r.max, st = f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : 3, sub = Math.floor(hash2(r.tx, r.ty, 7) * 4); key = `r|${r.type}|${st}|${sub}`; proto = resourceProto(r.type, st, sub); }
      m.makeRotationY(hash2(r.tx, r.ty, 9) * 6.28).setPosition(r.x, h, r.y);
      this.pushProto(key, proto, m, WHITE);
      const [sx, sy, sz] = this.project(r.x, h, r.y), [, ty] = this.project(r.x, h + 0.5, r.y);
      hits.push({ e: r, x0: sx - 18, x1: sx + 18, y0: ty, y1: sy + 8, res: true, z: sz });
    }
    // ---- corpses and rubble
    for (const c of g.corpses) {
      if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 || c.y > view.y1) continue;
      if (viewer && !g.isVisible(c.x, c.y)) continue;
      const age = g.time - c.t0;
      const sink = age > 30 ? (age - 30) / 10 * 0.25 : 0;
      const h = this.terrain.hAt(c.x, c.y);
      const pc = this.pcol(c.owner);
      this.units.draw(c, c.x, h, c.y, c.facing > 0 ? 0.6 : 2.5, 'idle', 0, g.players[c.owner].color, { dead: true, sink });
      if (!UNITS[c.type].sprite.body.match(/ram|mangonel|trebuchet/)) this.units.blood(c.x + 0.05, h, c.y, 0.18);
      void pc;
    }
    for (const f of g.fx) {
      if (f.type !== 'rubble') continue;
      if (f.x < view.x0 - 3 || f.x > view.x1 + 3 || f.y < view.y0 - 3 || f.y > view.y1 + 3) continue;
      const age = g.time - f.t0, sink = age > f.life - 10 ? (age - (f.life - 10)) / 10 * 0.3 : 0;
      m.makeTranslation(f.x, this.terrain.hAt(f.x, f.y) - sink, f.y);
      this.pushProto('rubble|' + f.size, rubbleProto(f.size), m, WHITE);
    }
    // ---- units
    const ur = this.units;
    for (const u of g.units) {
      if (u.dead || u.garrisonedIn) continue;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      if (x < view.x0 - 1 || x > view.x1 + 1 || y < view.y0 - 1 || y > view.y1 + 1) continue;
      if (viewer && !this.isAllyOfViewer(u.owner) && !g.isVisible(x, y)) continue;
      const h = Math.max(this.terrain.hAt(x, y), u.st.classes.includes('siege') ? -0.05 : WATER_Y - 0.05);
      // heading: movement direction, otherwise towards the current target
      let want = u._hd != null ? u._hd : (u.facing > 0 ? 0.6 : 2.5);
      const mx = u.x - u.px, my = u.y - u.py;
      if (Math.abs(mx) + Math.abs(my) > 0.002) want = Math.atan2(my, mx);
      else if (u.order && u.order.target) { const t = g.ents.get(u.order.target); if (t && !t.dead) want = Math.atan2(t.y - u.y, t.x - u.x); }
      if (u._hd == null) u._hd = want;
      let dA = want - u._hd; while (dA > Math.PI) dA -= Math.PI * 2; while (dA < -Math.PI) dA += Math.PI * 2;
      u._hd += dA * Math.min(1, dt * 9);
      const [act, ft] = this.unitAnim(u);
      ur.draw(u, x, h, y, u._hd, act, ft, g.players[u.owner].color);
      if (u.selected) ur.ring(x, h, y, u.radius * 1.5 + 0.08, u.owner === viewer || !viewer ? ucol('#ffffff') : ucol(g.players[u.owner].color.light));
      // impact effects synced to work swings
      if (u.isVillager && (act === 'gather' || act === 'build')) {
        const hitF = Math.round(WORK_HIT * WORK_FRAMES), fr = Math.floor(ft);
        if (fr === hitF && u._rf !== hitF) this.workImpact(u);
        u._rf = fr;
      }
      const body = UNITS[u.type].sprite.body;
      const top = body === 'trebuchet' ? 1.6 : body === 'horse' ? 1.05 : u.st.classes.includes('siege') ? 0.7 : u.st.animal ? 0.45 : 0.85;
      const [sx, sy, sz] = this.project(x, h, y), [tx, ty] = this.project(x, h + top, y);
      const hw = Math.max(9, (sy - ty) * 0.32);
      hits.push({ e: u, x0: sx - hw, x1: sx + hw, y0: ty, y1: sy + 4, z: sz, wx: sx, wy: sy });
      this.list.push({ kind: 'unit', e: u, sx, sy: (sy + ty) / 2 });
      const showBar = u.selected || this.hover === u || g.time - u.lastHitT < 3 || this.showHp === 'all';
      if (showBar && (!u.st.animal || u.selected || this.hover === u)) this.bars.push({ x: tx, y: ty - 8, f: u.hp / u.st.hp, w: 24, prog: null });
    }
    // ---- projectiles, markers, rally points, ghost
    this.drawProjectiles(view);
    this.drawMarkers(dt);
    this.drawGhost();
    // ---- particles
    this.updateParticles(dt);
    // flush instanced batches
    ur.flush();
    for (const b of this.bb.values()) b.flush();
    // hit list: far first so the nearest entity is checked first when iterating backwards
    hits.sort((a, b) => b.z - a.z);
    this.hitList = hits;
    this.stats.entities = hits.length;
    this.gl.render(this.scene, this.camera);
    this.drawOverlay();
  }

  pcol(owner) { return lin(this.g.players[owner].color.main); }

  unitAnim(u) {
    const a = u.anim, t = u.animT;
    if (a === 'walk') return ['walk', (t * 7 * Math.max(0.6, u.st.speed / 0.9)) % 4];
    if (a === 'attack') {
      const R = Math.max(0.6, u.st.reload);
      if (u.isVillager) return ['attack', t < 0.2 ? 2 : t < 0.45 ? 3 : t > 1.2 ? 0 : 1];
      if (u.st.proj) return ['attack', t < 0.18 ? 3 : t > R - 0.35 ? 2 : t > R - 0.8 ? 1 : 0];
      return ['attack', t < 0.14 ? 2 + t / 0.14 * 0.9 : t < 0.32 ? 3 : t > R - 0.3 ? (t - (R - 0.3)) / 0.3 * 0.99 : 1];
    }
    if ((a === 'gather' || a === 'build') && u.isVillager) { const P = WORK_CYCLE[u.task] || 0.8; return [a, ((t % P) / P * WORK_FRAMES) % WORK_FRAMES]; }
    if (a === 'gather' || a === 'build') return [a, ((t % 0.8) / 0.2) % 4];
    if (a === 'pray') return ['pray', Math.floor(t * 2) % 2];
    if (u.st.animal) return ['idle', Math.floor(t / 1.6 + u.id) % 2];
    return ['idle', 0];
  }

  viewTiles() {
    const pts = [[0, 0], [this.vw, 0], [0, this.vh], [this.vw, this.vh]].map(([x, y]) => this.screenToTile(x, y));
    const n = this.g.n;
    return {
      x0: clamp(Math.min(...pts.map(p => p.x)) - 2, 0, n), x1: clamp(Math.max(...pts.map(p => p.x)) + 2, 0, n),
      y0: clamp(Math.min(...pts.map(p => p.y)) - 2, 0, n), y1: clamp(Math.max(...pts.map(p => p.y)) + 2, 0, n),
    };
  }

  wallMask(b) {
    const g = this.g, n = g.n;
    let mm = 0;
    const chk = (x, y, bit) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const e = g.ents.get(g.occ[y * n + x]); if (e && e.kind === 'building' && (e.def.wall || e.def.gate) && e.owner === b.owner) mm |= bit; };
    chk(b.tx + 1, b.ty, 1); chk(b.tx, b.ty + 1, 2); chk(b.tx - 1, b.ty, 4); chk(b.tx, b.ty - 1, 8);
    return mm;
  }

  drawBuilding(b, hits) {
    const g = this.g;
    const style = this.styles[b.owner] || 'west';
    let stage = b.built ? 'done' : b.progress < 0.33 ? 'b0' : b.progress < 0.66 ? 'b1' : 'b2';
    let extra = '';
    if (b.type === 'farm') { const f = b.foodMax ? b.food / b.foodMax : 0; extra = !b.built ? 'b' : f > 0.66 ? 'f3' : f > 0.33 ? 'f2' : f > 0.05 ? 'f1' : 'f0'; if (!b.built) stage = 'done'; }
    else if (b.def.wall || b.def.gate) extra = String(this.wallMask(b));
    const key = `b|${b.type}|${style}|${stage}|${extra}`;
    const proto = buildingProto(b.type, style, stage, extra);
    const base = b._baseY != null ? b._baseY : this.terrain.hAt(b.x, b.y);
    const m = this._bm || (this._bm = new THREE.Matrix4());
    m.makeTranslation(b.tx, base, b.ty);
    const pc = this.pcol(b.owner);
    this.pushProto(key, proto, m, pc);
    if (b.built && b.type === 'mill') {
      const bm = this._bm2 || (this._bm2 = new THREE.Matrix4());
      bm.makeRotationX(this.time * 1.3 + b.id).setPosition(b.tx + 1.63, base + 0.87, b.ty + 1.0);
      this.pushProto('mill-blades', millBladesProto(), bm, pc);
    }
    if (b.selected) this.units.ring(b.x, base, b.y, b.w * 0.75 + 0.15, ucol('#ffffff'), true);
    // damage: flames and smoke
    if (b.built) {
      const dmg = 1 - b.hp / b.maxHp;
      if (dmg > 0.35 && Math.random() < dmg * 0.7 * (b.w / 2)) this.spawnFire(b, dmg, base, proto.height);
      if ((b.type === 'blacksmith' && Math.random() < 0.1) || (b.type === 'house' && (style === 'west' || style === 'west2') && Math.random() < 0.015)) {
        const [cx, cy, ch] = b.type === 'blacksmith' ? [b.tx + 0.7, b.ty + 0.7, 2.0] : [b.tx + 0.61, b.ty + 0.61, 1.3];
        this.addP('smoke', cx, base + ch, cy, (Math.random() - 0.5) * 0.1, 0.35, (Math.random() - 0.5) * 0.1, 3.5, 0.25);
      }
    }
    // picking box and HP bar
    const top = b.built ? proto.height : Math.max(0.3, proto.height);
    const pts = [this.project(b.tx, base, b.ty + b.h), this.project(b.tx + b.w, base, b.ty), this.project(b.tx + b.w, base, b.ty + b.h), this.project(b.x, base + top, b.y)];
    const x0 = Math.min(pts[0][0], pts[1][0]), x1 = Math.max(pts[0][0], pts[1][0]);
    hits.push({ e: b, x0: x0 + 4, x1: x1 - 4, y0: pts[3][1], y1: pts[2][1], bld: true, z: this.project(b.x, base, b.y)[2] });
    this.list.push({ kind: 'bld', e: b });
    const showBar = b.selected || this.hover === b || g.time - b.lastHitT < 3 || !b.built || this.showHp === 'all';
    if (showBar && b.type !== 'farm' && !(b.def.wall && !b.selected && this.hover !== b)) this.bars.push({ x: (x0 + x1) / 2, y: pts[3][1] - 10, f: b.hp / b.maxHp, w: Math.min(70, 20 + b.w * 12), prog: b.built ? null : b.progress });
  }

  // ------------------------------------------------------------------ projectiles & markers
  drawProjectiles(view) {
    const g = this.g, ur = this.units;
    const m = this._pm || (this._pm = new THREE.Matrix4());
    const e = this._pe || (this._pe = new THREE.Euler()), q = this._pq || (this._pq = new THREE.Quaternion());
    for (const p of g.projectiles) {
      if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
      if (g.viewer && !g.isVisible(p.x, p.y) && !g.isVisible(p.sx, p.sy)) continue;
      const h = Math.max(WATER_Y, this.terrain.hAt(p.x, p.y)) + p.z * PX;
      // direction from the last frame
      const lx = p._lx != null ? p._lx : p.sx, ly = p._ly != null ? p._ly : p.sy, lh = p._lh != null ? p._lh : h;
      const dx = p.x - lx, dz = p.y - ly, dy = h - lh;
      p._lx = p.x; p._ly = p.y; p._lh = h;
      const yaw = Math.atan2(dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
      e.set(0, -yaw, pitch, 'YZX'); q.setFromEuler(e);
      if (p.type === 'stone' || p.type === 'boulder') {
        const s = p.type === 'boulder' ? 0.12 : 0.08;
        m.compose(_v3.set(p.x, h, p.y), q, _s3.set(s, s, s));
        ur.batch('ico', 'matte').push(m, ucol('#7a766e'));
      } else {
        const len = p.type === 'javelin' || p.type === 'spear' ? 0.5 : p.type === 'axe' ? 0.15 : p.type === 'bullet' ? 0.3 : 0.36;
        m.compose(_v3.set(p.x, h, p.y), q, _s3.set(len, 0.015, 0.015));
        ur.batch('box', 'matte').push(m, ucol(p.type === 'axe' ? '#c8ccd0' : p.type === 'bullet' ? '#ffe070' : '#6a4a24'));
      }
    }
    // impacts & stuck arrows
    for (const f of g.fx) {
      if (f.type !== 'stuck') continue;
      const k = (g.time - f.t0) / f.life;
      if (k > 1 || f.x < view.x0 || f.x > view.x1 || f.y < view.y0 || f.y > view.y1) continue;
      const h = this.terrain.hAt(f.x, f.y) + f.z * PX;
      m.compose(_v3.set(f.x, h + 0.08, f.y), q.setFromEuler(e.set(0.3, f.a, 0.9)), _s3.set(0.012, 0.25, 0.012));
      ur.batch('box', 'matte').push(m, ucol('#5a3a1a'));
    }
  }
  addMarker(x, y, type) { this.markers.push({ x, y, type, t: 0 }); }
  flashBuilding(b) { this.markers.push({ x: b.x, y: b.y, type: 'bld', b, t: 0 }); }
  drawMarkers(dt) {
    const out = [];
    for (const mk of this.markers) {
      mk.t += dt;
      const life = mk.type === 'bld' ? 1.1 : 0.7;
      if (mk.t > life) continue;
      out.push(mk);
      const k = mk.t / life, h = this.terrain.hAt(mk.x, mk.y);
      if (mk.type === 'bld') {
        const pulse = 0.5 + 0.5 * Math.sin(mk.t * 18);
        const c = new THREE.Color(1, 0.85, 0.35).multiplyScalar(0.4 + 0.6 * pulse * (1 - k));
        this.units.ring(mk.b.x, (mk.b._baseY || h), mk.b.y, mk.b.w * 0.8 + (1 - k) * 0.3, c, true);
      } else {
        const c = mk.type === 'attack' ? ucol('#ff503c') : mk.type === 'gather' ? ucol('#f0d25a') : ucol('#78e678');
        const cc = c.clone().multiplyScalar(1 - k);
        this.units.ring(mk.x, h, mk.y, 0.45 * (1 - k) + 0.1, cc);
        this.units.ring(mk.x, h, mk.y, 0.45 * (1 - k) + 0.25, cc);
      }
    }
    this.markers = out;
    // rally points of selected buildings
    const g = this.g;
    for (const it of this.list) {
      const b = it.e;
      if (it.kind !== 'bld' || !b.selected || !b.rally || b.owner !== g.viewer) continue;
      const m = this._rm || (this._rm = new THREE.Matrix4());
      m.makeTranslation(b.rally.x, this.terrain.hAt(b.rally.x, b.rally.y), b.rally.y);
      this.pushProto('rally', rallyProto(), m, this.pcol(b.owner));
    }
  }

  drawGhost() {
    const gh = this.ghost, tm = this.tileMesh;
    tm.count = 0;
    if (this.ghostGroup) this.ghostGroup.visible = false;
    if (!gh && !this.dragLine) return;
    const m = new THREE.Matrix4();
    const push = (x, y, ok) => {
      if (tm.count >= 128) return;
      m.makeTranslation(x + 0.5, Math.max(WATER_Y, this.terrain.hAt(x + 0.5, y + 0.5)) + 0.04, y + 0.5);
      tm.setMatrixAt(tm.count, m);
      tm.setColorAt(tm.count, ok ? ucol('#50ff50') : ucol('#ff4a3a'));
      tm.count++;
    };
    if (this.dragLine) for (const [x, y, ok] of this.dragLine) push(x, y, ok);
    if (gh) {
      const d = BUILDINGS[gh.type];
      for (let y = gh.ty; y < gh.ty + d.size; y++) for (let x = gh.tx; x < gh.tx + d.size; x++) push(x, y, gh.ok);
      const style = this.styles[this.g.viewer] || 'west';
      const key = gh.type + '|' + style;
      if (this.ghostKey !== key) {
        if (this.ghostGroup) this.scene.remove(this.ghostGroup);
        const proto = buildingProto(gh.type, style, 'done', gh.type === 'farm' ? 'f3' : (d.wall || d.gate) ? '0' : '');
        this.ghostGroup = new THREE.Group();
        for (const part of proto.parts) this.ghostGroup.add(new THREE.Mesh(part.geometry, this.ghostMat));
        this.ghostGroup.renderOrder = 4;
        this.scene.add(this.ghostGroup);
        this.ghostKey = key;
      }
      this.ghostMat.color.set(gh.ok ? 0x80ff80 : 0xff6050);
      this.ghostGroup.visible = true;
      this.ghostGroup.position.set(gh.tx, Math.max(0, this.terrain.hAt(gh.tx + d.size / 2, gh.ty + d.size / 2)), gh.ty);
    }
    tm.instanceMatrix.needsUpdate = true;
    if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ particles
  addP(t, x, y, z, vx, vy, vz, life, size) {
    if (this.particles.length > 2300) return;
    this.particles.push({ t, x, y, z, vx, vy, vz, life, age: 0, s: size });
  }
  burst(type, tx, ty, n = 6) {
    const h = Math.max(WATER_Y, this.terrain.hAt(tx, ty));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.9;
      const c = Math.cos(a), s = Math.sin(a);
      switch (type) {
        case 'chips': this.addP('chip', tx, h + 0.45, ty, c * sp, 1.2 + Math.random(), s * sp, 0.6, 0.05); break;
        case 'blood': this.addP('blood', tx, h + 0.4, ty, c * sp * 0.6, 1 + Math.random(), s * sp * 0.6, 0.5, 0.05); break;
        case 'dust': this.addP('dust', tx + c * 0.2, h + 0.08, ty + s * 0.2, c * sp * 0.4, 0.25 + Math.random() * 0.3, s * sp * 0.4, 1 + Math.random(), 0.3 + Math.random() * 0.25); break;
        case 'bigdust': this.addP('dust', tx + c * 0.8, h + 0.1, ty + s * 0.8, c * sp, 0.4 + Math.random() * 0.5, s * sp, 2 + Math.random() * 1.5, 0.7 + Math.random() * 0.6); break;
        case 'sparkle': this.addP('spark', tx, h + 0.6, ty, c * sp * 0.3, 0.6 + Math.random(), s * sp * 0.3, 1.2, 0.06); break;
        case 'leaf': this.addP('leaf', tx + c * 0.3, h + 1.2 + Math.random() * 0.5, ty + s * 0.3, c * 0.3, -0.25, s * 0.3, 2, 0.06); break;
        case 'stonechip': this.addP('stonechip', tx, h + 0.2, ty, c * sp, 1.3 + Math.random(), s * sp, 0.5, 0.045); break;
        case 'dirt': this.addP('dirt', tx, h + 0.05, ty, c * sp * 0.4, 0.8 + Math.random() * 0.6, s * sp * 0.4, 0.45, 0.045); break;
      }
    }
  }
  spawnFire(b, dmg, base, height) {
    const x = b.tx + 0.3 + Math.random() * (b.w - 0.6), z = b.ty + 0.3 + Math.random() * (b.h - 0.6);
    const y = base + height * (0.4 + Math.random() * 0.5);
    this.addP('fire', x, y, z, (Math.random() - 0.5) * 0.1, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.1, 0.7 + Math.random() * 0.4, 0.18 + dmg * 0.25);
    if (Math.random() < 0.5) this.addP('smoke', x, y + 0.3, z, 0.15, 0.45, -0.1, 3, 0.35 + dmg * 0.3);
    if (Math.random() < 0.15) this.addP('ember', x, y, z, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, 1.2, 0.035);
  }
  workImpact(u) {
    const t = u.order && this.g.ents.get(u.order.target);
    const task = u.task;
    if (task === 'wood' && t) { this.burst('chips', t.x, t.y, 4); if (Math.random() < 0.5) this.burst('leaf', t.x, t.y, 2); }
    else if ((task === 'gold' || task === 'stone') && t) this.burst(task === 'gold' ? 'sparkle' : 'stonechip', u.x + (t.x - u.x) * 0.6, u.y + (t.y - u.y) * 0.6, task === 'gold' ? 4 : 3);
    else if (task === 'farm') this.burst('dirt', u.x, u.y, 3);
    else if (task === 'build' && t) this.burst('dust', u.x + (t.x - u.x) * 0.2, u.y + (t.y - u.y) * 0.2, 1);
    else if (task === 'forage' && t) this.burst('leaf', t.x, t.y, 1);
  }
  updateParticles(dt) {
    const out = [];
    const N = this.pNormal, A = this.pAdd;
    const np = N.geo.attributes.position.array, nc = N.geo.attributes.pcolor.array, ns = N.geo.attributes.psize.array;
    const ap = A.geo.attributes.position.array, ac = A.geo.attributes.pcolor.array, as = A.geo.attributes.psize.array;
    let ni = 0, ai = 0;
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.t === 'chip' || p.t === 'blood' || p.t === 'stonechip' || p.t === 'dirt') p.vy -= 5 * dt;
      if (p.t === 'leaf') { p.x += Math.sin(p.age * 5) * 0.004; }
      out.push(p);
      const k = p.age / p.life;
      let r, gg, b, a, s = p.s, add = false;
      switch (p.t) {
        case 'smoke': r = 0.22; gg = 0.21; b = 0.2; a = 0.32 * (1 - k); s = p.s * (1 + k * 2.5); break;
        case 'fire': r = 1; gg = 0.55 - k * 0.4; b = 0.12; a = 0.9 * (1 - k); s = p.s * (1 - k * 0.5); add = true; break;
        case 'ember': r = 1; gg = 0.6; b = 0.2; a = 1 - k; add = true; break;
        case 'spark': r = 1; gg = 0.9; b = 0.5; a = 1 - k; add = true; break;
        case 'dust': r = 0.55; gg = 0.47; b = 0.36; a = 0.38 * (1 - k); s = p.s * (1 + k); break;
        case 'chip': r = 0.72; gg = 0.55; b = 0.32; a = 1 - k; break;
        case 'leaf': r = 0.32; gg = 0.55; b = 0.18; a = 1 - k * k; break;
        case 'blood': r = 0.5; gg = 0.04; b = 0.04; a = 1 - k; break;
        case 'stonechip': r = 0.6; gg = 0.59; b = 0.55; a = 1 - k; break;
        case 'dirt': r = 0.4; gg = 0.3; b = 0.18; a = 1 - k; break;
        default: r = gg = b = 1; a = 1 - k;
      }
      if (add) {
        if (ai >= A.cap) continue;
        ap[ai * 3] = p.x; ap[ai * 3 + 1] = p.y; ap[ai * 3 + 2] = p.z; ac[ai * 4] = r; ac[ai * 4 + 1] = gg; ac[ai * 4 + 2] = b; ac[ai * 4 + 3] = a; as[ai] = s; ai++;
      } else {
        if (ni >= N.cap) continue;
        np[ni * 3] = p.x; np[ni * 3 + 1] = p.y; np[ni * 3 + 2] = p.z; nc[ni * 4] = r; nc[ni * 4 + 1] = gg; nc[ni * 4 + 2] = b; nc[ni * 4 + 3] = a; ns[ni] = s; ni++;
      }
    }
    this.particles = out;
    const scale = this.vh * this.dpr / (2 * Math.tan(CAM_FOV / 2 * Math.PI / 180));
    for (const [P, cnt] of [[N, ni], [A, ai]]) {
      P.geo.setDrawRange(0, cnt);
      P.geo.attributes.position.needsUpdate = true; P.geo.attributes.pcolor.needsUpdate = true; P.geo.attributes.psize.needsUpdate = true;
      P.pts.material.uniforms.scale.value = scale;
    }
  }

  // ------------------------------------------------------------------ 2D overlay (bars, selection box)
  drawOverlay() {
    const ctx = this.octx, d = this.odpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ov.width, this.ov.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    for (const b of this.bars) {
      const w = b.w, x = b.x - w / 2, y = b.y;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = b.f > 0.5 ? '#3ac43a' : b.f > 0.25 ? '#e0c030' : '#e03a2a';
      ctx.fillRect(x, y, w * clamp(b.f, 0, 1), 3);
      if (b.prog != null) { ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y + 4, w + 2, 4); ctx.fillStyle = '#e8d080'; ctx.fillRect(x, y + 5, w * b.prog, 2); }
    }
    if (this.selBox) {
      const s = this.selBox;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,0.08)';
      const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1), w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  // ------------------------------------------------------------------ picking
  pick(sx, sy) {
    const pad = this.pickPad || 0;
    let best = null;
    for (let i = this.hitList.length - 1; i >= 0; i--) {
      const h = this.hitList[i];
      if (sx < h.x0 - pad || sx > h.x1 + pad || sy < h.y0 - pad || sy > h.y1 + pad) continue;
      if (h.e.dead) continue;
      if (!h.bld && !h.res) return h.e;
      if (!best) best = h.e;
    }
    const t = this.screenToTile(sx, sy), g = this.g;
    if (t.x >= 0 && t.y >= 0 && t.x < g.n && t.y < g.n) {
      const e = g.ents.get(g.occ[Math.floor(t.y) * g.n + Math.floor(t.x)]);
      if (e && !e.dead && (e.kind === 'building' ? (!g.viewer || this.isAllyOfViewer(e.owner) || e.seen) : g.isExplored(t.x, t.y))) {
        if (!best || best.kind === 'resource') return e;
      }
    }
    return best;
  }
  pickBox(x0, y0, x1, y1) {
    const out = [];
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (const it of this.list) {
      if (it.kind !== 'unit') continue;
      if (it.sx >= ax && it.sx <= bx && it.sy >= ay && it.sy <= by) out.push(it.e);
    }
    return out;
  }

  dispose() {
    try { this.gl.dispose(); } catch (e) { /* ignore */ }
    if (this.ov) { this.octx.clearRect(0, 0, this.ov.width, this.ov.height); this.ov.hidden = true; }
  }
}

// small prototypes used by the renderer
function rubbleProto(size) {
  const key = 'rubble|' + size;
  let p = PROTOS.get(key);
  if (p) return p;
  initModelGeo();
  const B = new ModelBuilder();
  const r = mulberry32(size * 77);
  B.box('plain', '#3a3026', 0, -0.03, 0, size * 0.9, 0.05, size * 0.9);
  for (let i = 0; i < size * 10; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * 0.42;
    B.ico('rock', ['#7a7468', '#8e887c', '#5a544a'][i % 3], Math.cos(a) * d, 0.05, Math.sin(a) * d, 0.06 + r() * 0.12, r() * 5);
  }
  for (let i = 0; i < size * 3; i++) B.boxR('wood', '#3a2614', (r() - 0.5) * size * 0.8, 0.06, (r() - 0.5) * size * 0.8, 0.5, 0.05, 0.06, 0, r() * 3, r() * 0.3);
  p = { parts: B.build(), height: 0.3 };
  PROTOS.set(key, p);
  return p;
}
function rallyProto() {
  let p = PROTOS.get('rally');
  if (p) return p;
  initModelGeo();
  const B = new ModelBuilder();
  B.cyl('wood', '#4a3424', 0, 0, 0, 0.015, 0.02, 0.7, 6);
  B.box('cloth', '#ffffff', 0.13, 0.48, 0, 0.24, 0.16, 0.01);
  B.cyl('plain', '#7a6a4a', 0, 0, 0, 0.12, 0.14, 0.03, 10);
  p = { parts: B.build(), height: 0.7 };
  PROTOS.set('rally', p);
  return p;
}
