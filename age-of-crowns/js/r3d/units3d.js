'use strict';
// ============================================================================
//  3D unit rigs drawn with instanced batches. Poses come from the same
//  animation tables as the 2D sprites (humanPose / WORK_POSES), interpolated
//  between frames for smooth motion. Body frame: forward = +X, up = +Y.
// ============================================================================

const UK = 0.034;          // 2D sprite pixels -> world units
const UGEO = {};
function initUnitGeo() {
  if (UGEO.limb) return;
  const down = g => { g.translate(0, -0.5, 0); return g; };
  const up = g => { g.translate(0, 0.5, 0); return g; };
  UGEO.limb = down(new THREE.CylinderGeometry(1, 0.85, 1, 6));
  UGEO.boxD = down(new THREE.BoxGeometry(1, 1, 1));
  UGEO.boxU = up(new THREE.BoxGeometry(1, 1, 1));
  UGEO.box = new THREE.BoxGeometry(1, 1, 1);
  UGEO.sphere = new THREE.SphereGeometry(1, 8, 6);
  UGEO.ico = new THREE.IcosahedronGeometry(1, 0);
  UGEO.hemi = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  UGEO.cone = up(new THREE.ConeGeometry(1, 1, 8));
  UGEO.cyl = up(new THREE.CylinderGeometry(1, 1, 1, 8));
  UGEO.torso = up(new THREE.CylinderGeometry(0.8, 1, 1, 7));
  UGEO.skirt = down(new THREE.CylinderGeometry(0.85, 1, 1, 8));
  UGEO.disc = new THREE.CylinderGeometry(1, 1, 1, 12);
  UGEO.bow = new THREE.TorusGeometry(1, 0.05, 4, 12, Math.PI);
  UGEO.ring = (() => { const g = new THREE.RingGeometry(0.82, 1, 28); g.rotateX(-Math.PI / 2); return g; })();
  UGEO.ringThin = (() => { const g = new THREE.RingGeometry(0.95, 1, 48); g.rotateX(-Math.PI / 2); return g; })();
  UGEO.blood = (() => { const g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); return g; })();
}

const UCOL = {};
function ucol(hex) { let c = UCOL[hex]; if (!c) c = UCOL[hex] = lin(hex); return c; }
const HORSE3 = { bay: ['#7b4a26', '#4f2e15'], grey: ['#a9a8a0', '#76746c'], white: ['#e9e5dc', '#b9b4a8'], black: ['#33291f', '#1c1611'], dun: ['#b48c56', '#7e5e33'] };

class UnitRenderer {
  constructor(scene, shadows) {
    initUnitGeo();
    this.scene = scene; this.shadows = shadows;
    this.batches = new Map();
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    // scratch
    this.root = new THREE.Matrix4(); this.m = new THREE.Matrix4(); this.l = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }
  batch(geo, mat) {
    const k = geo + '|' + mat;
    let b = this.batches.get(k);
    if (!b) {
      const material = mat === 'ring' ? this.ringMat : mat === 'blood' ? this.bloodMat : getUnitMat(mat === 'metal' ? 'metal' : 'matte');
      b = new Batch(this.scene, UGEO[geo], material, { shadow: this.shadows && mat !== 'ring' && mat !== 'blood', receive: mat !== 'ring' });
      if (mat === 'ring' || mat === 'blood') b.mesh.renderOrder = 2;
      this.batches.set(k, b);
    }
    return b;
  }
  flush() { for (const b of this.batches.values()) b.flush(); }

  // part relative to a parent matrix
  P(parent, geo, mat, col, x, y, z, rx, ry, rz, sx, sy, sz) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.l.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.m.multiplyMatrices(parent, this.l);
    this.batch(geo, mat).push(this.m, typeof col === 'string' ? ucol(col) : col);
  }
  // a frame (no scale) relative to parent, written into `out`
  F(out, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.l.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
    return out.multiplyMatrices(parent, this.l);
  }

  ring(x, y, z, r, col, thin = false) {
    this.l.makeScale(r, 1, r).setPosition(x, y + 0.03, z);
    this.batch(thin ? 'ringThin' : 'ring', 'ring').push(this.l, col);
  }
  blood(x, y, z, r) {
    this.l.makeScale(r, 1, r).setPosition(x, y + 0.02, z);
    this.batch('blood', 'blood').push(this.l, ucol('#6a0a0a'));
  }

  // ------------------------------------------------------------------ entry point
  // u: unit (or corpse-like object), pos: [x, h, z], heading (radians), info: {act, ft, dead, sink}
  draw(u, wx, wy, wz, heading, act, ft, col, opts = {}) {
    const spr = UNITS[u.type].sprite, body = spr.body;
    const root = this.root;
    this.e.set(0, -heading, 0); this.q.setFromEuler(this.e);
    root.compose(this.v.set(wx, wy - (opts.sink || 0), wz), this.q, this.s.set(1, 1, 1));
    if (opts.dead) {
      // lie on the side
      this.F(root, root.clone(), 0, 0.05, 0, Math.PI / 2 * 0.95, 0, 0);
    }
    switch (body) {
      case 'villager': case 'human': case 'monk': this.human(u, root, act, ft, col, body); break;
      case 'horse': this.cavalry(u, root, act, ft, col, spr); break;
      case 'ram': this.ram(u, root, act, ft, col, spr); break;
      case 'mangonel': this.mangonel(u, root, act, ft, col, spr); break;
      case 'trebuchet': this.trebuchet(u, root, act, ft, col); break;
      default: this.animal(u, root, act, ft, body, col); break;
    }
  }

  // ------------------------------------------------------------------ poses
  poseOf(o, ft, frames) {
    const f0 = Math.floor(ft) % frames, f1 = (f0 + 1) % frames, k = ft - Math.floor(ft);
    const a = humanPose({ ...o, frame: f0 }), b = humanPose({ ...o, frame: f1 });
    for (const key in a) if (typeof a[key] === 'number' && typeof b[key] === 'number') a[key] = a[key] + (b[key] - a[key]) * k;
    return a;
  }

  humanOpts(u, act, body, col) {
    const spr = UNITS[u.type].sprite;
    if (body === 'villager') {
      const o = villagerOpts(col, u.variant || 0, u.task, act, u.carry >= 1 ? u.carryType : null);
      return o;
    }
    if (body === 'monk') return { col, skin: SKINS[(u.variant || 0) % 4], hair: '#5a3a1e', helm: 'tonsure', robe: '#7a4e22', weapon: 'staff', action: act };
    return { col, skin: SKINS[((u.variant || 0) + 1) % 4], hair: HAIRS[(u.variant || 0) % 4], weapon: spr.weapon, armor: spr.armor, helm: spr.helm, shield: spr.shield, cape: spr.cape, action: act, legCol: spr.armor === 'plate' ? '#8a9096' : '#4e3e2a' };
  }

  human(u, root, act, ft, pc, body) {
    const o = this.humanOpts(u, act, body, pc);
    const work = (act === 'gather' || act === 'build') && o.villager;
    const frames = work ? WORK_FRAMES : 4;
    const p = this.poseOf(o, ft, frames);
    this.humanBody(root, o, p, pc, false);
  }

  // shared humanoid; mounted = only the upper body sitting at the origin
  humanBody(root, o, p, pc, mounted) {
    const K = UK;
    const skin = o.skin, armor = o.armor || 'none';
    const tunic = pc.main, dark = pc.dark;
    const sleeve = armor === 'plate' || armor === 'gold' ? '#b9bec4' : armor === 'chain' ? '#9ea3a8' : tunic;
    const bodyCol = armor === 'plate' ? '#c4c9ce' : armor === 'gold' ? '#d9b13c' : armor === 'chain' ? '#9ea3a8' : armor === 'scale' ? '#8c8a7a' : armor === 'leather' ? '#7a5230' : tunic;
    const metalBody = armor === 'plate' || armor === 'gold' || armor === 'chain' || armor === 'scale';
    const hipY = mounted ? 0 : (10 - p.bob - p.crouch) * K;
    const shY = mounted ? 8 * K : (18 - p.bob - p.crouch * 1.3) * K;
    const shX = (0.8 + p.lean) * K * (mounted ? 0.6 : 1);
    const M = this.tmpA || (this.tmpA = new THREE.Matrix4());
    // legs
    if (!mounted) {
      const legLen = (10 - p.crouch * 0.6) * K, legCol = o.legCol || '#5a4630';
      for (const [z, a, c] of [[0.045, p.legB, shade(legCol, 0.8)], [-0.045, p.legF, legCol]]) {
        if (o.robe) continue;
        this.P(root, 'limb', 'matte', c, 0, hipY, z, 0, 0, a, 0.034, legLen, 0.034);
        const fx = Math.sin(a) * legLen, fy = hipY - Math.cos(a) * legLen;
        this.P(root, 'box', 'matte', '#2e2014', fx + 0.02, fy + 0.015, z, 0, 0, 0, 0.09, 0.035, 0.05);
      }
      if (o.robe) this.P(root, 'skirt', 'matte', o.robe, shX * 0.5, shY, 0, 0, 0, -p.lean * 0.05, 0.12, shY + 0.02, 0.1);
      else this.P(root, 'skirt', 'matte', o.female ? tunic : shade(tunic, 0.9), 0, hipY + 0.02, 0, 0, 0, 0, 0.1, o.female ? 0.2 : 0.1, 0.085);
    } else {
      // straddling legs
      for (const z of [0.07, -0.07]) this.P(root, 'limb', 'matte', '#4a3a28', 0.02, 0, z, z > 0 ? 0.5 : -0.5, 0, 0.35, 0.034, 0.22, 0.034);
    }
    // torso
    const tilt = Math.atan2(shX, shY - hipY);
    this.P(root, 'torso', metalBody ? 'metal' : 'matte', o.robe ? shade(o.robe, 1.08) : bodyCol, 0, hipY, 0, 0, 0, -tilt, 0.095, shY - hipY + 0.03, 0.075);
    if (metalBody) this.P(root, 'torso', 'matte', tunic, 0.012, hipY, 0, 0, 0, -tilt, 0.09, (shY - hipY) * 0.92, 0.05);   // tabard
    if (o.apron) this.P(root, 'boxU', 'matte', o.apron, 0.065, hipY - 0.06, 0, 0, 0, -tilt, 0.02, shY - hipY - 0.02, 0.1);
    this.P(root, 'cyl', 'matte', '#3e2a16', 0, hipY, 0, 0, 0, 0, 0.1, 0.03, 0.08);   // belt
    // cape / carried load / basket on the back
    if (o.cape) this.P(root, 'boxD', 'matte', dark, shX - 0.08, shY, 0, 0, 0, -0.18 - p.legF * 0.1, 0.02, 0.36, 0.2);
    if (o.carry && o.action !== 'gather') this.carry(root, o.carry, shX - 0.11, shY - 0.08);
    else if (o.basket) this.P(root, 'cyl', 'matte', '#a07a3a', shX - 0.1, shY - 0.2, 0, 0, 0, 0.2, 0.06, 0.14, 0.06);
    // head and headgear
    const hx = shX + 1 * K, hy = shY + 4.4 * K;
    this.P(root, 'sphere', 'matte', skin, hx, hy, 0, 0, 0, 0, 0.068, 0.072, 0.066);
    this.hat(root, o, hx, hy, pc);
    // shield (left arm side, +Z)
    if (o.shield) this.P(root, 'disc', 'matte', pc.main, shX + 0.08, shY - 0.12, 0.11, Math.PI / 2, 0, 0.1, 0.09, 0.018, 0.11);
    // arms: back (left, +Z) then front (right, -Z)
    const armLen = 8 * K;
    const fH = [shX + 1.4 * K + Math.sin(p.aF) * armLen + (p.thrust || 0) * 0.6 * K, shY - 0.6 * K - Math.cos(p.aF) * armLen];
    let bH = [shX - 1.2 * K + Math.sin(p.aB) * armLen * 0.95, shY - 0.8 * K - Math.cos(p.aB) * armLen * 0.95];
    if (p.twoHand && p.wA != null) bH = [fH[0] + Math.sin(p.wA) * 2.6 * K, fH[1] - Math.cos(p.wA) * 2.6 * K];
    if (p.style === 'bow' && o.action === 'attack' && !p.released) bH = [shX + (6 - p.draw * 8) * K, shY - 1.5 * K];
    const arm = (sx, sy, z, hand, col) => {
      const dx = hand[0] - sx, dy = hand[1] - sy, len = Math.max(0.05, Math.hypot(dx, dy));
      const a = Math.atan2(dx, -dy);
      this.P(root, 'limb', 'matte', col, sx, sy, z, 0, 0, a, 0.03, len, 0.03);
      this.P(root, 'sphere', 'matte', skin, hand[0], hand[1], z, 0, 0, 0, 0.026, 0.026, 0.026);
    };
    arm(shX - 1.2 * K, shY - 0.8 * K, 0.1, bH, shade(sleeve, 0.85));
    arm(shX + 1.4 * K, shY - 0.6 * K, -0.1, fH, sleeve);
    // weapon / tool
    this.weapon(root, o, p, fH, bH, -0.11);
  }

  hat(root, o, hx, hy, pc) {
    const h = o.helm || 'none';
    const steel = '#b9bec4';
    switch (h) {
      case 'none': this.P(root, 'hemi', 'matte', o.hair, hx - 0.008, hy + 0.005, 0, 0, 0, 0.35, 0.071, 0.07, 0.069); break;
      case 'scarf': this.P(root, 'hemi', 'matte', o.scarf || '#e8dcc0', hx - 0.01, hy, 0, 0, 0, 0.35, 0.076, 0.08, 0.074); break;
      case 'cap': this.P(root, 'hemi', 'matte', '#7a5230', hx, hy + 0.01, 0, 0, 0, 0, 0.074, 0.06, 0.072); break;
      case 'wool': this.P(root, 'cone', 'matte', '#8a3a22', hx - 0.005, hy + 0.02, 0, 0, 0, 0.3, 0.07, 0.11, 0.07); break;
      case 'minercap': this.P(root, 'hemi', 'matte', '#4a4a50', hx, hy + 0.01, 0, 0, 0, 0, 0.074, 0.06, 0.072); this.P(root, 'box', 'matte', '#4a4a50', hx + 0.06, hy + 0.012, 0, 0, 0, 0, 0.06, 0.012, 0.08); this.P(root, 'sphere', 'matte', '#e8c040', hx + 0.06, hy + 0.05, 0, 0, 0, 0, 0.018, 0.018, 0.018); break;
      case 'straw': this.P(root, 'disc', 'matte', '#d8b860', hx, hy + 0.04, 0, 0, 0, 0, 0.14, 0.012, 0.14); this.P(root, 'cone', 'matte', '#d8b860', hx, hy + 0.045, 0, 0, 0, 0, 0.07, 0.07, 0.07); this.P(root, 'cyl', 'matte', '#a8402a', hx, hy + 0.045, 0, 0, 0, 0, 0.068, 0.015, 0.068); break;
      case 'felt': this.P(root, 'disc', 'matte', '#6a5034', hx, hy + 0.04, 0, 0, 0, 0, 0.11, 0.012, 0.11); this.P(root, 'cone', 'matte', '#6a5034', hx, hy + 0.045, 0, 0, 0, 0, 0.065, 0.1, 0.065); break;
      case 'hood': this.P(root, 'hemi', 'matte', '#4c5a2e', hx - 0.01, hy - 0.005, 0, 0, 0, 0.3, 0.08, 0.085, 0.078); this.P(root, 'cone', 'matte', '#4c5a2e', hx - 0.04, hy + 0.03, 0, 0, 0, 0.9, 0.04, 0.08, 0.04); break;
      case 'fur': this.P(root, 'cyl', 'matte', '#6a4a2c', hx, hy + 0.01, 0, 0, 0, 0, 0.085, 0.07, 0.085); this.P(root, 'sphere', 'matte', pc.main, hx, hy + 0.09, 0, 0, 0, 0, 0.02, 0.02, 0.02); break;
      case 'tonsure': this.P(root, 'hemi', 'matte', '#5a3a1e', hx, hy - 0.01, 0, Math.PI, 0, 0, 0.071, 0.05, 0.069); break;
      case 'greathelm': this.P(root, 'cyl', 'metal', steel, hx, hy - 0.06, 0, 0, 0, 0, 0.078, 0.14, 0.076); this.P(root, 'box', 'matte', '#20242a', hx + 0.072, hy + 0.01, 0, 0, 0, 0, 0.01, 0.012, 0.09); break;
      case 'kettle': this.P(root, 'hemi', 'metal', steel, hx, hy + 0.01, 0, 0, 0, 0, 0.076, 0.065, 0.074); this.P(root, 'disc', 'metal', steel, hx, hy + 0.012, 0, 0, 0, 0, 0.12, 0.01, 0.12); break;
      case 'crown': this.P(root, 'hemi', 'metal', '#d9b13c', hx, hy + 0.01, 0, 0, 0, 0, 0.077, 0.07, 0.075); this.P(root, 'cone', 'matte', pc.main, hx, hy + 0.07, 0, 0, 0, 0, 0.03, 0.09, 0.03); break;
      default: // helm / feather / spike
        this.P(root, 'hemi', 'metal', steel, hx, hy + 0.005, 0, 0, 0, 0, 0.077, 0.072, 0.075);
        if (h === 'helm' || h === 'feather') this.P(root, 'box', 'metal', '#7d848c', hx + 0.07, hy - 0.02, 0, 0, 0, 0, 0.012, 0.06, 0.014);
        if (h === 'spike') this.P(root, 'cone', 'metal', '#7d848c', hx, hy + 0.07, 0, 0, 0, 0, 0.02, 0.09, 0.02);
        if (h === 'feather') this.P(root, 'limb', 'matte', pc.main, hx - 0.02, hy + 0.08, 0, 0, 0, 2.3, 0.022, 0.16, 0.02);
    }
  }

  carry(root, kind, x, y) {
    switch (kind) {
      case 'wood': for (let i = 0; i < 3; i++) this.P(root, 'cyl', 'matte', i % 2 ? '#8a5a30' : '#7a4c26', x, y + i * 0.045, -0.12, Math.PI / 2, 0, 0, 0.03, 0.26, 0.03); break;
      case 'food': this.P(root, 'cyl', 'matte', '#9a6a2a', x, y - 0.05, 0, 0, 0, 0, 0.07, 0.1, 0.07); this.P(root, 'sphere', 'matte', '#c0392b', x, y + 0.06, 0, 0, 0, 0, 0.04, 0.035, 0.04); break;
      case 'gold': this.P(root, 'sphere', 'matte', '#a08a5a', x, y, 0, 0, 0, 0, 0.07, 0.08, 0.07); this.P(root, 'ico', 'metal', '#f2c832', x, y + 0.07, 0, 0, 0, 0, 0.03, 0.03, 0.03); break;
      case 'stone': this.P(root, 'ico', 'matte', '#a4a29a', x, y, 0, 0.4, 0.3, 0.2, 0.075, 0.065, 0.07); break;
    }
  }

  weapon(root, o, p, fH, bH, z) {
    const w = o.weapon;
    if (!w || w === 'none') return;
    const K = UK, st = p.style;
    if (st === 'bow') {
      const lb = w === 'longbow';
      const r = lb ? 0.3 : 0.24;
      // the arc's convex side faces forward
      this.P(root, 'bow', 'matte', '#6a4220', fH[0] - 0.01, fH[1], z, 0, 0, -Math.PI / 2, r, r * 0.45, r);
      if (o.action === 'attack' && !p.released && p.draw > 0.1) this.P(root, 'limb', 'matte', '#d8c8a0', fH[0] + 0.12, fH[1], z, 0, 0, Math.PI / 2 + 0.0, 0.008, 0.14 + p.draw * 0.1, 0.008);
      return;
    }
    if (st === 'xbow') {
      this.P(root, 'box', 'matte', '#5e3b1c', fH[0] + 0.02, fH[1], z, 0, 0, 0, 0.26, 0.035, 0.035);
      this.P(root, 'bow', 'metal', '#5a5e64', fH[0] + 0.12, fH[1], z, -Math.PI / 2, 0, -Math.PI / 2, 0.06, 0.13, 0.13);
      return;
    }
    if (st === 'forage') return;
    if (st === 'throw' && o.action === 'attack' && p.released) return;
    const a = st === 'throw' ? (o.action === 'attack' ? p.wA : 2.6) : (p.wA != null ? p.wA : p.aF + 2);
    const M = this.tmpW || (this.tmpW = new THREE.Matrix4());
    this.F(M, root, fH[0], fH[1], z, 0, 0, a);
    const S = (geo, mat, col, x, y, sx, sy, sz, rz = 0) => this.P(M, geo, mat, col, x, y, 0, 0, 0, rz, sx, sy, sz);
    switch (w) {
      case 'sword': case 'longsword': case 'greatsword': {
        const L = w === 'sword' ? 0.25 : w === 'longsword' ? 0.32 : 0.38;
        S('boxD', 'metal', '#d6dade', 0, -0.03, 0.018, L, 0.04);
        S('box', 'metal', '#c9a240', 0, -0.03, 0.022, 0.016, 0.12);
        S('boxU', 'matte', '#4a3418', 0, -0.03, 0.02, 0.06, 0.02);
        break;
      }
      case 'mace': S('limb', 'matte', '#5e3b1c', 0, 0.04, 0.012, 0.24, 0.012); S('ico', 'metal', '#7d848c', 0, -0.22, 0.045, 0.045, 0.045); break;
      case 'spear': case 'pike': case 'halberd': case 'javelin': case 'huntspear': {
        const L = w === 'pike' ? 0.72 : w === 'halberd' ? 0.6 : w === 'spear' ? 0.52 : 0.4;
        const back = w === 'javelin' || w === 'huntspear' ? 0.1 : L * 0.3;
        S('limb', 'matte', '#8a5a30', 0, back, 0.011, L, 0.011);
        S('cone', 'metal', '#c8ccd0', 0, back - L, 0.02, 0.09, 0.02, Math.PI);
        if (w === 'halberd') S('box', 'metal', '#7d848c', 0.05, back - L + 0.05, 0.1, 0.06, 0.01);
        break;
      }
      case 'woodaxe': case 'axe': {
        const L = w === 'axe' ? 0.17 : 0.22;
        S('limb', 'matte', '#8a5a30', 0, 0.03, 0.012, L + 0.03, 0.012);
        S('box', 'metal', '#c8ccd0', 0.04, -L + 0.01, 0.08, 0.06, 0.012);
        break;
      }
      case 'pick': S('limb', 'matte', '#8a5a30', 0, 0.03, 0.012, 0.25, 0.012); S('box', 'metal', '#7d848c', 0, -0.22, 0.2, 0.025, 0.02, 0.15); break;
      case 'hammer': S('limb', 'matte', '#8a5a30', 0, 0.02, 0.011, 0.18, 0.011); S('box', 'metal', '#5d5f63', 0, -0.17, 0.09, 0.05, 0.05); break;
      case 'hoe': S('limb', 'matte', '#8a5a30', 0, 0.08, 0.011, 0.33, 0.011); S('box', 'metal', '#7d848c', 0.035, -0.24, 0.07, 0.015, 0.05); break;
      case 'knife': S('boxD', 'metal', '#e6eaee', 0, -0.02, 0.008, 0.08, 0.02); break;
      case 'staff': case 'crook': {
        S('limb', 'matte', w === 'crook' ? '#7a5530' : '#6b4a26', 0, 0.2, 0.012, 0.56, 0.012);
        if (w === 'staff') S('sphere', 'metal', '#d9b13c', 0, -0.37, 0.025, 0.025, 0.025);
        else S('bow', 'matte', '#7a5530', 0.035, -0.37, 0.04, 0.04, 0.04, Math.PI);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ cavalry
  cavalry(u, root, act, ft, pc, spr) {
    const [hc, hd] = HORSE3[spr.horse] || HORSE3.bay;
    const gallop = act === 'walk';
    const ph = ft / 4 * Math.PI * 2;
    const bob = gallop ? Math.abs(Math.sin(ph)) * 0.025 : 0;
    const by = 0.4 + bob;
    // legs: [x, z, phase]
    const legs = [[0.17, -0.06, 0], [0.14, 0.06, 0.9], [-0.17, -0.06, Math.PI], [-0.2, 0.06, Math.PI + 0.9]];
    for (const [x, z, o] of legs) {
      const a = gallop ? Math.sin(ph + o) * 0.6 : (act === 'attack' && x > 0 ? -0.2 : 0);
      this.P(root, 'limb', 'matte', z > 0 ? hd : hc, x, by - 0.05, z, 0, 0, a, 0.03, 0.36, 0.03);
      this.P(root, 'box', 'matte', '#1a1410', x + Math.sin(a) * 0.36, by - 0.05 - Math.cos(a) * 0.36 + 0.015, z, 0, 0, 0, 0.05, 0.03, 0.04);
    }
    this.P(root, 'sphere', 'matte', hc, 0, by, 0, 0, 0, 0, 0.3, 0.13, 0.115);
    // neck & head
    const hb = act === 'attack' ? Math.sin(ft * 1.6) * 0.15 : gallop ? Math.sin(ph) * 0.08 : 0;
    this.P(root, 'limb', 'matte', hc, 0.2, by + 0.05, 0, 0, 0, Math.PI - 0.55 + hb, 0.055, 0.24, 0.05);
    const nx = 0.2 + Math.sin(Math.PI - 0.55 + hb) * 0.24, ny = by + 0.05 - Math.cos(Math.PI - 0.55 + hb) * 0.24;
    this.P(root, 'box', 'matte', hc, nx + 0.07, ny - 0.02, 0, 0, 0, -0.6, 0.18, 0.07, 0.07);
    this.P(root, 'cone', 'matte', hd, nx - 0.01, ny + 0.02, 0.025, 0, 0, 0, 0.015, 0.05, 0.015);
    this.P(root, 'limb', 'matte', hd, 0.19, by + 0.12, 0, 0, 0, Math.PI - 0.6 + hb, 0.02, 0.24, 0.035);   // mane
    // tail
    this.P(root, 'limb', 'matte', hd, -0.29, by + 0.05, 0, 0, 0, -0.35 + (gallop ? Math.sin(ph) * 0.2 : 0), 0.03, 0.26, 0.03);
    // barding or blanket
    if (spr.barding) {
      const bc = spr.barding === 'scale' ? '#8a887a' : pc.main;
      this.P(root, 'sphere', spr.barding === 'scale' ? 'metal' : 'matte', bc, 0, by - 0.01, 0, 0, 0, 0, 0.31, 0.12, 0.125);
      this.P(root, 'box', 'metal', '#b9bec4', nx + 0.07, ny + 0.0, 0, 0, 0, -0.6, 0.16, 0.06, 0.075);
    } else this.P(root, 'box', 'matte', pc.main, -0.02, by + 0.09, 0, 0, 0, 0, 0.2, 0.05, 0.25);
    // rider
    const R = this.tmpR || (this.tmpR = new THREE.Matrix4());
    this.F(R, root, -0.02, by + 0.12, 0);
    const r = spr.rider;
    const o = { col: pc, skin: SKINS[(u.variant || 0) % 4], hair: HAIRS[(u.variant || 0) % 4], weapon: r.weapon, armor: r.armor, helm: r.helm, shield: r.shield, cape: r.cape, action: act === 'walk' ? 'idle' : act };
    const p = this.poseOf(o, ft, 4);
    this.humanBody(R, o, p, pc, true);
  }

  // ------------------------------------------------------------------ siege
  wheels(root, xs, r = 0.14, z = 0.2) {
    for (const x of xs) for (const zz of [z, -z]) this.P(root, 'disc', 'matte', '#5e3e20', x, r, zz, Math.PI / 2, 0, 0, r, 0.04, r);
  }
  ram(u, root, act, ft, pc, spr) {
    const push = act === 'attack' ? Math.sin(ft / 4 * Math.PI * 2) * 0.08 : 0;
    this.wheels(root, [-0.25, 0.25]);
    this.P(root, 'cyl', 'matte', '#6a4a2a', 0.2 + push, 0.32, 0, 0, 0, Math.PI / 2, 0.06, 0.8, 0.06);
    this.P(root, 'cone', 'metal', '#5a5e64', 0.6 + push, 0.32, 0, 0, 0, -Math.PI / 2, 0.08, 0.12, 0.08);
    this.P(root, 'boxU', 'matte', '#8a5a30', 0, 0.16, 0, 0, 0, 0, 0.8, 0.32, 0.42);
    this.P(root, 'boxU', 'matte', spr.capped ? '#6a6e74' : '#b8946a', 0, 0.48, 0, 0, 0, 0, 0.84, 0.08, 0.46);
    this.P(root, 'boxU', 'matte', pc.main, 0, 0.56, 0, 0, 0, 0, 0.5, 0.025, 0.12);
  }
  mangonel(u, root, act, ft, pc, spr) {
    const fire = act === 'attack' ? [0, 0.6, 1, 0.4][Math.floor(ft) % 4] : 0;
    this.wheels(root, [-0.25, 0.25], 0.12, 0.17);
    this.P(root, 'boxU', 'matte', '#5e3b1c', 0, 0.12, 0.13, 0, 0, 0, 0.75, 0.07, 0.06);
    this.P(root, 'boxU', 'matte', '#5e3b1c', 0, 0.12, -0.13, 0, 0, 0, 0.75, 0.07, 0.06);
    this.P(root, 'boxU', 'matte', '#8a5a30', -0.05, 0.12, 0, 0, 0, 0, 0.1, 0.4, 0.3);
    const a = lerp(-2.4, -0.4, fire);   // arm angle (from +x, counter-clockwise)
    const A = this.tmpA2 || (this.tmpA2 = new THREE.Matrix4());
    this.F(A, root, -0.05, 0.42, 0, 0, 0, a + Math.PI / 2);
    this.P(A, 'boxU', 'matte', '#7a5230', 0, -0.08, 0, 0, 0, 0, 0.05, 0.55, 0.05);
    this.P(A, 'sphere', 'matte', '#5a3a1a', 0, 0.47, 0, 0, 0, 0, 0.07, 0.05, 0.07);
    if (fire < 0.5) this.P(A, 'sphere', 'matte', '#8a8880', 0, 0.52, 0, 0, 0, 0, 0.05, 0.05, 0.05);
    this.P(root, 'cyl', 'matte', '#c8b080', -0.05, 0.36, 0, Math.PI / 2, 0, 0, 0.06, 0.32, 0.06);
    this.P(root, 'boxU', 'matte', pc.main, 0.3, 0.19, 0.13, 0, 0, 0, 0.02, 0.22, 0.12);
  }
  trebuchet(u, root, act, ft, pc) {
    const fire = act === 'attack' ? [0, 0.5, 1, 0.8][Math.floor(ft) % 4] : 0;
    this.wheels(root, [-0.45, 0.45], 0.14, 0.32);
    this.P(root, 'boxU', 'matte', '#5e3b1c', 0, 0.14, 0.25, 0, 0, 0, 1.2, 0.08, 0.08);
    this.P(root, 'boxU', 'matte', '#5e3b1c', 0, 0.14, -0.25, 0, 0, 0, 1.2, 0.08, 0.08);
    for (const z of [0.25, -0.25]) for (const s of [-1, 1]) this.P(root, 'boxU', 'matte', '#8a5a30', s * 0.18, 0.14, z, 0, 0, s * 0.27, 0.06, 1.1, 0.06);
    const a = lerp(Math.PI * 0.8, -Math.PI * 0.42, fire);
    const A = this.tmpA2 || (this.tmpA2 = new THREE.Matrix4());
    this.F(A, root, 0, 1.18, 0, 0, 0, a - Math.PI / 2);
    this.P(A, 'boxU', 'matte', '#7a5230', 0, -0.3, 0, 0, 0, 0, 0.06, 1.3, 0.06);
    this.P(A, 'boxD', 'matte', '#4a3420', 0, -0.3, 0, 0, 0, 0, 0.26, 0.26, 0.26);
    this.P(A, 'boxD', 'matte', pc.main, 0, -0.38, 0, 0, 0, 0, 0.27, 0.06, 0.27);
    if (fire < 0.7) this.P(A, 'sphere', 'matte', '#8a8880', 0, 1.0, 0, 0, 0, 0, 0.08, 0.08, 0.08);
  }

  // ------------------------------------------------------------------ animals
  animal(u, root, act, ft, body, pc) {
    const walk = act === 'walk' || (act === 'attack' && body !== 'sheep');
    const ph = ft / 4 * Math.PI * 2;
    const C = { sheep: ['#ecebe2', '#2e2824'], deer: ['#9a6634', '#6a4424'], boar: ['#4a3626', '#2a1e14'], wolf: ['#86847a', '#5a5850'] }[body];
    const L = { sheep: 0.14, deer: 0.26, boar: 0.13, wolf: 0.18 }[body];
    const by = L + 0.04;
    const sx = { sheep: 0.16, deer: 0.2, boar: 0.2, wolf: 0.18 }[body];
    for (const [x, z, o] of [[sx * 0.6, -0.05, 0], [sx * 0.6, 0.05, 1], [-sx * 0.6, -0.05, Math.PI], [-sx * 0.6, 0.05, Math.PI + 1]]) {
      const a = walk ? Math.sin(ph + o) * 0.5 : 0;
      this.P(root, 'limb', 'matte', C[1], x, by, z, 0, 0, a, 0.022, L, 0.022);
    }
    const graze = act === 'idle' && body !== 'wolf' && Math.floor(ft) % 2 === 1;
    if (body === 'sheep') {
      this.P(root, 'ico', 'matte', C[0], 0, by + 0.05, 0, 0.3, 0.2, 0.1, 0.19, 0.13, 0.13);
      this.P(root, 'sphere', 'matte', C[1], 0.18, by + (graze ? -0.02 : 0.07), 0, 0, 0, -0.4, 0.07, 0.05, 0.045);
      if (u.owner) this.P(root, 'box', 'matte', pc.main, 0, by + 0.18, 0, 0, 0, 0, 0.06, 0.02, 0.06);
    } else if (body === 'deer') {
      this.P(root, 'sphere', 'matte', C[0], 0, by + 0.05, 0, 0, 0, 0, 0.2, 0.08, 0.075);
      this.P(root, 'limb', 'matte', C[0], 0.15, by + 0.05, 0, 0, 0, Math.PI - (graze ? 2.2 : 0.4), 0.035, 0.2, 0.035);
      const nx = 0.15 + Math.sin(Math.PI - (graze ? 2.2 : 0.4)) * 0.2, ny = by + 0.05 - Math.cos(Math.PI - (graze ? 2.2 : 0.4)) * 0.2;
      this.P(root, 'sphere', 'matte', C[0], nx + 0.03, ny, 0, 0, 0, 0, 0.07, 0.04, 0.04);
      for (const z of [0.03, -0.03]) this.P(root, 'limb', 'matte', '#d8c8a8', nx, ny + 0.03, z, z * 8, 0, Math.PI - 0.3, 0.008, 0.12, 0.008);
      this.P(root, 'sphere', 'matte', '#f2ead8', -0.19, by + 0.07, 0, 0, 0, 0, 0.03, 0.03, 0.03);
    } else if (body === 'boar') {
      this.P(root, 'sphere', 'matte', C[0], 0, by + 0.05, 0, 0, 0, 0.1, 0.22, 0.11, 0.1);
      for (let i = 0; i < 5; i++) this.P(root, 'cone', 'matte', C[1], -0.12 + i * 0.06, by + 0.13, 0, 0, 0, 0.3, 0.02, 0.05, 0.02);
      const hb = act === 'attack' ? Math.sin(ft * 2) * 0.03 : 0;
      this.P(root, 'cone', 'matte', C[1], 0.18, by + 0.04 + hb, 0, 0, 0, -Math.PI / 2, 0.07, 0.14, 0.06);
      for (const z of [0.03, -0.03]) this.P(root, 'cone', 'matte', '#e8e0cc', 0.3, by + 0.0 + hb, z, 0, 0, 0.4, 0.008, 0.05, 0.008);
    } else {
      this.P(root, 'sphere', 'matte', C[0], 0, by + 0.05, 0, 0, 0, 0, 0.19, 0.075, 0.07);
      this.P(root, 'cone', 'matte', C[0], 0.17, by + 0.09, 0, 0, 0, -Math.PI / 2 - 0.2, 0.055, 0.14, 0.05);
      for (const z of [0.025, -0.025]) this.P(root, 'cone', 'matte', C[1], 0.16, by + 0.13, z, 0, 0, 0, 0.015, 0.05, 0.015);
      this.P(root, 'limb', 'matte', C[1], -0.18, by + 0.07, 0, 0, 0, -0.7, 0.025, 0.2, 0.025);
    }
  }
}
