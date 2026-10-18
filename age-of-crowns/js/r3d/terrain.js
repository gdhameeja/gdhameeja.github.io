'use strict';
// ============================================================================
//  3D terrain: height field, painted ground texture, water, scattered detail.
// ============================================================================

const WATER_Y = -0.1;

class Terrain3D {
  constructor(game, scene, quality) {
    this.g = game; this.scene = scene; this.q = quality;
    const n = this.n = game.n;
    this.N1 = n + 1;
    this.buildHeights();
    this.buildMesh();
    this.buildWater();
    this.buildDetail();
  }

  // ------------------------------------------------------------------ heights at tile corners
  buildHeights() {
    const g = this.g, n = this.n, N1 = this.N1, terr = g.terrain;
    const noise = makeNoise(((g.opts.seed || 7) % 99991) + 31);
    const isW = (x, y) => { if (x < 0 || y < 0 || x >= n || y >= n) return false; const t = terr[y * n + x]; return t === T.WATER; };
    const isS = (x, y) => { if (x < 0 || y < 0 || x >= n || y >= n) return false; const t = terr[y * n + x]; return t === T.SHALLOW || t === T.WATER; };
    // distance from each tile to land (for lake-bed depth)
    const dist = new Int16Array(n * n).fill(99), q = [];
    for (let i = 0; i < n * n; i++) { const t = terr[i]; if (t !== T.WATER && t !== T.SHALLOW) { dist[i] = 0; q.push(i); } }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % n, y = (c - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        if (dist[ni] > dist[c] + 1) { dist[ni] = dist[c] + 1; q.push(ni); }
      }
    }
    this.waterDist = dist;
    const H = this.H = new Float32Array(N1 * N1);
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
      // land always stays above the water line: a low base with rolling hills on top
      const hill = Math.max(0, noise(x / 16, y / 16, 3) - 0.38) / 0.62;
      let h = 0.1 + Math.pow(hill, 1.4) * 1.7 + noise(x / 5 + 40, y / 5 + 9, 2) * 0.12;
      // corners touching water sink into a lake bed
      let wd = 0, sh = false;
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const tx = x + dx, ty = y + dy;
        if (isS(tx, ty)) { sh = true; if (isW(tx, ty)) wd = Math.max(wd, dist[ty * n + tx]); }
      }
      if (sh) h = wd ? -0.3 - Math.min(wd, 6) * 0.09 : -0.2;
      else {
        // land next to water slopes down to the shore
        let near = 99;
        for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (isS(x + dx, y + dy)) near = Math.min(near, Math.max(Math.abs(dx + 0.5), Math.abs(dy + 0.5)));
        if (near < 3) h = Math.min(h, 0.05) * (near / 2.5) + 0.02;
      }
      H[y * N1 + x] = h;
    }
    // flatten under the starting buildings
    for (const b of g.buildings) this.flattenRect(b.tx, b.ty, b.w, b.h, false);
  }

  hAt(x, y) {
    const n = this.n, N1 = this.N1;
    x = clamp(x, 0, n - 0.001); y = clamp(y, 0, n - 0.001);
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const H = this.H;
    const a = H[yi * N1 + xi], b = H[yi * N1 + xi + 1], c = H[(yi + 1) * N1 + xi], d = H[(yi + 1) * N1 + xi + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // Level the ground under a building footprint (blends one tile outward)
  flattenRect(tx, ty, w, h, update = true) {
    const N1 = this.N1, n = this.n, H = this.H;
    let s = 0, k = 0;
    for (let y = ty; y <= ty + h; y++) for (let x = tx; x <= tx + w; x++) { s += H[y * N1 + x]; k++; }
    const avg = Math.max(0.02, s / k);
    for (let y = ty - 1; y <= ty + h + 1; y++) for (let x = tx - 1; x <= tx + w + 1; x++) {
      if (x < 0 || y < 0 || x > n || y > n) continue;
      const inside = x >= tx && x <= tx + w && y >= ty && y <= ty + h;
      H[y * N1 + x] = inside ? avg : (H[y * N1 + x] + avg) / 2;
    }
    if (update && this.geo) {
      const P = this.geo.attributes.position;
      for (let y = Math.max(0, ty - 1); y <= Math.min(n, ty + h + 1); y++) for (let x = Math.max(0, tx - 1); x <= Math.min(n, tx + w + 1); x++) P.setY(y * N1 + x, H[y * N1 + x]);
      P.needsUpdate = true;
      this.geo.computeVertexNormals();
    }
    return avg;
  }

  // ------------------------------------------------------------------ mesh + painted texture
  buildMesh() {
    const n = this.n, N1 = this.N1;
    const pos = new Float32Array(N1 * N1 * 3), uv = new Float32Array(N1 * N1 * 2);
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
      const i = y * N1 + x;
      pos[i * 3] = x; pos[i * 3 + 1] = this.H[i]; pos[i * 3 + 2] = y;
      uv[i * 2] = x / n; uv[i * 2 + 1] = y / n;
    }
    const idx = new Uint32Array(n * n * 6);
    let o = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = y * N1 + x, b = a + 1, c = a + N1, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const tex = this.paintTexture();
    const detail = this.detailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
    patchMaterial(mat, { clouds: true });
    // crisp close-up detail: modulate by a tiled high-frequency texture
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh) => {
      prev(sh);
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.detailRep = { value: n * 1.6 };
      sh.fragmentShader = 'uniform sampler2D detailMap;\nuniform float detailRep;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= 0.78 + 0.44 * texture2D(detailMap, vUv * detailRep).r;`);
    };
    mat.customProgramCacheKey = () => 'terrain';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    // dark skirt under the map edges
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(n * 3, n * 3), new THREE.MeshBasicMaterial({ color: 0x050403 }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(n / 2, -1.2, n / 2);
    this.scene.add(skirt);
  }

  detailTexture() {
    const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const nz = fbmTile(91, 8, 4);
    const img = ctx.createImageData(S, S);
    const r = mulberry32(5);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = nz(x / S * 8, y / S * 8) * 0.7 + r() * 0.3;
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(v * 255); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = canvasTex(c, { srgb: false, aniso: 8 });
    return t;
  }

  // Seamless top-down pattern for each terrain type
  patterns(P) {
    const S = 128, out = [];
    for (let t = 0; t < TERRAINS.length; t++) {
      const c = makeCanvas(S, S), ctx = c.getContext('2d');
      const T_ = TERRAINS[t], r = mulberry32(t * 131 + 7);
      ctx.fillStyle = T_.base[0]; ctx.fillRect(0, 0, S, S);
      const nz = fbmTile(t * 7 + 3, 4, 3);
      const img = ctx.getImageData(0, 0, S, S);
      const c1 = hexRgb(T_.base[1]), c2 = hexRgb(T_.base[2]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = nz(x / S * 4, y / S * 4), o = (y * S + x) * 4;
        const cc = v > 0.5 ? c1 : c2, k = Math.abs(v - 0.5) * 1.6;
        img.data[o] += (cc[0] - img.data[o]) * k; img.data[o + 1] += (cc[1] - img.data[o + 1]) * k; img.data[o + 2] += (cc[2] - img.data[o + 2]) * k;
      }
      ctx.putImageData(img, 0, 0);
      const sp = () => T_.speck[Math.floor(r() * T_.speck.length)];
      const dot = (n, w, h) => { for (let i = 0; i < n; i++) { const x = r() * S, y = r() * S; ctx.fillStyle = rgba(sp(), 0.6 + r() * 0.4); ctx.fillRect(x, y, w(), h()); ctx.fillRect(x - S, y, 1, 1); } };
      if (t === T.GRASS || t === T.LEAVES) dot(1400, () => 1, () => 1 + r() * 1.5);
      else if (t === T.DIRT) { dot(500, () => 1 + r(), () => 1); for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba('#b8a47c', 0.8); ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.8 + r(), 0, 6.3); ctx.fill(); } }
      else if (t === T.SAND) { dot(300, () => 1, () => 1); ctx.strokeStyle = 'rgba(160,130,80,0.25)'; for (let i = 0; i < 14; i++) { const y = r() * S; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(S * 0.3, y - 3, S * 0.6, y + 3, S, y); ctx.stroke(); } }
      else if (t === T.SNOW) dot(300, () => 1, () => 1);
      else if (t === T.ICE) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 12; i++) { const x = r() * S, y = r() * S; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10 + r() * 14, y + (r() - 0.5) * 10); ctx.stroke(); } }
      else dot(200, () => 1, () => 1);
      out.push(c);
    }
    return out;
  }

  paintTexture() {
    const g = this.g, n = this.n, terr = g.terrain;
    const P = this.P = n * this.q.texPx > 4096 ? Math.floor(4096 / n) : this.q.texPx;
    const W = n * P;
    const cv = makeCanvas(W, W), ctx = cv.getContext('2d');
    const pats = this.patterns(P);
    const S = 128;
    // base: each terrain's seamless pattern, anchored to the canvas so it is continuous across tiles
    const fills = pats.map(pc => ctx.createPattern(pc, 'repeat'));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      ctx.fillStyle = fills[terr[y * n + x]];
      ctx.fillRect(x * P, y * P, P, P);
    }
    // soft blending: higher-priority terrain bleeds over lower neighbours
    const stamps = pats.map((pc, t) => {
      const D = P * 2, c = makeCanvas(D, D), x = c.getContext('2d');
      x.drawImage(pc, 0, 0, D, D, 0, 0, D, D);
      x.globalCompositeOperation = 'destination-in';
      const gr = x.createRadialGradient(D / 2, D / 2, P * 0.3, D / 2, D / 2, D / 2);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, D, D);
      return c;
    });
    const order = [];
    for (let i = 0; i < n * n; i++) {
      const x = i % n, y = (i - x) / n, pr = TERRAINS[terr[i]].prio;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (TERRAINS[terr[ny * n + nx]].prio < pr) { order.push(i); break; }
      }
    }
    order.sort((a, b) => TERRAINS[terr[a]].prio - TERRAINS[terr[b]].prio);
    for (const i of order) { const x = i % n, y = (i - x) / n; ctx.drawImage(stamps[terr[i]], x * P - P / 2, y * P - P / 2); }
    // large-scale tonal variation
    const r = mulberry32(g.opts.seed || 3);
    for (let i = 0; i < n * n * 0.03; i++) {
      const x = r() * W, y = r() * W, rad = P * (3 + r() * 6);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.55;
      gr.addColorStop(0, dark ? 'rgba(20,30,0,0.12)' : 'rgba(255,250,210,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // under-water darkening, wet shore and foam
    const dist = this.waterDist;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, t = terr[i];
      if (t === T.WATER) { ctx.fillStyle = `rgba(8,24,40,${Math.min(0.75, 0.25 + dist[i] * 0.09)})`; ctx.fillRect(x * P, y * P, P, P); }
      else if (t === T.SHALLOW) { ctx.fillStyle = 'rgba(40,60,40,0.18)'; ctx.fillRect(x * P, y * P, P, P); }
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = terr[y * n + x];
      if (t === T.WATER || t === T.SHALLOW) continue;
      let wet = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < n && ny < n) { const tt = terr[ny * n + nx]; if (tt === T.WATER || tt === T.SHALLOW) wet = true; } }
      if (!wet) continue;
      const gr = ctx.createRadialGradient(x * P + P / 2, y * P + P / 2, 0, x * P + P / 2, y * P + P / 2, P);
      gr.addColorStop(0, 'rgba(60,45,25,0.3)'); gr.addColorStop(1, 'rgba(60,45,25,0)');
      ctx.fillStyle = gr; ctx.fillRect(x * P - P / 2, y * P - P / 2, P * 2, P * 2);
    }
    this.texCanvas = cv;
    const tex = canvasTex(cv, { repeat: false, aniso: 8 });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // ------------------------------------------------------------------ water
  buildWater() {
    const g = this.g, n = this.n;
    let any = false;
    for (let i = 0; i < n * n; i++) if (g.terrain[i] === T.WATER || g.terrain[i] === T.SHALLOW) { any = true; break; }
    if (!any) return;
    // procedural normal map from noise
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const nz = fbmTile(77, 8, 4);
    const hgt = (x, y) => nz(x / S * 8, y / S * 8);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 6, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1), o = (y * S + x) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const nm = canvasTex(c, { srgb: false });
    nm.repeat.set(n / 6, n / 6);
    const mat = new THREE.MeshStandardMaterial({ color: lin('#3a7aa0'), transparent: true, opacity: 0.74, roughness: 0.12, metalness: 0.25, normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55) });
    patchMaterial(mat, { clouds: true });
    this.waterNormals = nm;
    const geo = new THREE.PlaneGeometry(n, n, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set(n / 2, WATER_Y, n / 2);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  update(t) {
    if (this.waterNormals) { this.waterNormals.offset.set(t * 0.012, t * 0.008); }
  }

  // ------------------------------------------------------------------ scattered 3D detail (static)
  buildDetail() {
    const g = this.g, n = this.n, terr = g.terrain;
    const dens = this.q.detail;
    if (!dens) return;
    // geometries
    const tuft = (() => {
      const mb = []; const geo = new THREE.BufferGeometry(); const v = [];
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * Math.PI * 2, r = 0.05, lean = 0.06;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const px = -Math.sin(a) * 0.022, pz = Math.cos(a) * 0.022;
        v.push(x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(a) * lean, 0.16 + (k % 2) * 0.05, z + Math.sin(a) * lean);
      }
      void mb;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.computeVertexNormals();
      return geo;
    })();
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    patchMaterial(grassMat, { clouds: true, wind: 0.25 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    patchMaterial(rockMat, { clouds: true });
    const flowerGeo = new THREE.IcosahedronGeometry(0.03, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    patchMaterial(flowerMat, {});
    const CHK = this.detailCHK = 20;
    const nc = Math.ceil(n / CHK);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    this.detail = [];
    for (let cy = 0; cy < nc; cy++) for (let cx = 0; cx < nc; cx++) {
      const grass = [], rocks = [], flowers = [];
      for (let y = cy * CHK; y < Math.min(n, cy * CHK + CHK); y++) for (let x = cx * CHK; x < Math.min(n, cx * CHK + CHK); x++) {
        const i = y * n + x, t = terr[i];
        if (g.occ[i]) {
          const e = g.ents.get(g.occ[i]);
          if (e && e.kind === 'building') continue;
        }
        const h = hash2(x, y, 41);
        const cnt = t === T.GRASS ? 1.6 : t === T.LEAVES ? 1.2 : t === T.DIRT ? 0.35 : t === T.SAND ? 0.25 : t === T.SNOW ? 0.2 : 0;
        const k = Math.floor(cnt * dens + hash2(x, y, 42));
        for (let j = 0; j < k; j++) {
          const px = x + hash2(x, y, 50 + j), py = y + hash2(x, y, 60 + j);
          const s = 0.7 + hash2(x, y, 70 + j) * 0.8;
          m.makeRotationY(hash2(x, y, 80 + j) * 6.28).scale(_v3.set(s, s * (t === T.SAND ? 0.8 : 1), s)).setPosition(px, this.hAt(px, py), py);
          const gc = t === T.GRASS ? ['#4f8a2a', '#5f9a34', '#3f7422', '#6aa63a'] : t === T.LEAVES ? ['#3e5e22', '#4a6a28', '#5a4a24'] : t === T.SAND ? ['#9a9440', '#8a8a3a'] : t === T.SNOW ? ['#8a8a6a'] : ['#6e8a34', '#7a7a3a'];
          grass.push([m.clone(), lin(gc[Math.floor(hash2(x, y, 90 + j) * gc.length)])]);
        }
        if (t !== T.WATER && t !== T.SHALLOW && t !== T.ICE && h < 0.05 * dens) {
          const s = 0.06 + hash2(x, y, 43) * 0.1, px = x + 0.2 + hash2(x, y, 44) * 0.6, py = y + 0.2 + hash2(x, y, 45) * 0.6;
          m.makeRotationFromEuler(_e.set(h * 40, h * 90, h * 70)).scale(_v3.set(s * 1.3, s, s)).setPosition(px, this.hAt(px, py) + s * 0.3, py);
          rocks.push([m.clone(), lin(t === T.SAND ? '#c4ae84' : t === T.SNOW ? '#8a8884' : '#8f8a80')]);
        }
        if (t === T.GRASS && hash2(x, y, 46) < 0.06 * dens) {
          const fc = ['#f2e660', '#f6f6f6', '#d878c8', '#e8653c', '#8aa8f0'][Math.floor(hash2(x, y, 47) * 5)];
          for (let j = 0; j < 5; j++) {
            const px = x + 0.5 + (hash2(x, y, 100 + j) - 0.5) * 0.7, py = y + 0.5 + (hash2(x, y, 110 + j) - 0.5) * 0.7;
            m.makeTranslation(px, this.hAt(px, py) + 0.1, py);
            flowers.push([m.clone(), lin(fc)]);
          }
        }
      }
      const mk = (geo, mat, list, shadow) => {
        if (!list.length) return;
        // shared geometry; the renderer shows only chunks inside the view (see showDetail)
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.frustumCulled = false;
        list.forEach(([mm, cc], k) => { im.setMatrixAt(k, mm); im.setColorAt(k, cc); });
        im.castShadow = shadow; im.receiveShadow = true;
        this.scene.add(im);
        this.detail.push({ mesh: im, cx, cy });
      };
      mk(tuft, grassMat, grass, false);
      mk(GEO.ico, rockMat, rocks, true);
      mk(flowerGeo, flowerMat, flowers, false);
    }
  }

  showDetail(view) {
    if (!this.detail) return;
    const C = this.detailCHK;
    for (const d of this.detail) d.mesh.visible = !(d.cx * C > view.x1 || (d.cx + 1) * C < view.x0 || d.cy * C > view.y1 || (d.cy + 1) * C < view.y0);
  }

  // hide detail on tiles that become occupied by buildings (called on placement)
  clearDetailAt(tx, ty, w, h) {
    if (!this.detail) return;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const d of this.detail) {
      const C = this.detailCHK;
      if (d.cx * C > tx + w + 1 || (d.cx + 1) * C < tx - 1 || d.cy * C > ty + h + 1 || (d.cy + 1) * C < ty - 1) continue;
      const im = d.mesh;
      let ch = false;
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, m); p.setFromMatrixPosition(m);
        if (p.x >= tx - 0.1 && p.x <= tx + w + 0.1 && p.z >= ty - 0.1 && p.z <= ty + h + 0.1) { im.setMatrixAt(k, zero); ch = true; }
      }
      if (ch) im.instanceMatrix.needsUpdate = true;
    }
  }
}
