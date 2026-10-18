'use strict';
// ============================================================================
//  3D core: colour helpers, procedural textures, shared materials (with fog of
//  war / cloud shadow / wind shader patches), geometry builders and merging.
//  World space: X = tile x, Z = tile y, Y = up. One tile = one unit.
// ============================================================================

const R3 = {};

// sRGB hex -> linear THREE.Color
const LIN_CACHE = new Map();
function lin(hex) {
  let c = LIN_CACHE.get(hex);
  if (!c) { c = new THREE.Color(hex).convertSRGBToLinear(); LIN_CACHE.set(hex, c); }
  return c;
}

// --------------------------------------------------------------------------- shared uniforms
R3.uniforms = {
  fogMap: { value: null },
  mapSize: { value: 100 },
  fogOn: { value: 1 },
  time: { value: 0 },
  cloudMap: { value: null },
  cloudAmt: { value: 0.22 },
};

// Patch a standard material: fog of war darkening, optional cloud shadows and wind sway
function patchMaterial(mat, { clouds = false, wind = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.fogMap = R3.uniforms.fogMap;
    sh.uniforms.mapSize = R3.uniforms.mapSize;
    sh.uniforms.fogOn = R3.uniforms.fogOn;
    sh.uniforms.time = R3.uniforms.time;
    sh.uniforms.cloudMap = R3.uniforms.cloudMap;
    sh.uniforms.cloudAmt = R3.uniforms.cloudAmt;
    sh.vertexShader = 'varying vec3 vWPos;\nuniform float time;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${wind ? `
  {
    vec2 ip = vec2(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xz;
    #endif
    float sway = max(0.0, position.y - 0.25) * ${wind.toFixed(3)};
    transformed.x += sin(time * 1.6 + ip.x * 0.7 + ip.y * 0.3) * sway;
    transformed.z += cos(time * 1.3 + ip.y * 0.6) * sway * 0.6;
  }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 wp4 = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp4 = instanceMatrix * wp4;
    #endif
    vWPos = (modelMatrix * wp4).xyz;
  }`);
    sh.fragmentShader = 'varying vec3 vWPos;\nuniform sampler2D fogMap;\nuniform float mapSize;\nuniform float fogOn;\nuniform float time;\nuniform sampler2D cloudMap;\nuniform float cloudAmt;\n' + sh.fragmentShader
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
${clouds ? `
  {
    float cl = texture2D(cloudMap, vWPos.xz / 56.0 + vec2(time * 0.0045, time * 0.0028)).r;
    gl_FragColor.rgb *= 1.0 - cloudAmt * smoothstep(0.42, 0.78, cl);
  }` : ''}
  {
    float fa = texture2D(fogMap, vWPos.xz / mapSize).a;
    gl_FragColor.rgb *= 1.0 - fa * fogOn;
  }`);
  };
  mat.customProgramCacheKey = () => `aoc|${clouds}|${wind}`;
  return mat;
}

// --------------------------------------------------------------------------- tileable noise & textures
function tileNoise(seed, period) {
  const h = (x, y) => hash2(((x % period) + period) % period, ((y % period) + period) % period, seed);
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbmTile(seed, period, oct = 4) {
  const ns = [];
  for (let o = 0; o < oct; o++) ns.push(tileNoise(seed + o * 17, period << o));
  return (x, y) => { let s = 0, a = 1, f = 1, norm = 0; for (let o = 0; o < oct; o++) { s += ns[o](x * f, y * f) * a; norm += a; a *= 0.5; f *= 2; } return s / norm; };
}

function canvasTex(c, { repeat = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = aniso;
  return t;
}

// Greyscale-ish surface textures; actual colour comes from vertex colours.
const TEXGEN = {
  stone(ctx, S, r) {
    ctx.fillStyle = '#d8d6d0'; ctx.fillRect(0, 0, S, S);
    const rows = 8, rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -rh * 0.8 : 0;
      while (x < S) {
        const w = rh * (1.3 + r() * 1.2);
        const l = 200 + Math.floor(r() * 50);
        ctx.fillStyle = `rgb(${l},${l - 4},${l - 10})`;
        ctx.fillRect(x + 1, row * rh + 1, w - 2, rh - 2);
        // also wrap horizontally
        if (x + w > S) ctx.fillRect(x - S + 1, row * rh + 1, w - 2, rh - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, row * rh + 1, w - 2, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(x + 1, row * rh + rh - 3, w - 2, 2);
        x += w;
      }
    }
    speckle(ctx, S, r, 900, 0.08);
  },
  plaster(ctx, S, r) {
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(0, 0, S, S);
    const n = fbmTile(11, 8);
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = (n(x / S * 8, y / S * 8) - 0.5) * 28; const o = (y * S + x) * 4; img.data[o] += v; img.data[o + 1] += v; img.data[o + 2] += v; }
    ctx.putImageData(img, 0, 0);
    speckle(ctx, S, r, 500, 0.05);
  },
  planks(ctx, S, r) {
    const n = 6, pw = S / n;
    for (let i = 0; i < n; i++) {
      const l = 190 + Math.floor(r() * 50);
      ctx.fillStyle = `rgb(${l},${l - 8},${l - 20})`; ctx.fillRect(i * pw, 0, pw, S);
      ctx.strokeStyle = 'rgba(60,40,20,0.25)'; ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) { const x = i * pw + r() * pw; ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 3, S * 0.3, x - 3, S * 0.6, x + 1, S); ctx.stroke(); }
      ctx.fillStyle = 'rgba(40,25,10,0.55)'; ctx.fillRect(i * pw, 0, 2, S);
      const ky = r() * S; ctx.fillStyle = 'rgba(60,35,15,0.4)'; ctx.beginPath(); ctx.ellipse(i * pw + pw / 2, ky, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
    }
  },
  tiles(ctx, S, r) {
    ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, S, S);
    const rows = 10, rh = S / rows, cw = S / 8;
    for (let row = 0; row < rows; row++) {
      for (let k = -1; k <= 8; k++) {
        const x = k * cw + (row % 2 ? cw / 2 : 0), y = row * rh;
        const l = 190 + Math.floor(r() * 55);
        const g = ctx.createLinearGradient(0, y, 0, y + rh);
        g.addColorStop(0, `rgb(${l - 50},${l - 50},${l - 50})`); g.addColorStop(0.35, `rgb(${l},${l},${l})`); g.addColorStop(1, `rgb(${l - 25},${l - 25},${l - 25})`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + cw - 1, y); ctx.lineTo(x + cw - 1, y + rh * 0.8); ctx.quadraticCurveTo(x + cw / 2, y + rh * 1.15, x + 1, y + rh * 0.8); ctx.closePath(); ctx.fill();
      }
    }
  },
  thatch(ctx, S, r) {
    ctx.fillStyle = '#c8b27a'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1600; i++) { const x = r() * S, y = r() * S, l = 150 + r() * 90; ctx.strokeStyle = `rgba(${l},${l * 0.85},${l * 0.5},0.7)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 2, y + 6 + r() * 6); ctx.stroke(); }
  },
  felt(ctx, S, r) {
    ctx.fillStyle = '#efe9da'; ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, r, 2500, 0.06);
    ctx.strokeStyle = 'rgba(120,100,70,0.18)'; ctx.lineWidth = 1;
    for (let y = 0; y < S; y += S / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
  },
  cloth(ctx, S, r) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < S; i += 3) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
  },
  rough(ctx, S, r) {
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(0, 0, S, S);
    const n = fbmTile(23, 8, 5);
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = (n(x / S * 8, y / S * 8) - 0.5) * 70; const o = (y * S + x) * 4; img.data[o] += v; img.data[o + 1] += v; img.data[o + 2] += v; }
    ctx.putImageData(img, 0, 0);
  },
};
function speckle(ctx, S, r, n, a) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`; ctx.fillRect(r() * S, r() * S, 1 + r(), 1 + r()); }
}

R3.tex = {};
function makeSurfaceTex(name) {
  if (R3.tex[name]) return R3.tex[name];
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  TEXGEN[name](ctx, S, mulberry32(name.length * 977));
  return (R3.tex[name] = canvasTex(c));
}

// --------------------------------------------------------------------------- materials
R3.mats = {};
// world-scale texture repeat: UVs are generated in world units by the merger, so `scale` sets texels per unit
const MAT_DEFS = {
  stone:   { tex: 'stone', rough: 0.92, scale: 0.55 },
  plaster: { tex: 'plaster', rough: 0.95, scale: 0.6 },
  wood:    { tex: 'planks', rough: 0.85, scale: 0.7 },
  tiles:   { tex: 'tiles', rough: 0.75, scale: 0.8 },
  thatch:  { tex: 'thatch', rough: 1, scale: 0.7 },
  felt:    { tex: 'felt', rough: 1, scale: 0.6 },
  cloth:   { tex: 'cloth', rough: 0.9, scale: 1.5, side: 2 },
  canvas:  { tex: 'cloth', rough: 0.9, scale: 1.5, side: 2 },
  metal:   { rough: 0.35, metal: 0.7 },
  gold:    { rough: 0.3, metal: 0.9 },
  plain:   { rough: 0.9 },
  dark:    { rough: 1 },
  rock:    { tex: 'rough', rough: 0.95, scale: 0.9, flat: true },
  foliage: { rough: 0.85, flat: true, wind: 0.035 },
  bark:    { tex: 'planks', rough: 0.95, scale: 1.2 },
  glow:    { rough: 1, emissive: true },
};
function getMat(key) {
  if (R3.mats[key]) return R3.mats[key];
  const d = MAT_DEFS[key] || MAT_DEFS.plain;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: d.rough, metalness: d.metal || 0,
    flatShading: !!d.flat, side: d.side || 0,
  });
  if (d.tex) m.map = makeSurfaceTex(d.tex);
  if (d.emissive) { m.emissive = new THREE.Color(0xff8a2a); m.emissiveIntensity = 0.9; }
  patchMaterial(m, { clouds: true, wind: d.wind || 0 });
  m.userData.scale = d.scale || 1;
  return (R3.mats[key] = m);
}
// unit materials: colour comes from instanceColor (no vertex colours)
function getUnitMat(key) {
  const k = 'u_' + key;
  if (R3.mats[k]) return R3.mats[k];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: key === 'metal' ? 0.35 : 0.8, metalness: key === 'metal' ? 0.6 : 0, flatShading: true });
  patchMaterial(m, { clouds: true });
  return (R3.mats[k] = m);
}

// --------------------------------------------------------------------------- model building
// A ModelBuilder collects primitives (geometry + matrix + colour + material key) and
// merges them into one geometry per material, with world-scaled UVs.
// scratch objects, created in initGeo() so this file loads even without THREE
let _m4, _q, _v3, _s3, _e, _n3, _pa, _na, WHITE;
function mtx(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v3.set(x, y, z), _q, _s3.set(sx, sy, sz));
}

class ModelBuilder {
  constructor() { this.items = []; }
  add(mat, geom, matrix, color) { this.items.push({ mat, geom, matrix, color: typeof color === 'string' ? lin(color) : color }); return this; }
  // convenience primitives (positions are the CENTER for boxes, BASE for vertical shapes)
  box(mat, color, x, y, z, w, h, d, ry = 0) { return this.add(mat, GEO.box, mtx(x, y + h / 2, z, 0, ry, 0, w, h, d), color); }
  boxR(mat, color, x, y, z, w, h, d, rx, ry, rz) { return this.add(mat, GEO.box, mtx(x, y, z, rx, ry, rz, w, h, d), color); }
  cyl(mat, color, x, y, z, rTop, rBot, h, seg = 12) { return this.add(mat, cylGeo(rTop / Math.max(rBot, 1e-3), seg), mtx(x, y + h / 2, z, 0, 0, 0, rBot, h, rBot), color); }
  cone(mat, color, x, y, z, r, h, seg = 12, ry = 0) { return this.add(mat, coneGeo(seg), mtx(x, y + h / 2, z, 0, ry, 0, r, h, r), color); }
  dome(mat, color, x, y, z, r, h) { return this.add(mat, GEO.dome, mtx(x, y, z, 0, 0, 0, r, h, r), color); }
  sphere(mat, color, x, y, z, rx, ry, rz) { return this.add(mat, GEO.sphere, mtx(x, y, z, 0, 0, 0, rx, ry, rz), color); }
  ico(mat, color, x, y, z, s, rot = 0) { return this.add(mat, GEO.ico, mtx(x, y, z, rot, rot * 1.7, rot * 0.6, s, s * 0.85, s), color); }
  // gable roof: ridge along local X (axis='x') or Z
  gable(mat, color, cx, y, cz, len, width, h, axis = 'x', ov = 0.08) {
    const ry = axis === 'x' ? 0 : Math.PI / 2;
    return this.add(mat, GEO.prism, mtx(cx, y, cz, 0, ry, 0, len + ov * 2, h, width + ov * 2), color);
  }
  hip(mat, color, cx, y, cz, w, d, h, ov = 0.08) { return this.add(mat, GEO.pyramid, mtx(cx, y, cz, 0, 0, 0, w + ov * 2, h, d + ov * 2), color); }

  build() {
    const groups = new Map();
    for (const it of this.items) { if (!groups.has(it.mat)) groups.set(it.mat, []); groups.get(it.mat).push(it); }
    const out = [];
    for (const [mat, items] of groups) out.push({ mat, geometry: mergeItems(items, getMat(mat).userData.scale || 1) });
    return out;
  }
}

// Merge transformed geometries into one non-indexed geometry with colours and world-projected UVs
function mergeItems(items, uvScale) {
  let total = 0;
  for (const it of items) total += (it.geom.index ? it.geom.index.count : it.geom.attributes.position.count);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const it of items) {
    const g = it.geom, P = g.attributes.position, N = g.attributes.normal, I = g.index;
    _n3.getNormalMatrix(it.matrix);
    const cnt = I ? I.count : P.count;
    const c = it.color;
    for (let k = 0; k < cnt; k++) {
      const i = I ? I.getX(k) : k;
      _pa.fromBufferAttribute(P, i).applyMatrix4(it.matrix);
      _na.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize();
      pos[o * 3] = _pa.x; pos[o * 3 + 1] = _pa.y; pos[o * 3 + 2] = _pa.z;
      nor[o * 3] = _na.x; nor[o * 3 + 1] = _na.y; nor[o * 3 + 2] = _na.z;
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      // triplanar-style projection by dominant normal axis, in world units
      const ax = Math.abs(_na.x), ay = Math.abs(_na.y), az = Math.abs(_na.z);
      let u, v;
      if (ay >= ax && ay >= az) { u = _pa.x; v = _pa.z; }
      else if (ax >= az) { u = _pa.z; v = -_pa.y; }
      else { u = _pa.x; v = -_pa.y; }
      uv[o * 2] = u * uvScale; uv[o * 2 + 1] = v * uvScale;
      o++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// --------------------------------------------------------------------------- unit primitives
const GEO = {};
function initGeo() {
  if (GEO.box) return;
  _m4 = new THREE.Matrix4(); _q = new THREE.Quaternion(); _v3 = new THREE.Vector3(); _s3 = new THREE.Vector3(); _e = new THREE.Euler();
  _n3 = new THREE.Matrix3(); _pa = new THREE.Vector3(); _na = new THREE.Vector3();
  WHITE = new THREE.Color(1, 1, 1);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.sphere = new THREE.SphereGeometry(1, 12, 8);
  GEO.ico = new THREE.IcosahedronGeometry(1, 0);
  GEO.ico1 = new THREE.IcosahedronGeometry(1, 1);
  GEO.dome = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  // triangular prism: base 1x1 (x by z) at y=0, ridge along x at y=1
  {
    const g = new THREE.BufferGeometry();
    const v = [
      // two slopes
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
      0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
      // gable ends
      0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
      -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    GEO.prism = g;
  }
  // square pyramid base 1x1 at y=0, apex y=1
  {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true);
    g.rotateY(Math.PI / 4);
    g.translate(0, 0.5, 0);
    g.computeVertexNormals();
    GEO.pyramid = g.toNonIndexed(); GEO.pyramid.computeVertexNormals();
  }
}
const CYL_CACHE = new Map();
function cylGeo(ratio, seg) {
  const k = ratio.toFixed(3) + '|' + seg;
  let g = CYL_CACHE.get(k);
  if (!g) { g = new THREE.CylinderGeometry(ratio, 1, 1, seg); CYL_CACHE.set(k, g); }
  return g;
}
const CONE_CACHE = new Map();
function coneGeo(seg) {
  let g = CONE_CACHE.get(seg);
  if (!g) { g = new THREE.ConeGeometry(1, 1, seg); CONE_CACHE.set(seg, g); }
  return g;
}

// --------------------------------------------------------------------------- instanced batches
// A Batch draws many copies of one geometry+material; filled from scratch every frame.
class Batch {
  constructor(scene, geometry, material, { shadow = true, receive = true, cap = 64 } = {}) {
    this.scene = scene; this.geometry = geometry; this.material = material;
    this.shadow = shadow; this.receive = receive;
    this.n = 0;
    this.make(cap);
  }
  make(cap) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose && this.mesh.dispose(); }
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = this.shadow; this.mesh.receiveShadow = this.receive;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }
  push(m, c) {
    if (this.n >= this.cap) {
      const old = this.mesh, oldN = this.n;
      const arr = old.instanceMatrix.array.slice(0, oldN * 16), carr = old.instanceColor.array.slice(0, oldN * 3);
      this.make(this.cap * 2);
      this.mesh.instanceMatrix.array.set(arr); this.mesh.instanceColor.array.set(carr);
    }
    m.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    const ca = this.mesh.instanceColor.array, o = this.n * 3;
    ca[o] = c.r; ca[o + 1] = c.g; ca[o + 2] = c.b;
    this.n++;
  }
  flush() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.n = 0;
  }
}
