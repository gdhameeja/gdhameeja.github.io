'use strict';
// ============================================================================
//  Small utilities: seeded RNG, value noise, min-heap, geometry helpers.
// ============================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic hash of integer coordinates -> [0,1)
function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise with fractal octaves
function makeNoise(seed) {
  const smooth = t => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, oct = 4) {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += vnoise(x * f, y * f) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };
}

// Binary min-heap of integer ids keyed by an external Float32Array
class MinHeap {
  constructor(cap) { this.a = new Int32Array(cap); this.n = 0; this.key = null; }
  clear() { this.n = 0; }
  push(id) {
    const a = this.a, k = this.key;
    let i = this.n++;
    a[i] = id;
    const kv = k[id];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[a[p]] <= kv) break;
      a[i] = a[p]; a[p] = id; i = p;
    }
  }
  pop() {
    const a = this.a, k = this.key;
    const top = a[0];
    const last = a[--this.n];
    if (this.n > 0) {
      let i = 0;
      const kv = k[last];
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mv = kv;
        if (l < this.n && k[a[l]] < mv) { m = l; mv = k[a[l]]; }
        if (r < this.n && k[a[r]] < mv) { m = r; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Distance from a point to an axis-aligned rectangle [x0,x1]x[y0,y1]
function distToRect(px, py, x0, y0, x1, y1) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

function costStr(cost) {
  return RES.filter(r => cost[r]).map(r => `${cost[r]} ${r}`).join(', ');
}

function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
}

function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Precomputed disc offsets for line-of-sight stamping, keyed by radius
const DISC_CACHE = [];
function discOffsets(r) {
  r = Math.max(1, Math.min(24, Math.round(r)));
  if (DISC_CACHE[r]) return DISC_CACHE[r];
  const out = [];
  const r2 = (r + 0.5) * (r + 0.5);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2) out.push(dx, dy);
  return (DISC_CACHE[r] = new Int16Array(out));
}

// Offsets of the square ring at Chebyshev distance r (cached)
const RING_CACHE = [];
function ringOffsets(r) {
  if (RING_CACHE[r]) return RING_CACHE[r];
  const out = [];
  if (r === 0) out.push(0, 0);
  else {
    for (let d = -r; d <= r; d++) out.push(d, -r, d, r);
    for (let d = -r + 1; d <= r - 1; d++) out.push(-r, d, r, d);
  }
  return (RING_CACHE[r] = new Int16Array(out));
}
