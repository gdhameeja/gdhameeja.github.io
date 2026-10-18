'use strict';
// ============================================================================
//  A* pathfinding on the tile grid (8-neighbour, no corner cutting) with
//  "reach within r of a rectangle" goals and string-pulling smoothing.
// ============================================================================

const SQRT2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

class Pathfinder {
  constructor(game) {
    this.game = game;
    const n = game.n, nn = n * n;
    this.n = n;
    this.g = new Float32Array(nn);
    this.f = new Float32Array(nn);
    this.parent = new Int32Array(nn);
    this.stamp = new Uint32Array(nn);
    this.closed = new Uint32Array(nn);
    this.gen = 0;
    this.heap = new MinHeap(nn * 8);
    this.heap.key = this.f;
    this.expanded = 0;
  }

  // Passability of a tile for a given player (gates are open to allies)
  passable(i, owner) {
    const b = this.game.block[i];
    if (b === 0) return true;
    if (b === 2) {
      const e = this.game.ents.get(this.game.occ[i]);
      return !!e && owner > 0 && this.game.players[owner].isAlly(e.owner);
    }
    return false;
  }

  // goal: {x0,y0,x1,y1,r}. Returns {pts:Float32Array of waypoints, reached}
  find(sx, sy, goal, owner, maxNodes = 30000) {
    const n = this.n;
    const gen = ++this.gen;
    if (this.gen > 4e9) { this.gen = 1; this.stamp.fill(0); this.closed.fill(0); }
    const g = this.g, f = this.f, parent = this.parent, stamp = this.stamp, closed = this.closed, heap = this.heap;
    const block = this.game.block;
    heap.clear();
    const stx = clamp(Math.floor(sx), 0, n - 1), sty = clamp(Math.floor(sy), 0, n - 1);
    const start = sty * n + stx;
    const x0 = goal.x0, y0 = goal.y0, x1 = goal.x1, y1 = goal.y1, r = goal.r, r2 = r * r;
    // gate tiles are resolved lazily; everything else is a plain array lookup
    const pass = (i) => { const b = block[i]; return b === 0 || (b === 2 && this.passable(i, owner)); };
    const hOf = (tx, ty) => {
      const cx = tx + 0.5, cy = ty + 0.5;
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
      const d = dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx;
      return d > r ? d - r : 0;
    };
    g[start] = 0; f[start] = hOf(stx, sty); stamp[start] = gen; parent[start] = -1;
    heap.push(start);
    let best = start, bestH = f[start], found = -1, exp = 0;
    while (heap.n > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % n, cy = (cur - cx) / n;
      // goal test: tile centre within r of the rectangle
      {
        const px = cx + 0.5, py = cy + 0.5;
        const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
        const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
        if (dx * dx + dy * dy <= r2) { found = cur; break; }
      }
      if (++exp > maxNodes) break;
      const gc = g[cur];
      const hc = f[cur] - gc;
      if (hc < bestH || (hc === bestH && gc < g[best])) { bestH = hc; best = cur; }
      const pE = cx < n - 1 && pass(cur + 1), pW = cx > 0 && pass(cur - 1);
      const pS = cy < n - 1 && pass(cur + n), pN = cy > 0 && pass(cur - n);
      for (let d = 0; d < 8; d++) {
        let ni, cost;
        switch (d) {
          case 0: if (!pE) continue; ni = cur + 1; cost = 1; break;
          case 1: if (!pW) continue; ni = cur - 1; cost = 1; break;
          case 2: if (!pS) continue; ni = cur + n; cost = 1; break;
          case 3: if (!pN) continue; ni = cur - n; cost = 1; break;
          case 4: if (!pE || !pS || !pass(cur + n + 1)) continue; ni = cur + n + 1; cost = SQRT2; break;
          case 5: if (!pE || !pN || !pass(cur - n + 1)) continue; ni = cur - n + 1; cost = SQRT2; break;
          case 6: if (!pW || !pS || !pass(cur + n - 1)) continue; ni = cur + n - 1; cost = SQRT2; break;
          default: if (!pW || !pN || !pass(cur - n - 1)) continue; ni = cur - n - 1; cost = SQRT2;
        }
        if (closed[ni] === gen) continue;
        const ng = gc + cost;
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen; g[ni] = ng; parent[ni] = cur;
          const nx = ni % n;
          f[ni] = ng + hOf(nx, (ni - nx) / n);
          heap.push(ni);
        }
      }
    }
    this.expanded += exp;
    const end = found >= 0 ? found : best;
    // reconstruct
    const tiles = [];
    for (let c = end; c !== -1 && c !== start; c = parent[c]) tiles.push(c);
    tiles.reverse();
    const raw = [sx, sy];
    for (const t of tiles) raw.push((t % n) + 0.5, Math.floor(t / n) + 0.5);
    return { pts: this.smooth(raw, owner), reached: found >= 0 };
  }

  // Can a unit walk straight from a to b?
  lineWalkable(ax, ay, bx, by, owner) {
    const n = this.n;
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 0.2);
    const o = 0.22;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      for (let k = 0; k < 4; k++) {
        const px = x + (k & 1 ? o : -o), py = y + (k & 2 ? o : -o);
        const tx = Math.floor(px), ty = Math.floor(py);
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) return false;
        if (!this.passable(ty * n + tx, owner)) {
          // allow leaving the start tile even if blocked
          if (Math.floor(ax) === tx && Math.floor(ay) === ty) continue;
          return false;
        }
      }
    }
    return true;
  }

  // String-pulling: keep only waypoints needed to avoid obstacles
  smooth(raw, owner) {
    const cnt = raw.length / 2;
    if (cnt <= 2) return Float32Array.from(raw.slice(2));
    const out = [];
    let i = 0;
    while (i < cnt - 1) {
      let j = Math.min(cnt - 1, i + 14);
      while (j > i + 1 && !this.lineWalkable(raw[i * 2], raw[i * 2 + 1], raw[j * 2], raw[j * 2 + 1], owner)) j--;
      out.push(raw[j * 2], raw[j * 2 + 1]);
      i = j;
    }
    return Float32Array.from(out);
  }
}
