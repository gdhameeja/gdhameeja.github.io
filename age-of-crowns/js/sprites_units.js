'use strict';
// ============================================================================
//  Procedural unit sprites. Every unit is drawn with canvas primitives into
//  cached canvases keyed by (type, colour, action, frame, extras). Sprites
//  face right; the renderer mirrors them for left-facing units.
// ============================================================================

const SPRITES = new Map();
const SKINS = ['#e3b78f', '#c9996c', '#a87650', '#efc9a2'];
const HAIRS = ['#3b2615', '#6b4524', '#1d1610', '#a37443'];
const STEEL = '#b9bec4', STEEL_D = '#7d848c', STEEL_L = '#e6eaee';
const WOOD = '#8a5a30', WOOD_D = '#5e3b1c', LEATHER = '#7a5230', LEATHER_D = '#553719';
const GOLD_C = '#d9b13c';

const BODY_DIMS = {
  human: { w: 44, h: 46, ax: 22, ay: 40 },
  villager: { w: 44, h: 46, ax: 22, ay: 40 },
  monk: { w: 44, h: 46, ax: 22, ay: 40 },
  horse: { w: 64, h: 62, ax: 32, ay: 54 },
  ram: { w: 64, h: 50, ax: 30, ay: 42 },
  mangonel: { w: 64, h: 56, ax: 30, ay: 46 },
  trebuchet: { w: 120, h: 130, ax: 58, ay: 116 },
  sheep: { w: 36, h: 30, ax: 18, ay: 24 },
  deer: { w: 40, h: 40, ax: 20, ay: 34 },
  boar: { w: 40, h: 32, ax: 20, ay: 26 },
  wolf: { w: 40, h: 32, ax: 20, ay: 26 },
};

function weaponStyle(w) {
  switch (w) {
    case 'sword': case 'longsword': case 'greatsword': case 'mace': case 'woodaxe': case 'pick': case 'hammer': case 'hoe': return 'swing';
    case 'spear': case 'pike': case 'halberd': return 'thrust';
    case 'bow': case 'longbow': return 'bow';
    case 'crossbow': return 'xbow';
    case 'javelin': case 'axe': case 'huntspear': return 'throw';
    case 'staff': case 'crook': return 'staff';
    case 'forage': return 'forage';
    case 'knife': return 'knife';
    default: return 'none';
  }
}

function humanPose(o) {
  const f = o.frame | 0, A = o.action, st = weaponStyle(o.weapon);
  const p = { legF: 0, legB: 0, aF: 0.3, aB: -0.25, bob: 0, lean: 0, wA: null, crouch: 0, draw: 0, thrust: 0, released: false, style: st };
  if (st === 'thrust') { p.aF = 0.5; p.wA = Math.PI * 0.97; }
  if (st === 'bow') { p.aF = 0.35; }
  if (st === 'staff') { p.aF = 0.55; p.wA = Math.PI * 0.96; }
  if (st === 'xbow') { p.aF = 0.4; p.aB = 0.2; }
  if (st === 'swing') p.wA = p.aF + (o.weapon === 'pick' || o.weapon === 'hoe' || o.weapon === 'woodaxe' ? 1.6 : 2.0);
  if (A === 'walk') {
    const ph = f / 4 * Math.PI * 2;
    p.legF = Math.sin(ph) * 0.55; p.legB = -p.legF;
    if (st !== 'bow' && st !== 'xbow' && st !== 'thrust' && st !== 'staff') p.aF = 0.25 - Math.sin(ph) * 0.4;
    p.aB = Math.sin(ph) * 0.4 - 0.1;
    p.bob = -Math.abs(Math.sin(ph)) * 1.1;
    if (st === 'swing') p.wA = p.aF + 2.0;
  } else if ((A === 'gather' || A === 'build') && o.villager) {
    workPose(p, o.weapon, f % WORK_FRAMES);
  } else if (A === 'attack' || A === 'gather' || A === 'build') {
    if (st === 'swing') {
      const low = o.weapon === 'hoe' || o.weapon === 'pick';
      const seq = low ? [3.0, 2.2, 0.9, 0.5] : [3.4, 2.3, 1.1, 0.6];
      p.aF = seq[f % 4]; p.wA = p.aF + (low ? 0.9 : 0.3);
      p.lean = [-0.6, 0.4, 1.6, 1.2][f % 4];
      p.aB = [-0.6, -0.2, 0.4, 0.2][f % 4];
      if (low) p.crouch = [0, 0.5, 1.5, 1.2][f % 4];
    } else if (st === 'thrust') {
      p.aF = [0.9, 1.25, 1.55, 1.3][f % 4]; p.wA = Math.PI / 2 + 0.05; p.aB = p.aF - 0.2;
      p.thrust = [-4, -1, 3, 1][f % 4]; p.lean = [-0.5, 0, 1.2, 0.6][f % 4];
    } else if (st === 'bow') {
      p.aF = 1.5; p.aB = 1.3; p.draw = [0.25, 0.7, 1, 0][f % 4]; p.released = (f % 4) === 3;
    } else if (st === 'xbow') {
      p.aF = 1.45; p.aB = 1.25; p.lean = (f % 4) === 3 ? -0.8 : 0; p.released = (f % 4) === 3;
    } else if (st === 'throw') {
      p.aF = [-2.4, -1.9, 1.9, 1.3][f % 4]; p.released = (f % 4) >= 2;
      p.wA = 1.75; p.aB = [1.0, 1.1, -0.4, -0.2][f % 4]; p.lean = [-1, -0.6, 1.4, 0.8][f % 4];
    } else if (st === 'forage') {
      p.crouch = 3; p.aF = [1.0, 0.7, 0.9, 0.6][f % 4]; p.aB = [0.6, 0.9, 0.5, 0.8][f % 4]; p.lean = 1.5;
    } else if (st === 'staff') {
      p.aF = 2.5; p.aB = 2.3; p.wA = Math.PI * 0.9;
    }
  } else if (A === 'pray') {
    p.aF = 2.6 + (f % 2) * 0.15; p.aB = 2.4 + (f % 2) * 0.15; p.wA = Math.PI * 0.92;
  }
  return p;
}

// Villager work poses: 8 frames per cycle, impact on frame 6 (see WORK_HIT).
// Each row: [front arm angle, lean, crouch, back arm angle]
const WORK_POSES = {
  //            0 recover         1 lift           2 raise           3 peak            4 hold            5 swing           6 IMPACT         7 recoil
  woodaxe: [[1.5, 0.6, 0, 0], [2.2, 0, 0, 0], [2.8, -0.5, 0, 0], [3.3, -0.9, 0, 0], [3.42, -1.0, 0, 0], [2.4, 0.4, 0.2, 0], [1.15, 1.9, 0.7, 0], [1.3, 1.5, 0.5, 0]],
  pick:    [[1.3, 0.8, 0.6, 0], [2.0, 0.1, 0.2, 0], [2.7, -0.5, 0, 0], [3.25, -0.9, 0, 0], [3.4, -1.0, 0, 0], [2.3, 0.5, 0.5, 0], [0.95, 2.0, 1.3, 0], [1.1, 1.7, 1.1, 0]],
  hoe:     [[1.2, 0.5, 0.4, 0], [1.9, 0, 0.1, 0], [2.5, -0.3, 0, 0], [2.85, -0.45, 0, 0], [2.7, -0.3, 0, 0], [1.7, 0.8, 0.6, 0], [0.6, 1.7, 1.7, 0], [0.8, 1.4, 1.4, 0]],
  hammer:  [[1.4, 1.0, 2.2, 0], [2.0, 0.7, 2.2, 0], [2.5, 0.4, 2.2, 0], [2.75, 0.2, 2.2, 0], [2.65, 0.3, 2.2, 0], [1.9, 0.9, 2.2, 0], [1.0, 1.4, 2.4, 0], [1.2, 1.2, 2.3, 0]],
  forage:  [[1.4, 1.3, 2.4, 0.6], [1.65, 1.6, 2.6, 0.7], [1.55, 1.6, 2.6, 0.9], [1.15, 1.3, 2.3, 0.8], [0.75, 1.0, 2.0, 0.6], [0.4, 0.9, 1.9, 0.5], [0.45, 1.0, 2.0, 0.7], [0.9, 1.2, 2.2, 0.6]],
  knife:   [[1.25, 1.8, 3.6, 1.0], [1.45, 1.9, 3.7, 1.0], [1.6, 2.0, 3.8, 1.1], [1.45, 1.9, 3.7, 1.0], [1.25, 1.8, 3.6, 1.0], [1.4, 1.9, 3.7, 1.0], [1.62, 2.0, 3.8, 1.1], [1.4, 1.9, 3.7, 1.0]],
};
const TWO_HANDED = { woodaxe: 1, pick: 1, hoe: 1 };
function workPose(p, weapon, f) {
  const seq = WORK_POSES[weapon];
  if (!seq) return;
  const [aF, lean, crouch, aB] = seq[f];
  p.aF = aF; p.lean = lean; p.crouch = crouch; p.aB = aB;
  p.wA = aF + ({ woodaxe: 0.45, pick: 0.55, hoe: 0.95, hammer: 0.5, knife: 0.4 }[weapon] || 0);
  p.twoHand = !!TWO_HANDED[weapon];
  p.work = true;
  if (weapon === 'forage') { p.wA = null; p.pluck = f >= 3 && f <= 5; }
}

// Weapon drawn from the hand, pointing in direction `a` (0=down, PI/2=forward, PI=up)
function drawWeapon(ctx, w, hx, hy, a, o) {
  const dx = Math.sin(a), dy = Math.cos(a);
  const px = -dy, py = dx; // perpendicular
  const L = (len) => [hx + dx * len, hy + dy * len];
  ctx.lineCap = 'round';
  switch (w) {
    case 'sword': case 'longsword': case 'greatsword': {
      const len = w === 'sword' ? 9 : w === 'longsword' ? 11.5 : 13.5;
      const tip = L(len);
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = w === 'greatsword' ? 2.6 : 2.1;
      ctx.beginPath(); ctx.moveTo(...L(1.5)); ctx.lineTo(...tip); ctx.stroke();
      ctx.strokeStyle = STEEL_L; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(...L(2)); ctx.lineTo(...L(len - 0.8)); ctx.stroke();
      ctx.strokeStyle = '#6a5228'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(hx + px * 2.4 + dx * 1.2, hy + py * 2.4 + dy * 1.2); ctx.lineTo(hx - px * 2.4 + dx * 1.2, hy - py * 2.4 + dy * 1.2); ctx.stroke();
      ctx.strokeStyle = '#4a3418'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * 2, hy - dy * 2); ctx.stroke();
      break;
    }
    case 'mace': {
      ctx.strokeStyle = WOOD_D; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx - dx * 1.5, hy - dy * 1.5); ctx.lineTo(...L(8)); ctx.stroke();
      const [mx, my] = L(9);
      ctx.fillStyle = STEEL_D; ctx.beginPath(); ctx.arc(mx, my, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = STEEL_L; ctx.beginPath(); ctx.arc(mx - 0.7, my - 0.7, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'spear': case 'pike': case 'halberd': case 'javelin': case 'huntspear': {
      const len = w === 'pike' ? 26 : w === 'halberd' ? 22 : w === 'spear' ? 19 : 14;
      const back = w === 'javelin' || w === 'huntspear' ? 4 : len * 0.3;
      const tip = L(len - back);
      ctx.strokeStyle = WOOD; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx - dx * back, hy - dy * back); ctx.lineTo(...tip); ctx.stroke();
      ctx.fillStyle = STEEL;
      const t2 = L(len - back + 3.2);
      ctx.beginPath(); ctx.moveTo(t2[0], t2[1]); ctx.lineTo(tip[0] + px * 1.3, tip[1] + py * 1.3); ctx.lineTo(tip[0] - px * 1.3, tip[1] - py * 1.3); ctx.closePath(); ctx.fill();
      if (w === 'halberd') {
        const h = L(len - back - 1.5);
        ctx.fillStyle = STEEL_D;
        ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(h[0] + px * 4 + dx * 1.5, h[1] + py * 4 + dy * 1.5); ctx.lineTo(h[0] + px * 4 - dx * 2.5, h[1] + py * 4 - dy * 2.5); ctx.lineTo(h[0] - dx * 2, h[1] - dy * 2); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'woodaxe': case 'axe': {
      ctx.strokeStyle = WOOD; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hx - dx * 1.5, hy - dy * 1.5); ctx.lineTo(...L(w === 'axe' ? 6 : 8)); ctx.stroke();
      const h = L(w === 'axe' ? 6 : 7.5);
      ctx.fillStyle = STEEL;
      ctx.beginPath(); ctx.moveTo(h[0] - dx * 1.5, h[1] - dy * 1.5); ctx.lineTo(h[0] + px * 3.4 - dx * 2.6, h[1] + py * 3.4 - dy * 2.6); ctx.lineTo(h[0] + px * 3.4 + dx * 1.6, h[1] + py * 3.4 + dy * 1.6); ctx.lineTo(h[0] + dx * 1, h[1] + dy * 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 0.5; ctx.stroke();
      break;
    }
    case 'pick': {
      ctx.strokeStyle = WOOD; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hx - dx * 1.5, hy - dy * 1.5); ctx.lineTo(...L(8)); ctx.stroke();
      const h = L(8);
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(h[0] - px * 4 - dx * 1.5, h[1] - py * 4 - dy * 1.5); ctx.quadraticCurveTo(h[0] + dx * 1.2, h[1] + dy * 1.2, h[0] + px * 4 - dx * 1.5, h[1] + py * 4 - dy * 1.5); ctx.stroke();
      break;
    }
    case 'hammer': {
      ctx.strokeStyle = WOOD; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hx - dx, hy - dy); ctx.lineTo(...L(6.5)); ctx.stroke();
      const h = L(6.5);
      poly(ctx, [[h[0] - px * 2.2, h[1] - py * 2.2], [h[0] + px * 2.2, h[1] + py * 2.2], [h[0] + px * 2.2 + dx * 2, h[1] + py * 2.2 + dy * 2], [h[0] - px * 2.2 + dx * 2, h[1] - py * 2.2 + dy * 2]], '#5d5f63');
      break;
    }
    case 'hoe': {
      ctx.strokeStyle = WOOD; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx - dx * 3, hy - dy * 3); ctx.lineTo(...L(10)); ctx.stroke();
      const h = L(10);
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(h[0] + px * 3, h[1] + py * 3); ctx.stroke();
      break;
    }
    case 'knife': {
      ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx - dx, hy - dy); ctx.lineTo(...L(1.5)); ctx.stroke();
      ctx.strokeStyle = STEEL_L; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(...L(1.5)); ctx.lineTo(...L(5.5)); ctx.stroke();
      break;
    }
    case 'crook': {
      ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hx - dx * 7, hy - dy * 7); ctx.lineTo(...L(11)); ctx.stroke();
      const [cx, cy] = L(11);
      ctx.beginPath(); ctx.arc(cx + px * 1.8, cy + py * 1.8, 1.9, Math.atan2(-py, -px), Math.atan2(-py, -px) + Math.PI * 1.3); ctx.stroke();
      break;
    }
    case 'staff': {
      ctx.strokeStyle = '#6b4a26'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx - dx * 8, hy - dy * 8); ctx.lineTo(...L(13)); ctx.stroke();
      const t = L(13.5);
      ctx.fillStyle = GOLD_C; ctx.beginPath(); ctx.arc(t[0], t[1], 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
}

function drawBow(ctx, hx, hy, draw, released, longbow, backHand) {
  const r = longbow ? 11 : 8.5;
  const top = [hx - 1, hy - r], bot = [hx - 1, hy + r];
  ctx.strokeStyle = '#6a4220'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.quadraticCurveTo(hx + 6, hy, bot[0], bot[1]); ctx.stroke();
  // string
  const sx = backHand ? backHand[0] : hx - 2 - draw * 6, sy = backHand ? backHand[1] : hy;
  ctx.strokeStyle = 'rgba(240,235,220,0.9)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(released ? hx - 1.5 : sx, released ? hy : sy); ctx.lineTo(bot[0], bot[1]); ctx.stroke();
  if (!released && draw > 0.1) {
    ctx.strokeStyle = '#d8c8a0'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx + 5, hy); ctx.stroke();
    ctx.fillStyle = STEEL; ctx.beginPath(); ctx.moveTo(hx + 7, hy); ctx.lineTo(hx + 4.5, hy - 1.2); ctx.lineTo(hx + 4.5, hy + 1.2); ctx.fill();
  }
}

function drawShield(ctx, x, y, col, kind = 'kite') {
  ctx.save();
  if (kind === 'round') {
    ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a3216'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = STEEL; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - 3.6, y - 5); ctx.lineTo(x + 3.6, y - 5);
    ctx.quadraticCurveTo(x + 3.8, y + 2, x, y + 7);
    ctx.quadraticCurveTo(x - 3.8, y + 2, x - 3.6, y - 5);
    ctx.closePath();
    ctx.fillStyle = col.main; ctx.fill();
    ctx.strokeStyle = shade(col.dark, 0.8); ctx.lineWidth = 0.9; ctx.stroke();
    ctx.strokeStyle = col.light; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 5); ctx.moveTo(x - 2.8, y - 1.5); ctx.lineTo(x + 2.8, y - 1.5); ctx.stroke();
  }
  ctx.restore();
}

function drawHead(ctx, o, hx, hy) {
  const helm = o.helm || 'none';
  // head
  ctx.fillStyle = o.skin;
  ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,10,0.35)'; ctx.lineWidth = 0.5; ctx.stroke();
  // face hint
  ctx.fillStyle = 'rgba(40,20,10,0.75)'; ctx.fillRect(hx + 1.6, hy - 0.8, 0.9, 0.9);
  switch (helm) {
    case 'none':
      ctx.fillStyle = o.hair;
      ctx.beginPath(); ctx.arc(hx - 0.4, hy - 0.8, 3.6, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      if (o.female) { ctx.beginPath(); ctx.arc(hx - 3.2, hy - 0.5, 1.8, 0, Math.PI * 2); ctx.fill(); }
      else if (o.beard) { ctx.beginPath(); ctx.arc(hx + 1.2, hy + 2, 2, 0, Math.PI); ctx.fill(); }
      break;
    case 'scarf':
      ctx.fillStyle = o.scarf || '#e8dcc0';
      ctx.beginPath(); ctx.arc(hx - 0.4, hy - 0.6, 3.9, Math.PI * 0.85, Math.PI * 2.1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 3.6, hy); ctx.lineTo(hx - 5, hy + 3.5); ctx.lineTo(hx - 2.4, hy + 2.6); ctx.fill();
      break;
    case 'straw': // farmer's wide-brimmed straw hat
      ctx.fillStyle = o.hair; ctx.beginPath(); ctx.arc(hx - 0.4, hy - 0.4, 3.6, Math.PI * 0.95, Math.PI * 1.5); ctx.fill();
      ctx.fillStyle = '#d8b860';
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.4, 6.4, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx, hy - 3.6, 3.2, 2.4, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9a7a30'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.ellipse(hx, hy - 2.4, 6.4, 1.7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#a8402a'; ctx.fillRect(hx - 3.1, hy - 3.4, 6.2, 0.9);
      break;
    case 'wool': // lumberjack's knitted cap
      ctx.fillStyle = '#8a3a22';
      ctx.beginPath(); ctx.arc(hx - 0.2, hy - 0.9, 3.8, Math.PI, Math.PI * 2); ctx.quadraticCurveTo(hx - 2, hy - 7, hx - 4, hy - 0.9); ctx.fill();
      ctx.fillStyle = '#6a2a16'; ctx.fillRect(hx - 3.9, hy - 1.4, 7.6, 1.3);
      break;
    case 'minercap':
      ctx.fillStyle = '#4a4a50';
      ctx.beginPath(); ctx.arc(hx, hy - 0.8, 3.8, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx, hy - 1.3, 5.6, 1.2);
      ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.arc(hx + 2.4, hy - 2.8, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    case 'felt': // shepherd's hat
      ctx.fillStyle = '#6a5034';
      ctx.beginPath(); ctx.ellipse(hx, hy - 2, 5.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 3, hy - 2); ctx.quadraticCurveTo(hx - 1, hy - 7.5, hx + 3, hy - 2); ctx.fill();
      ctx.strokeStyle = '#3e2c1a'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(hx - 2.8, hy - 2.6); ctx.lineTo(hx + 2.8, hy - 2.6); ctx.stroke();
      break;
    case 'cap':
      ctx.fillStyle = LEATHER;
      ctx.beginPath(); ctx.arc(hx, hy - 0.6, 3.8, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - 3.8, hy - 1, 7.6, 1);
      break;
    case 'hood':
      ctx.fillStyle = '#4c5a2e';
      ctx.beginPath(); ctx.arc(hx - 0.3, hy - 0.2, 4.1, Math.PI * 0.7, Math.PI * 2.15); ctx.lineTo(hx - 4.5, hy + 3); ctx.closePath(); ctx.fill();
      break;
    case 'helm': case 'feather': case 'spike': case 'kettle': case 'crown': {
      const c1 = helm === 'crown' ? GOLD_C : STEEL, c2 = helm === 'crown' ? '#9a7a20' : STEEL_D;
      const g = ctx.createLinearGradient(hx - 4, hy - 4, hx + 4, hy);
      g.addColorStop(0, STEEL_L); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy - 0.4, 3.9, Math.PI, Math.PI * 2); ctx.lineTo(hx + 3.9, hy + 0.4); ctx.lineTo(hx - 3.9, hy + 0.4); ctx.closePath(); ctx.fill();
      if (helm === 'helm' || helm === 'feather') { ctx.fillStyle = c2; ctx.fillRect(hx + 2, hy - 0.5, 1, 3); }
      if (helm === 'kettle') { ctx.fillStyle = c2; ctx.fillRect(hx - 5.4, hy - 0.2, 10.8, 1.2); }
      if (helm === 'spike') { ctx.fillStyle = c2; ctx.beginPath(); ctx.moveTo(hx - 1, hy - 4); ctx.lineTo(hx, hy - 7.5); ctx.lineTo(hx + 1, hy - 4); ctx.fill(); }
      if (helm === 'feather') { ctx.strokeStyle = o.col.main; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy - 4); ctx.quadraticCurveTo(hx - 3, hy - 9, hx - 7, hy - 6); ctx.stroke(); }
      if (helm === 'crown') { ctx.fillStyle = o.col.main; ctx.beginPath(); ctx.moveTo(hx - 2, hy - 4); ctx.lineTo(hx, hy - 8); ctx.lineTo(hx + 2, hy - 4); ctx.fill(); }
      break;
    }
    case 'greathelm': {
      const g = ctx.createLinearGradient(hx - 4, hy, hx + 4, hy);
      g.addColorStop(0, STEEL_L); g.addColorStop(0.6, STEEL); g.addColorStop(1, STEEL_D);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(hx - 3.8, hy + 3.4); ctx.lineTo(hx - 3.8, hy - 2.5); ctx.quadraticCurveTo(hx, hy - 5.6, hx + 3.8, hy - 2.5); ctx.lineTo(hx + 3.8, hy + 3.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2a2e33'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(hx + 0.2, hy - 0.6); ctx.lineTo(hx + 3.8, hy - 0.6); ctx.stroke();
      ctx.strokeStyle = o.col.main; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(hx - 3.6, hy + 1.6); ctx.lineTo(hx + 3.6, hy + 1.6); ctx.stroke();
      break;
    }
    case 'fur':
      ctx.fillStyle = '#6a4a2c';
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.2, 4.6, 2.6, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6844'; ctx.fillRect(hx - 4.6, hy - 2.4, 9.2, 1.8);
      ctx.fillStyle = o.col.main; ctx.beginPath(); ctx.arc(hx, hy - 4.6, 1, 0, Math.PI * 2); ctx.fill();
      break;
    case 'tonsure':
      ctx.fillStyle = '#5a3a1e';
      ctx.beginPath(); ctx.arc(hx, hy - 0.2, 3.7, Math.PI * 0.85, Math.PI * 1.25); ctx.arc(hx, hy - 0.2, 3.7, Math.PI * 1.75, Math.PI * 2.15); ctx.fill();
      break;
  }
}

function torsoPath(ctx, x, y, w = 1) {
  ctx.beginPath();
  ctx.moveTo(x - 3.2 * w, y - 8.5);
  ctx.quadraticCurveTo(x + 0.5, y - 10, x + 4 * w, y - 8.5);
  ctx.lineTo(x + 4.6 * w, y + 1);
  ctx.lineTo(x - 3.6 * w, y + 1);
  ctx.closePath();
}

function drawTorso(ctx, o, x, y) {
  const col = o.col, arm = o.armor || 'none';
  // skirt / tunic hem
  ctx.fillStyle = o.female ? col.main : shade(col.main, 0.9);
  ctx.beginPath();
  ctx.moveTo(x - 3.6, y + 0.5); ctx.lineTo(x + 4.6, y + 0.5);
  ctx.lineTo(x + (o.female ? 6.2 : 5.2), y + (o.female ? 9.5 : 4.2)); ctx.lineTo(x - (o.female ? 4.6 : 4.2), y + (o.female ? 9.5 : 4.2));
  ctx.closePath(); ctx.fill();
  torsoPath(ctx, x, y);
  let fill = col.main;
  if (arm === 'chain') fill = '#9ea3a8';
  else if (arm === 'plate') { const g = ctx.createLinearGradient(x - 3, y - 8, x + 5, y); g.addColorStop(0, STEEL_L); g.addColorStop(0.5, STEEL); g.addColorStop(1, STEEL_D); fill = g; }
  else if (arm === 'gold') { const g = ctx.createLinearGradient(x - 3, y - 8, x + 5, y); g.addColorStop(0, '#fff0b0'); g.addColorStop(0.5, GOLD_C); g.addColorStop(1, '#8a6a1a'); fill = g; }
  else if (arm === 'scale') fill = '#8c8a7a';
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,10,0.45)'; ctx.lineWidth = 0.5; ctx.stroke();
  if (arm === 'chain' || arm === 'scale') {
    ctx.save(); torsoPath(ctx, x, y); ctx.clip();
    ctx.fillStyle = arm === 'chain' ? 'rgba(60,64,70,0.5)' : 'rgba(70,64,40,0.5)';
    for (let yy = y - 9; yy < y + 2; yy += 1.6) for (let xx = x - 4 + ((yy * 2) % 2); xx < x + 5; xx += 1.6) ctx.fillRect(xx, yy, 0.7, 0.7);
    ctx.restore();
  }
  if (arm === 'leather') {
    ctx.save(); torsoPath(ctx, x, y); ctx.clip();
    ctx.fillStyle = LEATHER; ctx.fillRect(x - 4, y - 7, 9, 8);
    ctx.fillStyle = col.main; ctx.fillRect(x - 4, y - 10, 9, 3);
    ctx.restore();
  }
  // tabard in player colour for armoured units
  if (arm === 'chain' || arm === 'plate' || arm === 'gold' || arm === 'scale') {
    ctx.fillStyle = col.main;
    ctx.beginPath(); ctx.moveTo(x - 1.6, y - 8.4); ctx.lineTo(x + 2.6, y - 8.4); ctx.lineTo(x + 3, y + 3.5); ctx.lineTo(x - 1.8, y + 3.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col.light; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x + 0.5, y - 7); ctx.lineTo(x + 0.5, y - 1); ctx.moveTo(x - 1, y - 5); ctx.lineTo(x + 2, y - 5); ctx.stroke();
  }
  if (o.apron) {
    ctx.fillStyle = o.apron;
    ctx.beginPath(); ctx.moveTo(x - 0.2, y - 6); ctx.lineTo(x + 4.4, y - 6); ctx.lineTo(x + 5, y + 4.4); ctx.lineTo(x - 0.8, y + 4.4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
  }
  // belt
  ctx.fillStyle = '#3e2a16'; ctx.fillRect(x - 3.6, y - 0.6, 8.2, 1.3);
  ctx.fillStyle = GOLD_C; ctx.fillRect(x + 0.2, y - 0.6, 1, 1.3);
}

function drawLeg(ctx, hx, hy, a, len, col, boot) {
  const fx = hx + Math.sin(a) * len, fy = hy + Math.cos(a) * len;
  ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.strokeStyle = boot; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(fx - 0.4, fy - 1.6); ctx.lineTo(fx + 1.3, fy); ctx.stroke();
}
function armEnd(sx, sy, a, len = 8) { return [sx + Math.sin(a) * len, sy + Math.cos(a) * len]; }
function drawArm(ctx, sx, sy, hx, hy, sleeve, skin) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = sleeve; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (hx - sx) * 0.7, sy + (hy - sy) * 0.7); ctx.stroke();
  ctx.strokeStyle = skin; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(sx + (hx - sx) * 0.68, sy + (hy - sy) * 0.68); ctx.lineTo(hx, hy); ctx.stroke();
}

function drawCarry(ctx, kind, x, y) {
  switch (kind) {
    case 'wood':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#8a5a30' : '#7a4c26';
        ctx.beginPath(); ctx.ellipse(x - 1, y - 2 + i * 1.8, 5.5, 1.1, -0.15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d8b07a'; ctx.beginPath(); ctx.arc(x + 4.2, y - 2.6 + i * 1.8, 0.9, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'food':
      ctx.fillStyle = '#9a6a2a'; ctx.beginPath(); ctx.ellipse(x, y, 3.8, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(x - 1, y - 2, 1.4, 0, Math.PI * 2); ctx.arc(x + 1.4, y - 1.8, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8c070'; ctx.beginPath(); ctx.arc(x + 0.3, y - 2.6, 1, 0, Math.PI * 2); ctx.fill();
      break;
    case 'gold':
      ctx.fillStyle = '#a08a5a'; ctx.beginPath(); ctx.ellipse(x, y, 3.4, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = GOLD_C; ctx.beginPath(); ctx.arc(x - 0.6, y - 3, 1.4, 0, Math.PI * 2); ctx.arc(x + 1.2, y - 2.6, 1.1, 0, Math.PI * 2); ctx.fill();
      break;
    case 'stone':
      ctx.fillStyle = '#9a9890'; ctx.beginPath(); ctx.moveTo(x - 3.5, y + 2); ctx.lineTo(x - 3, y - 2.5); ctx.lineTo(x + 2, y - 3.5); ctx.lineTo(x + 3.8, y + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c4c2b8'; ctx.beginPath(); ctx.moveTo(x - 3, y - 2.5); ctx.lineTo(x + 2, y - 3.5); ctx.lineTo(x + 0.5, y - 1); ctx.closePath(); ctx.fill();
      break;
  }
}

// Main humanoid renderer (feet at origin, facing right)
function drawHuman(ctx, o) {
  const p = humanPose(o);
  const hipY = -10 + p.bob + p.crouch, hipX = p.lean * 0.4;
  const shY = -18 + p.bob + p.crouch * 1.3, shX = 0.8 + p.lean;
  const legCol = o.legCol || '#5a4630', legDark = shade(legCol, 0.75);
  const boot = '#2e2014';
  const sleeve = (o.armor === 'plate' || o.armor === 'gold') ? STEEL : o.armor === 'chain' ? '#9ea3a8' : o.col.main;
  const sleeveB = shade(sleeve, 0.72);
  if (o.dead) return drawDeadHuman(ctx, o);
  if (!o.noShadow) ellipseShadow(ctx, 0, 0, 7.5, 2.4);
  // cape
  if (o.cape) {
    ctx.fillStyle = o.col.dark;
    ctx.beginPath(); ctx.moveTo(shX - 2.5, shY); ctx.quadraticCurveTo(shX - 8 - p.legF * 2, hipY + 2, shX - 6.5, hipY + 7.5); ctx.lineTo(shX - 1, hipY + 6); ctx.closePath(); ctx.fill();
  }
  // carried bundle on the back (foragers always wear their basket)
  if (o.carry && o.action !== 'gather') drawCarry(ctx, o.carry, shX - 5, shY + 3);
  else if (o.basket) { ctx.fillStyle = '#a07a3a'; ctx.beginPath(); ctx.ellipse(shX - 4.6, shY + 4, 2.6, 3.4, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#6a4a1a'; ctx.lineWidth = 0.5; ctx.stroke(); }
  // front hand position (needed for two-handed grips)
  const fS = [shX + 1.4, shY + 0.6];
  let fH = armEnd(fS[0], fS[1], p.aF, 8);
  if (p.thrust) fH = [fH[0] + p.thrust * 0.6, fH[1]];
  // back arm
  const bS = [shX - 1.2, shY + 0.8];
  let bH = armEnd(bS[0], bS[1], p.aB, 7.5);
  if (p.twoHand && p.wA != null) {
    // second hand further up the haft
    bH = [fH[0] + Math.sin(p.wA) * 2.6, fH[1] + Math.cos(p.wA) * 2.6];
    const d = Math.hypot(bH[0] - bS[0], bH[1] - bS[1]);
    if (d > 8.5) { bH = [bS[0] + (bH[0] - bS[0]) / d * 8.5, bS[1] + (bH[1] - bS[1]) / d * 8.5]; }
  }
  if (p.pluck) bH = [shX - 2.5, shY + 5];
  if (p.style === 'bow' && o.action === 'attack' && !p.released) bH = [shX + 6 - p.draw * 8, shY + 1.5];
  if (p.style === 'xbow' && (o.action === 'attack')) bH = [shX + 4, shY + 3];
  drawArm(ctx, bS[0], bS[1], bH[0], bH[1], sleeveB, shade(o.skin, 0.85));
  // legs
  if (o.robe) {
    ctx.fillStyle = o.robe;
    ctx.beginPath(); ctx.moveTo(shX - 3.6, shY + 1); ctx.lineTo(shX + 4, shY + 1); ctx.lineTo(5.5 + p.legF * 2, -0.5); ctx.lineTo(-4.5 + p.legB * 2, -0.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,10,0.4)'; ctx.lineWidth = 0.5; ctx.stroke();
  } else {
    if (p.crouch > 1) {
      // bent knees: thigh forward, shin back down to the foot
      const kneel = (hx, a, col, k) => {
        const kx = hx + 2.6 * k + Math.sin(a) * 2, ky = hipY + (10 - p.crouch) * 0.45 + 1;
        ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(kx, ky); ctx.lineTo(hx - 0.5 * k, -0.6); ctx.stroke();
        ctx.strokeStyle = boot; ctx.beginPath(); ctx.moveTo(hx - 0.9 * k, -1.4); ctx.lineTo(hx + 0.8, -0.2); ctx.stroke();
      };
      kneel(hipX - 0.6, p.legB, legDark, 0.6);
      kneel(hipX + 0.8, p.legF, legCol, 1);
    } else {
      drawLeg(ctx, hipX - 0.6, hipY, p.legB, 10 - p.crouch * 0.6, legDark, boot);
      drawLeg(ctx, hipX + 0.8, hipY, p.legF, 10 - p.crouch * 0.6, legCol, boot);
    }
  }
  // torso
  if (o.robe) {
    ctx.fillStyle = shade(o.robe, 1.08);
    torsoPath(ctx, shX - 0.3, hipY + p.crouch * 0.2); ctx.fill();
    ctx.strokeStyle = o.col.main; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(shX - 3.4, hipY); ctx.lineTo(shX + 4.2, hipY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shX + 2, hipY); ctx.lineTo(shX + 2.6, hipY + 5); ctx.stroke();
  } else drawTorso(ctx, o, shX - 0.3, hipY);
  // head
  drawHead(ctx, o, shX + 1, shY - 4.4);
  // shield
  if (o.shield) drawShield(ctx, shX + 3.4, shY + 5, o.col, o.shield === 'round' ? 'round' : 'kite');
  // front arm and weapon
  drawArm(ctx, fS[0], fS[1], fH[0], fH[1], sleeve, o.skin);
  const w = o.weapon;
  if (p.style === 'bow') drawBow(ctx, fH[0], fH[1], p.draw, p.released || o.action !== 'attack', w === 'longbow', o.action === 'attack' && !p.released ? bH : null);
  else if (p.style === 'xbow') {
    const cx = fH[0], cy = fH[1];
    ctx.strokeStyle = WOOD_D; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 6, cy + 0.5); ctx.lineTo(cx + 4, cy - 0.5); ctx.stroke();
    ctx.strokeStyle = '#5a5e64'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx + 3, cy - 5); ctx.quadraticCurveTo(cx + 5.5, cy, cx + 3, cy + 4.5); ctx.stroke();
  } else if (p.style === 'throw') {
    if (!(o.action === 'attack' && p.released)) drawWeapon(ctx, w, fH[0], fH[1], o.action === 'attack' ? p.wA : 2.6, o);
  } else if (p.style === 'forage' && o.villager && o.action === 'gather') {
    if (p.pluck) { ctx.fillStyle = '#b8304a'; ctx.beginPath(); ctx.arc(fH[0] + 0.6, fH[1], 1.1, 0, Math.PI * 2); ctx.fill(); }
  } else if (p.style === 'forage') {
    // basket at the hip
    ctx.fillStyle = '#a07a3a'; ctx.beginPath(); ctx.ellipse(shX + 3, hipY + 1, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6a4a1a'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.fillStyle = '#b8304a'; ctx.beginPath(); ctx.arc(shX + 2.4, hipY - 0.6, 0.9, 0, Math.PI * 2); ctx.arc(shX + 3.8, hipY - 0.4, 0.9, 0, Math.PI * 2); ctx.fill();
  } else if (w && w !== 'none') drawWeapon(ctx, w, fH[0], fH[1], p.wA != null ? p.wA : p.aF + 2, o);
  if (o.action === 'pray') {
    ctx.fillStyle = 'rgba(255,240,170,0.35)';
    ctx.beginPath(); ctx.arc(shX + 1, shY - 10, 5 + (o.frame % 2), 0, Math.PI * 2); ctx.fill();
  }
}

function drawDeadHuman(ctx, o) {
  ctx.save();
  ctx.fillStyle = 'rgba(110,10,10,0.45)';
  ctx.beginPath(); ctx.ellipse(-1, -1, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(-2, -2);
  ctx.rotate(-Math.PI / 2 + 0.15);
  ctx.translate(0, 9);
  ctx.scale(0.95, 0.95);
  drawHuman(ctx, { ...o, dead: false, noShadow: true, action: 'idle', frame: 0, weapon: 'none', shield: false, cape: false, carry: null });
  ctx.restore();
}

// ------------------------------------------------------------------ horses
const HORSE_COLS = { bay: ['#7b4a26', '#4f2e15'], grey: ['#a9a8a0', '#76746c'], white: ['#e9e5dc', '#b9b4a8'], black: ['#33291f', '#1c1611'], dun: ['#b48c56', '#7e5e33'] };

function drawHorse(ctx, o) {
  const [hc, hd] = HORSE_COLS[o.horse] || HORSE_COLS.bay;
  const f = o.frame | 0, A = o.action;
  const gallop = A === 'walk';
  const ph = f / 4 * Math.PI * 2;
  const bob = gallop ? -Math.abs(Math.sin(ph)) * 1.4 : 0;
  ellipseShadow(ctx, 0, 0, 14, 3.6);
  const legs = [[8, 1], [5.5, -1], [-6.5, 1], [-9, -1]];
  // far legs first (darker)
  const legAng = (i) => gallop ? Math.sin(ph + (i < 2 ? 0 : Math.PI) + (i % 2) * 0.9) * 0.55 : (A === 'attack' && i < 2 ? -0.25 : 0);
  for (const i of [1, 3]) {
    const [lx] = legs[i], a = legAng(i);
    ctx.strokeStyle = hd; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    const kx = lx + Math.sin(a) * 5, ky = -10 + bob + 5;
    ctx.beginPath(); ctx.moveTo(lx, -11 + bob); ctx.lineTo(kx, ky); ctx.lineTo(kx + Math.sin(a * 0.5) * 5, -0.5); ctx.stroke();
  }
  // tail
  ctx.strokeStyle = hd; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-11, -16 + bob); ctx.quadraticCurveTo(-16, -14 + bob + (gallop ? Math.sin(ph) * 2 : 0), -14.5, -6 + bob); ctx.stroke();
  // body
  const g = ctx.createLinearGradient(0, -20 + bob, 0, -7 + bob);
  g.addColorStop(0, shade(hc, 1.15)); g.addColorStop(1, hd);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(-1, -14 + bob, 11.5, 5.6, 0, 0, Math.PI * 2); ctx.fill();
  // neck and head
  const hb = A === 'attack' ? [0, -2, 1, 0][f % 4] : gallop ? Math.sin(ph) * 1 : 0;
  ctx.beginPath();
  ctx.moveTo(6, -18 + bob); ctx.lineTo(11, -26 + bob + hb); ctx.lineTo(15.5, -24.5 + bob + hb);
  ctx.lineTo(19, -19.5 + bob + hb); ctx.lineTo(17.4, -17.6 + bob + hb); ctx.lineTo(13.5, -19.5 + bob + hb); ctx.lineTo(10.5, -11 + bob);
  ctx.closePath(); ctx.fillStyle = hc; ctx.fill();
  ctx.strokeStyle = 'rgba(20,10,5,0.4)'; ctx.lineWidth = 0.5; ctx.stroke();
  // mane, ear, eye
  ctx.strokeStyle = hd; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(6.5, -19 + bob); ctx.lineTo(11, -26.5 + bob + hb); ctx.stroke();
  ctx.fillStyle = hd; ctx.beginPath(); ctx.moveTo(12, -26 + bob + hb); ctx.lineTo(12.6, -29 + bob + hb); ctx.lineTo(13.8, -25.6 + bob + hb); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillRect(14.2, -23.6 + bob + hb, 1, 1);
  // barding
  if (o.barding) {
    const bc = o.barding === 'scale' ? '#8a887a' : o.col.main;
    ctx.fillStyle = bc;
    ctx.beginPath(); ctx.moveTo(-12, -17 + bob); ctx.quadraticCurveTo(-1, -21 + bob, 9, -17 + bob); ctx.lineTo(10, -8 + bob); ctx.lineTo(-12.5, -8 + bob); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = o.barding === 'scale' ? '#5a584a' : o.col.light; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-12.5, -8.6 + bob); ctx.lineTo(10, -8.6 + bob); ctx.stroke();
    if (o.barding === 'scale') {
      ctx.fillStyle = 'rgba(50,48,40,0.5)';
      for (let yy = -16; yy < -9; yy += 1.6) for (let xx = -11 + (yy % 2); xx < 9; xx += 1.8) ctx.fillRect(xx, yy + bob, 0.8, 0.8);
    } else {
      ctx.fillStyle = o.col.light; ctx.beginPath(); ctx.arc(-2, -12.5 + bob, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    // chanfron
    ctx.fillStyle = STEEL; ctx.beginPath(); ctx.moveTo(11.5, -25 + bob + hb); ctx.lineTo(15.5, -24 + bob + hb); ctx.lineTo(18, -20 + bob + hb); ctx.lineTo(14, -20.5 + bob + hb); ctx.closePath(); ctx.fill();
  } else {
    // saddle blanket in player colour
    ctx.fillStyle = o.col.main;
    ctx.beginPath(); ctx.moveTo(-5, -18.6 + bob); ctx.lineTo(4, -18.6 + bob); ctx.lineTo(4.5, -12 + bob); ctx.lineTo(-5.5, -12 + bob); ctx.closePath(); ctx.fill();
  }
  // near legs
  for (const i of [0, 2]) {
    const [lx] = legs[i], a = legAng(i);
    ctx.strokeStyle = hc; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    const kx = lx + Math.sin(a) * 5, ky = -10 + bob + 5;
    ctx.beginPath(); ctx.moveTo(lx, -11 + bob); ctx.lineTo(kx, ky); ctx.lineTo(kx + Math.sin(a * 0.5) * 5, -0.5); ctx.stroke();
    ctx.fillStyle = '#1a1410'; ctx.fillRect(kx + Math.sin(a * 0.5) * 5 - 1.2, -1.6, 2.4, 1.6);
  }
  return bob;
}

function drawCavalry(ctx, o) {
  if (o.dead) {
    ctx.save();
    ctx.fillStyle = 'rgba(110,10,10,0.4)'; ctx.beginPath(); ctx.ellipse(0, -1, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
    const [hc, hd] = HORSE_COLS[o.horse] || HORSE_COLS.bay;
    ctx.fillStyle = hc; ctx.beginPath(); ctx.ellipse(-1, -5, 12, 4.5, 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hd; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(13, -2); ctx.moveTo(-6, -3); ctx.lineTo(-13, 0); ctx.stroke();
    ctx.fillStyle = hc; ctx.beginPath(); ctx.ellipse(13, -6, 4.5, 2.4, 0.4, 0, Math.PI * 2); ctx.fill();
    if (o.barding) { ctx.fillStyle = o.barding === 'scale' ? '#8a887a' : o.col.main; ctx.beginPath(); ctx.ellipse(-2, -6, 8, 3, 0, Math.PI, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.save(); ctx.translate(-4, -2); ctx.rotate(-Math.PI / 2 + 0.3); ctx.translate(2, 10);
    drawHuman(ctx, { ...o.riderOpts, action: 'idle', frame: 0, weapon: 'none', shield: false, cape: false, noShadow: true });
    ctx.restore();
    return;
  }
  const bob = drawHorse(ctx, o);
  // rider: draw a human whose feet sit at the horse's flank
  ctx.save();
  ctx.translate(-0.5, -10 + bob);
  const ro = { ...o.riderOpts, action: o.action === 'walk' ? 'idle' : o.action, frame: o.frame, mounted: true };
  drawRider(ctx, ro);
  ctx.restore();
}

function drawRider(ctx, o) {
  // seated: one leg hanging along the flank, torso upright
  const p = humanPose(o);
  const legCol = '#4a3a28';
  ctx.strokeStyle = legCol; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(3, -3); ctx.lineTo(2, 1.5); ctx.stroke();
  ctx.strokeStyle = '#2a1c10'; ctx.beginPath(); ctx.moveTo(1.8, 1.4); ctx.lineTo(3.6, 1.6); ctx.stroke();
  const shX = 0.4 + p.lean * 0.6, shY = -16;
  const sleeve = (o.armor === 'plate' || o.armor === 'gold') ? STEEL : o.armor === 'chain' ? '#9ea3a8' : o.col.main;
  if (o.cape) { ctx.fillStyle = o.col.dark; ctx.beginPath(); ctx.moveTo(shX - 2.5, shY); ctx.quadraticCurveTo(shX - 9, shY + 6, shX - 8, shY + 11); ctx.lineTo(shX - 2, shY + 8); ctx.closePath(); ctx.fill(); }
  let bH = armEnd(shX - 1.2, shY + 0.8, p.aB, 7.5);
  if (p.style === 'bow' && o.action === 'attack' && !p.released) bH = [shX + 6 - p.draw * 8, shY + 1.5];
  drawArm(ctx, shX - 1.2, shY + 0.8, bH[0], bH[1], shade(sleeve, 0.72), shade(o.skin, 0.85));
  drawTorso(ctx, o, shX - 0.3, shY + 8);
  drawHead(ctx, o, shX + 1, shY - 4.4);
  if (o.shield) drawShield(ctx, shX + 3, shY + 5, o.col, 'kite');
  let fH = armEnd(shX + 1.4, shY + 0.6, p.aF, 8);
  drawArm(ctx, shX + 1.4, shY + 0.6, fH[0], fH[1], sleeve, o.skin);
  if (p.style === 'bow') drawBow(ctx, fH[0], fH[1], p.draw, p.released || o.action !== 'attack', false, o.action === 'attack' && !p.released ? bH : null);
  else if (o.weapon && o.weapon !== 'none') drawWeapon(ctx, o.weapon, fH[0], fH[1], p.wA != null ? p.wA : p.aF + 2, o);
}

// ------------------------------------------------------------------ siege
function drawRam(ctx, o) {
  const f = o.frame | 0;
  if (o.dead) { drawWreck(ctx, 18); return; }
  ellipseShadow(ctx, 0, 0, 20, 5);
  const wob = o.action === 'walk' ? (f % 2) * 0.6 : 0;
  // wheels (far)
  ctx.fillStyle = WOOD_D;
  ctx.beginPath(); ctx.arc(-9, -4, 4, 0, Math.PI * 2); ctx.arc(9, -4, 4, 0, Math.PI * 2); ctx.fill();
  // ram log
  const push = o.action === 'attack' ? [-4, 0, 5, 2][f % 4] : 0;
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(17 + push, -12); ctx.stroke();
  ctx.fillStyle = '#5a5e64';
  ctx.beginPath(); ctx.moveTo(16 + push, -15); ctx.lineTo(22 + push, -12); ctx.lineTo(16 + push, -9); ctx.closePath(); ctx.fill();
  // housing with sloped roof of hides
  ctx.fillStyle = WOOD;
  ctx.beginPath(); ctx.moveTo(-16, -7 - wob); ctx.lineTo(15, -7 - wob); ctx.lineTo(11, -21 - wob); ctx.lineTo(-12, -21 - wob); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = WOOD_D; ctx.lineWidth = 0.7;
  for (let x = -13; x < 13; x += 4) { ctx.beginPath(); ctx.moveTo(x, -7 - wob); ctx.lineTo(x + 1.2, -21 - wob); ctx.stroke(); }
  const hide = o.capped ? '#6a6e74' : '#b8946a';
  ctx.fillStyle = hide;
  ctx.beginPath(); ctx.moveTo(-14, -20 - wob); ctx.lineTo(13, -20 - wob); ctx.lineTo(4, -28 - wob); ctx.lineTo(-6, -28 - wob); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(40,20,10,0.5)'; ctx.stroke();
  ctx.fillStyle = o.col.main; ctx.fillRect(-8, -26 - wob, 14, 2.4);
  // near wheels
  for (const wx of [-10, 10]) {
    ctx.fillStyle = '#6a4626'; ctx.beginPath(); ctx.arc(wx, -4, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2614'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx - 4, -4); ctx.lineTo(wx + 4, -4); ctx.moveTo(wx, -8); ctx.lineTo(wx, 0); ctx.stroke();
  }
}

function drawMangonel(ctx, o) {
  const f = o.frame | 0;
  if (o.dead) { drawWreck(ctx, 16); return; }
  ellipseShadow(ctx, 0, 0, 18, 4.5);
  ctx.fillStyle = WOOD_D;
  ctx.fillRect(-15, -8, 30, 4);
  ctx.fillStyle = WOOD; ctx.fillRect(-15, -9, 30, 2);
  // uprights
  ctx.fillStyle = WOOD; ctx.fillRect(-3, -22, 3, 14);
  ctx.fillStyle = WOOD_D; ctx.fillRect(1, -20, 2, 12);
  // arm angle: rest -> fire
  const fire = o.action === 'attack' ? [0, 0.6, 1, 0.4][f % 4] : 0;
  const a = lerp(-2.6, -0.4, fire);
  const px = -1, py = -16;
  const ex = px + Math.cos(a) * 18, ey = py + Math.sin(a) * 18;
  ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * 3, py - Math.sin(a) * 3); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
  if (fire < 0.5) { ctx.fillStyle = '#8a8880'; ctx.beginPath(); ctx.arc(ex, ey - 1.5, 2.2, 0, Math.PI * 2); ctx.fill(); }
  // rope / torsion bundle
  ctx.fillStyle = '#c8b080'; ctx.beginPath(); ctx.ellipse(px, py, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  // banner
  flag(ctx, 12, -8, 14, o.col.main, o.col.dark, true, 7, 4);
  for (const wx of [-10, 10]) {
    ctx.fillStyle = '#6a4626'; ctx.beginPath(); ctx.arc(wx, -4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2614'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx - 4, -4); ctx.lineTo(wx + 4, -4); ctx.moveTo(wx, -8); ctx.lineTo(wx, 0); ctx.stroke();
  }
  if (o.onager) { ctx.fillStyle = '#5a5e64'; ctx.fillRect(-15, -9.5, 30, 1); }
}

function drawTrebuchet(ctx, o) {
  const f = o.frame | 0;
  if (o.dead) { drawWreck(ctx, 28); return; }
  ellipseShadow(ctx, 0, 0, 30, 7);
  // base
  ctx.fillStyle = WOOD_D; ctx.fillRect(-28, -8, 56, 5);
  ctx.fillStyle = WOOD; ctx.fillRect(-28, -10, 56, 3);
  // A-frame
  ctx.strokeStyle = WOOD; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-14, -9); ctx.lineTo(0, -58); ctx.lineTo(14, -9); ctx.stroke();
  ctx.strokeStyle = WOOD_D; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-8, -32); ctx.lineTo(8, -32); ctx.stroke();
  // arm
  const fire = o.action === 'attack' ? [0, 0.5, 1, 0.8][f % 4] : 0;
  const a = lerp(Math.PI * 0.8, -Math.PI * 0.42, fire);
  const px = 0, py = -58;
  const lx = px + Math.cos(a) * 46, ly = py + Math.sin(a) * 46;
  const sx = px - Math.cos(a) * 14, sy = py - Math.sin(a) * 14;
  ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lx, ly); ctx.stroke();
  // counterweight
  ctx.fillStyle = '#4a3420'; ctx.fillRect(sx - 7, sy, 14, 12);
  ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 1; ctx.strokeRect(sx - 7, sy, 14, 12);
  ctx.fillStyle = o.col.main; ctx.fillRect(sx - 7, sy + 4, 14, 3);
  // sling
  ctx.strokeStyle = '#c8b080'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + (fire > 0.7 ? 8 : -4), ly + (fire > 0.7 ? -6 : 9)); ctx.stroke();
  if (fire < 0.7) { ctx.fillStyle = '#8a8880'; ctx.beginPath(); ctx.arc(lx - 4, ly + 10, 3.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#e0c060'; ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
  for (const wx of [-20, 20]) {
    ctx.fillStyle = '#6a4626'; ctx.beginPath(); ctx.arc(wx, -4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2614'; ctx.lineWidth = 0.8; ctx.stroke();
  }
}

function drawWreck(ctx, s) {
  ellipseShadow(ctx, 0, 0, s, s * 0.25);
  ctx.strokeStyle = WOOD_D; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  const r = mulberry32(s * 31);
  for (let i = 0; i < 7; i++) {
    const x = (r() - 0.5) * s * 1.4, y = -r() * 5, a = r() * Math.PI, l = 4 + r() * s * 0.5;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 4); ctx.lineTo(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 4); ctx.stroke();
  }
  ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(-s * 0.3, -3, 3.5, 0, Math.PI * 2); ctx.fill();
}

// ------------------------------------------------------------------ animals
function drawSheep(ctx, o) {
  const f = o.frame | 0, walk = o.action === 'walk';
  if (o.dead) { drawCarcass(ctx, 'sheep'); return; }
  ellipseShadow(ctx, 0, 0, 8, 2.4);
  ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 1.4;
  const la = walk ? Math.sin(f / 4 * Math.PI * 2) * 2 : 0;
  ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-4 + la, 0); ctx.moveTo(4, -4); ctx.lineTo(4 - la, 0); ctx.moveTo(-2, -4); ctx.lineTo(-2 - la, 0); ctx.moveTo(2.5, -4); ctx.lineTo(2.5 + la, 0); ctx.stroke();
  ctx.fillStyle = '#ecebe2';
  for (const [x, y, r] of [[-4, -8, 3.6], [0, -9.5, 4], [3.8, -8, 3.4], [-1, -6.5, 3.6], [2.5, -6.4, 3.2]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(160,150,130,0.4)'; ctx.beginPath(); ctx.arc(0, -6, 3, 0, Math.PI); ctx.fill();
  const hb = o.action === 'idle' && f % 2 ? 2 : 0;
  ctx.fillStyle = '#2e2824'; ctx.beginPath(); ctx.ellipse(8, -9 + hb, 2.6, 2, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ecebe2'; ctx.beginPath(); ctx.arc(6.6, -10.5 + hb, 1.4, 0, Math.PI * 2); ctx.fill();
  if (o.col && o.owner) { ctx.fillStyle = o.col.main; ctx.fillRect(-1, -13.5, 3, 1.5); }
}
function drawDeer(ctx, o) {
  const f = o.frame | 0, walk = o.action === 'walk';
  if (o.dead) { drawCarcass(ctx, 'deer'); return; }
  ellipseShadow(ctx, 0, 0, 9, 2.6);
  const ph = f / 4 * Math.PI * 2;
  ctx.strokeStyle = '#6a4424'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  for (const [x, s] of [[-5, 1], [-3.5, -1], [4.5, -1], [6, 1]]) { const a = walk ? Math.sin(ph) * 0.5 * s : 0; ctx.beginPath(); ctx.moveTo(x, -9); ctx.lineTo(x + Math.sin(a) * 9, -0.5); ctx.stroke(); }
  ctx.fillStyle = '#9a6634'; ctx.beginPath(); ctx.ellipse(0.5, -11, 8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2ead8'; ctx.beginPath(); ctx.arc(-7.6, -11.5, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9a6634'; ctx.beginPath(); ctx.moveTo(5, -13); ctx.lineTo(8, -20); ctx.lineTo(10.5, -19); ctx.lineTo(8, -11); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(10.5, -19.5, 3, 1.7, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(9, -21); ctx.lineTo(7, -26); ctx.lineTo(5, -27.5); ctx.moveTo(7.6, -24.5); ctx.lineTo(9.6, -27); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.fillRect(10.8, -20.6, 0.9, 0.9);
}
function drawBoar(ctx, o) {
  const f = o.frame | 0, walk = o.action === 'walk' || o.action === 'attack';
  if (o.dead) { drawCarcass(ctx, 'boar'); return; }
  ellipseShadow(ctx, 0, 0, 10, 3);
  const ph = f / 4 * Math.PI * 2;
  ctx.strokeStyle = '#1e1610'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  for (const [x, s] of [[-5, 1], [-3, -1], [4, -1], [6, 1]]) { const a = walk ? Math.sin(ph) * 0.45 * s : 0; ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x + Math.sin(a) * 5, -0.5); ctx.stroke(); }
  ctx.fillStyle = '#4a3626'; ctx.beginPath(); ctx.ellipse(0, -9, 9.5, 5, 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2a1e14'; ctx.lineWidth = 1.2;
  for (let x = -6; x < 5; x += 2) { ctx.beginPath(); ctx.moveTo(x, -13.5); ctx.lineTo(x + 1, -15.5); ctx.stroke(); }
  const hb = o.action === 'attack' ? [0, 2, 0, -1][f % 4] : 0;
  ctx.fillStyle = '#3e2c1e'; ctx.beginPath(); ctx.moveTo(7, -13 + hb); ctx.lineTo(13, -9 + hb); ctx.lineTo(13, -6 + hb); ctx.lineTo(7, -5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8e0cc'; ctx.beginPath(); ctx.moveTo(11.5, -7 + hb); ctx.lineTo(13, -10 + hb); ctx.lineTo(12.2, -6.4 + hb); ctx.fill();
  ctx.fillStyle = '#d04020'; ctx.fillRect(9.5, -11 + hb, 1, 1);
}
function drawWolf(ctx, o) {
  const f = o.frame | 0, walk = o.action === 'walk' || o.action === 'attack';
  if (o.dead) { drawCarcass(ctx, 'wolf'); return; }
  ellipseShadow(ctx, 0, 0, 9, 2.6);
  const ph = f / 4 * Math.PI * 2;
  ctx.strokeStyle = '#5a5850'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (const [x, s] of [[-5, 1], [-3, -1], [4, -1], [6, 1]]) { const a = walk ? Math.sin(ph) * 0.55 * s : 0; ctx.beginPath(); ctx.moveTo(x, -7); ctx.lineTo(x + Math.sin(a) * 7, -0.5); ctx.stroke(); }
  ctx.strokeStyle = '#7a7870'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-8, -10); ctx.quadraticCurveTo(-13, -10, -14, -5); ctx.stroke();
  ctx.fillStyle = '#86847a'; ctx.beginPath(); ctx.ellipse(0, -10, 8.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  const hb = o.action === 'attack' ? [0, 2, 0, -1][f % 4] : 0;
  ctx.beginPath(); ctx.moveTo(6, -13 + hb); ctx.lineTo(13, -11 + hb); ctx.lineTo(12.5, -8.5 + hb); ctx.lineTo(6, -7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a5850'; ctx.beginPath(); ctx.moveTo(7, -13 + hb); ctx.lineTo(8, -16.5 + hb); ctx.lineTo(9.4, -12.6 + hb); ctx.fill();
  ctx.fillStyle = '#e8d040'; ctx.fillRect(9.6, -12 + hb, 1, 0.9);
}
function drawCarcass(ctx, animal) {
  ctx.fillStyle = 'rgba(120,10,10,0.45)'; ctx.beginPath(); ctx.ellipse(0, -1, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  const col = { sheep: '#e8e6dc', deer: '#9a6634', boar: '#4a3626', wolf: '#86847a' }[animal] || '#9a6634';
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, -3.5, 7.5, 3.2, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b8322a'; ctx.beginPath(); ctx.ellipse(1, -3.5, 4, 1.8, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0d8c8'; ctx.fillRect(-1, -4, 1, 2); ctx.fillRect(1.5, -4.2, 1, 2); ctx.fillRect(3.6, -4, 1, 2);
  ctx.strokeStyle = shade(col, 0.6); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(-9, 0); ctx.moveTo(5, -2); ctx.lineTo(9, -0.5); ctx.stroke();
}

// ------------------------------------------------------------------ villager / monk wrappers
const VIL_TOOLS = { wood: 'woodaxe', gold: 'pick', stone: 'pick', farm: 'hoe', build: 'hammer', forage: 'forage', hunt: 'huntspear', sheep: 'crook' };
// What each job wears: hat, vest/apron, extras
const VIL_OUTFIT = {
  wood:   { helm: 'wool', armor: 'leather' },
  gold:   { helm: 'minercap', apron: '#4e4a44' },
  stone:  { helm: 'minercap', apron: '#6a6660' },
  farm:   { helm: 'straw' },
  forage: { helm: 'scarf', basket: true },
  hunt:   { helm: 'hood' },
  sheep:  { helm: 'felt' },
  build:  { helm: 'cap', apron: '#7a5432' },
};

function villagerOpts(col, variant, task, action, carry) {
  const female = variant >= 2;
  let weapon = task ? VIL_TOOLS[task] || 'none' : 'none';
  // butchering a carcass: kneel with a knife
  if ((task === 'hunt' || task === 'sheep') && action === 'gather') weapon = 'knife';
  // hunters (and shepherds killing sheep) throw spears
  if ((task === 'hunt' || task === 'sheep') && action === 'attack') weapon = 'huntspear';
  if (action === 'idle' || action === 'walk') { if (weapon === 'forage') weapon = 'none'; }
  const fit = VIL_OUTFIT[task] || {};
  return {
    col, skin: SKINS[variant % 4], hair: HAIRS[(variant + 1) % 4], female, beard: !female && variant === 1,
    helm: fit.helm || (female ? (variant === 2 ? 'scarf' : 'none') : 'none'), scarf: '#e8dcc0', legCol: female ? col.main : '#5a4630',
    weapon, action, carry, armor: fit.armor || 'none', apron: fit.apron, basket: fit.basket, villager: true,
  };
}

// ------------------------------------------------------------------ public API
function unitSpriteKey(type, colorIdx, action, frame, extra) { return `${type}|${colorIdx}|${action}|${frame}|${extra || ''}`; }

function getUnitSprite(type, colorIdx, action, frame, extra = '', task = null, carry = null, variant = 0) {
  const key = unitSpriteKey(type, colorIdx, action, frame, extra);
  let s = SPRITES.get(key);
  if (s) return s;
  const def = UNITS[type];
  const spr = def.sprite;
  const dims = BODY_DIMS[spr.body];
  const c = makeCanvas(dims.w * SPR_SCALE, dims.h * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE);
  ctx.translate(dims.ax, dims.ay);
  const col = PLAYER_COLORS[colorIdx] || PLAYER_COLORS[0];
  const dead = action === 'dead';
  const o = { col, action: dead ? 'idle' : action, frame, dead, owner: colorIdx };
  switch (spr.body) {
    case 'villager': drawHuman(ctx, { ...villagerOpts(col, variant, task, action, carry), frame, dead }); break;
    case 'human': drawHuman(ctx, { ...o, skin: SKINS[(variant + 1) % 4], hair: HAIRS[variant % 4], weapon: spr.weapon, armor: spr.armor, helm: spr.helm, shield: spr.shield, cape: spr.cape, legCol: spr.armor === 'plate' ? '#8a9096' : '#4e3e2a', beard: variant === 1 }); break;
    case 'monk': drawHuman(ctx, { ...o, skin: SKINS[variant % 4], hair: '#5a3a1e', helm: 'tonsure', robe: '#7a4e22', weapon: 'staff' }); break;
    case 'horse': {
      const r = spr.rider;
      drawCavalry(ctx, { ...o, horse: spr.horse, barding: spr.barding, riderOpts: { col, skin: SKINS[variant % 4], hair: HAIRS[variant % 4], weapon: r.weapon, armor: r.armor, helm: r.helm, shield: r.shield, cape: r.cape } });
      break;
    }
    case 'ram': drawRam(ctx, { ...o, capped: spr.capped }); break;
    case 'mangonel': drawMangonel(ctx, { ...o, onager: spr.onager }); break;
    case 'trebuchet': drawTrebuchet(ctx, o); break;
    case 'sheep': drawSheep(ctx, o); break;
    case 'deer': drawDeer(ctx, o); break;
    case 'boar': drawBoar(ctx, o); break;
    case 'wolf': drawWolf(ctx, o); break;
  }
  s = { c, w: dims.w, h: dims.h, ax: dims.ax, ay: dims.ay };
  SPRITES.set(key, s);
  return s;
}

function getCarcassSprite(animal) {
  const key = 'carcass|' + animal;
  let s = SPRITES.get(key);
  if (s) return s;
  const c = makeCanvas(36 * SPR_SCALE, 20 * SPR_SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_SCALE, SPR_SCALE); ctx.translate(18, 14);
  drawCarcass(ctx, animal);
  s = { c, w: 36, h: 20, ax: 18, ay: 14 };
  SPRITES.set(key, s);
  return s;
}
