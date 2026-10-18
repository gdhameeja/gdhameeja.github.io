'use strict';
// ============================================================================
//  Command-panel icons, generated once and cached as data URLs.
// ============================================================================

const ICONS = new Map();
const ICON_PX = 96;

function iconCanvas(bgA, bgB) {
  const c = makeCanvas(ICON_PX, ICON_PX);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(ICON_PX * 0.35, ICON_PX * 0.3, 4, ICON_PX / 2, ICON_PX / 2, ICON_PX * 0.75);
  g.addColorStop(0, bgA); g.addColorStop(1, bgB);
  ctx.fillStyle = g; ctx.fillRect(0, 0, ICON_PX, ICON_PX);
  return [c, ctx];
}

function iconUnit(type, colorIdx = 1) {
  const key = 'u|' + type + '|' + colorIdx;
  if (ICONS.has(key)) return ICONS.get(key);
  const [c, ctx] = iconCanvas('#5a6a7a', '#1e262e');
  const s = getUnitSprite(type, colorIdx, 'idle', 0, type === 'villager' ? 'v0' : '', null, null, 0);
  const body = UNITS[type].sprite.body;
  const scale = body === 'trebuchet' ? 0.75 : body === 'horse' || body === 'ram' || body === 'mangonel' ? 1.25 : 1.75;
  const w = s.w * scale, h = s.h * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.c, ICON_PX / 2 - s.ax * scale, ICON_PX * 0.86 - s.ay * scale, w, h);
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

// Villager portrait dressed for a job (lumberjack, farmer, ...)
function iconVillager(task, colorIdx = 1) {
  if (!task) return iconUnit('villager', colorIdx);
  const key = 'vj|' + task + '|' + colorIdx;
  if (ICONS.has(key)) return ICONS.get(key);
  const [c, ctx] = iconCanvas('#5a6a7a', '#1e262e');
  const s = getUnitSprite('villager', colorIdx, 'idle', 0, `v0|${task}|`, task === 'repair' ? 'build' : task, null, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.c, ICON_PX / 2 - s.ax * 1.75, ICON_PX * 0.86 - s.ay * 1.75, s.w * 1.75, s.h * 1.75);
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

function iconBuilding(type, style = 'west', colorIdx = 1) {
  const key = 'b|' + type + '|' + style + '|' + colorIdx;
  if (ICONS.has(key)) return ICONS.get(key);
  const [c, ctx] = iconCanvas('#6a7a5a', '#232a1c');
  const extra = type === 'farm' ? 'f3' : (BUILDINGS[type].wall || BUILDINGS[type].gate) ? '5' : '';
  const s = getBuildingSprite(type, style, colorIdx, 'done', extra);
  const sc = Math.min((ICON_PX - 8) / s.w, (ICON_PX - 8) / s.h) * 1.0;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.c, (ICON_PX - s.w * sc) / 2, (ICON_PX - s.h * sc) / 2 + 2, s.w * sc, s.h * sc);
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

// --------------------------------------------------------------- glyph helpers (in a 96px box)
function G(ctx, fn, col = '#f1e4c2') {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.fillStyle = col;
  fn(ctx);
  ctx.restore();
}
function gSword(ctx, x, y, a = -Math.PI / 4, len = 54) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = '#e6eaee'; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-4, -len); ctx.lineTo(0, -len - 8); ctx.lineTo(4, -len); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9a240'; ctx.fillRect(-12, -2, 24, 6); ctx.strokeRect(-12, -2, 24, 6);
  ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-3, 4, 6, 14); ctx.strokeRect(-3, 4, 6, 14);
  ctx.restore();
}
function gArrow(ctx, x, y, a = -Math.PI / 4, len = 60) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2); ctx.stroke();
  ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#d0d4d8'; ctx.beginPath(); ctx.moveTo(0, -len / 2 - 12); ctx.lineTo(-7, -len / 2 + 2); ctx.lineTo(7, -len / 2 + 2); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.stroke();
  ctx.fillStyle = '#c03a2a'; ctx.beginPath(); ctx.moveTo(0, len / 2 - 10); ctx.lineTo(-7, len / 2 + 2); ctx.lineTo(0, len / 2 - 2); ctx.lineTo(7, len / 2 + 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function gShield(ctx, x, y, s = 1, col = '#7a2e22') {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(20, -24); ctx.quadraticCurveTo(22, 10, 0, 28); ctx.quadraticCurveTo(-22, 10, -20, -24); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#d8c48a'; ctx.stroke();
  ctx.strokeStyle = '#d8c48a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, 20); ctx.moveTo(-14, -6); ctx.lineTo(14, -6); ctx.stroke();
  ctx.restore();
}
function gHorse(ctx, x, y, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-14, 26); ctx.lineTo(-16, 0); ctx.quadraticCurveTo(-14, -22, 4, -28); ctx.lineTo(8, -36); ctx.lineTo(12, -26);
  ctx.quadraticCurveTo(26, -14, 24, -2); ctx.lineTo(16, 0); ctx.lineTo(6, -8); ctx.quadraticCurveTo(2, 8, 14, 26); ctx.closePath();
  ctx.fillStyle = '#e8dcc0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.stroke();
  ctx.fillStyle = '#2a1a0a'; ctx.beginPath(); ctx.arc(8, -16, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-16, -2); ctx.quadraticCurveTo(-10, -22, 4, -27); ctx.stroke();
  ctx.restore();
}
function gPips(ctx, n) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = '#f2d060'; ctx.strokeStyle = 'rgba(20,12,4,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ICON_PX - 12 - i * 13, ICON_PX - 12, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}
function gTool(ctx, kind, x, y, a = -0.7) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -26); ctx.stroke();
  ctx.lineWidth = 5; ctx.strokeStyle = '#a07040'; ctx.stroke();
  ctx.fillStyle = '#d4d8dc'; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (kind === 'axe') { ctx.moveTo(-2, -26); ctx.lineTo(22, -34); ctx.lineTo(22, -10); ctx.lineTo(-2, -16); }
  else if (kind === 'pick') { ctx.moveTo(-30, -18); ctx.quadraticCurveTo(0, -36, 30, -18); ctx.quadraticCurveTo(0, -28, -30, -18); }
  else if (kind === 'hammer') { ctx.rect(-14, -36, 28, 14); }
  else if (kind === 'mace') { ctx.arc(0, -30, 11, 0, Math.PI * 2); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function gText(ctx, t, x, y, size = 30, col = '#f6e7b8') {
  ctx.font = `bold ${size}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,12,4,0.9)'; ctx.strokeText(t, x, y);
  ctx.fillStyle = col; ctx.fillText(t, x, y);
}
function gUpArrow(ctx, x, y, s = 1, col = '#5ad04a') {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(12, 0); ctx.lineTo(5, 0); ctx.lineTo(5, 12); ctx.lineTo(-5, 12); ctx.lineTo(-5, 0); ctx.lineTo(-12, 0); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(10,20,5,0.9)'; ctx.stroke();
  ctx.restore();
}

const TECH_BG = {
  towncenter: ['#8a7a3a', '#2e2810'], mill: ['#5a8a3a', '#1c2c10'], lumbercamp: ['#6a8a3a', '#1c2a10'], miningcamp: ['#7a7a6a', '#262620'],
  blacksmith: ['#9a3a2a', '#2e0e08'], barracks: ['#8a4a3a', '#2a120c'], archeryrange: ['#7a6a3a', '#2a200c'], stable: ['#7a5a3a', '#2a1a0c'],
  siegeworkshop: ['#6a5a4a', '#201a12'], university: ['#3a5a8a', '#0e1a2e'], monastery: ['#6a4a8a', '#1e122e'], castle: ['#5a5a6a', '#18181e'],
};

function iconTech(id) {
  const key = 't|' + id;
  if (ICONS.has(key)) return ICONS.get(key);
  const t = TECHS[id];
  if (t.upgrade) {
    // unit icon with an up arrow
    const img = new Image();
    const [c, ctx] = iconCanvas('#5a7a5a', '#1a2a1a');
    const s = getUnitSprite(t.upgrade[1], 1, 'idle', 0, '', null, null, 0);
    const body = UNITS[t.upgrade[1]].sprite.body;
    const sc = body === 'horse' || body === 'ram' || body === 'mangonel' ? 1.2 : 1.6;
    ctx.drawImage(s.c, ICON_PX / 2 - s.ax * sc, ICON_PX * 0.86 - s.ay * sc, s.w * sc, s.h * sc);
    gUpArrow(ctx, ICON_PX - 16, 18, 1);
    void img;
    const url = c.toDataURL(); ICONS.set(key, url); return url;
  }
  const bg = TECH_BG[t.at] || ['#5a5a5a', '#1a1a1a'];
  const [c, ctx] = iconCanvas(bg[0], bg[1]);
  const C = ICON_PX / 2;
  const ic = t.icon || '';
  const lvl = +(ic.match(/\d$/) || [0])[0];
  const base = ic.replace(/\d$/, '');
  switch (base) {
    case 'age': {
      ctx.fillStyle = '#e8c048'; ctx.strokeStyle = 'rgba(20,12,4,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18, 58); ctx.lineTo(14, 24); ctx.lineTo(32, 40); ctx.lineTo(48, 16); ctx.lineTo(64, 40); ctx.lineTo(82, 24); ctx.lineTo(78, 58); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c02a2a'; ctx.beginPath(); ctx.arc(48, 46, 5, 0, Math.PI * 2); ctx.fill();
      gText(ctx, ['II', 'III', 'IV'][lvl - 1], C, 76, 26);
      break;
    }
    case 'loom': ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(C, C - 4, 24, 0, Math.PI * 2); ctx.stroke(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(C, C - 4); ctx.lineTo(C + Math.cos(a) * 24, C - 4 + Math.sin(a) * 24); ctx.stroke(); } ctx.fillStyle = '#c03a2a'; ctx.fillRect(18, 70, 60, 10); break;
    case 'wheel': ctx.strokeStyle = '#d8b880'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(C, C + 6, 24, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 4; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(C, C + 6); ctx.lineTo(C + Math.cos(a) * 24, C + 6 + Math.sin(a) * 24); ctx.stroke(); } break;
    case 'cart': ctx.fillStyle = '#a07040'; ctx.fillRect(16, 30, 64, 28); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 3; ctx.strokeRect(16, 30, 64, 28); ctx.fillStyle = '#5a3a1a'; for (const x of [30, 66]) { ctx.beginPath(); ctx.arc(x, 64, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.arc(40, 28, 8, 0, Math.PI * 2); ctx.arc(56, 26, 7, 0, Math.PI * 2); ctx.fill(); break;
    case 'eye': ctx.fillStyle = '#f0e8d8'; ctx.beginPath(); ctx.ellipse(C, C, 32, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.9)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#3a6aa8'; ctx.beginPath(); ctx.arc(C, C, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(C, C, 5, 0, Math.PI * 2); ctx.fill(); break;
    case 'collar': ctx.strokeStyle = '#a06a3a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(C, C + 10, 24, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.strokeStyle = '#d8b880'; ctx.lineWidth = 4; ctx.stroke(); break;
    case 'plow': ctx.strokeStyle = '#a07040'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(18, 24); ctx.lineTo(62, 58); ctx.stroke(); ctx.fillStyle = '#d4d8dc'; ctx.beginPath(); ctx.moveTo(56, 52); ctx.quadraticCurveTo(80, 58, 80, 78); ctx.lineTo(60, 66); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.stroke(); break;
    case 'crop': for (let i = 0; i < 5; i++) { const x = 22 + i * 13; ctx.strokeStyle = '#c8a038'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 82); ctx.lineTo(x + 2, 34); ctx.stroke(); ctx.fillStyle = '#e8c850'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x + 2 + (k % 2 ? 4 : -4), 30 + k * 7, 4, 2.5, k % 2 ? 0.6 : -0.6, 0, Math.PI * 2); ctx.fill(); } } break;
    case 'axe': gTool(ctx, 'axe', C, C + 4); break;
    case 'saw': ctx.fillStyle = '#d4d8dc'; ctx.beginPath(); ctx.moveTo(14, 40); ctx.lineTo(82, 40); ctx.lineTo(82, 54); for (let x = 82; x > 14; x -= 8) { ctx.lineTo(x - 4, 62); ctx.lineTo(x - 8, 54); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.fillStyle = '#a07040'; ctx.fillRect(8, 34, 12, 26); ctx.fillRect(76, 34, 12, 26); if (lvl === 2) gText(ctx, '×2', C, 24, 22); break;
    case 'goldpick': case 'stonepick': gTool(ctx, 'pick', C - 6, C + 8, -0.5); ctx.fillStyle = base === 'goldpick' ? '#f2c832' : '#b0aca2'; ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(70, 70, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
    case 'sword': gSword(ctx, C + 2, C + 18, -Math.PI / 5, 48); gPips(ctx, lvl); break;
    case 'arrow': gArrow(ctx, C, C, -Math.PI / 4); gPips(ctx, lvl); break;
    case 'infarmor': gShield(ctx, C, C - 2, 1.15, '#7a2e22'); gPips(ctx, lvl); break;
    case 'cavarmor': gShield(ctx, C + 12, C + 4, 0.8, '#2e4a7a'); gHorse(ctx, C - 14, C - 2, 0.9); gPips(ctx, lvl); break;
    case 'archarmor': gShield(ctx, C + 10, C + 4, 0.85, '#3a6a2a'); gArrow(ctx, C - 10, C - 4, -Math.PI / 4, 44); gPips(ctx, lvl); break;
    case 'horse': gHorse(ctx, C, C + 4, 1.3); break;
    case 'horseshoe': ctx.strokeStyle = '#c4c8cc'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(C, C, 22, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2; ctx.stroke(); break;
    case 'boot': ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.moveTo(30, 16); ctx.lineTo(54, 16); ctx.lineTo(56, 56); ctx.lineTo(82, 64); ctx.lineTo(82, 80); ctx.lineTo(28, 80); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#f0e0b0'; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(10 + i * 4, 40 + i * 10); ctx.lineTo(24, 40 + i * 10); ctx.stroke(); } break;
    case 'ring': ctx.strokeStyle = '#e8c040'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(C, C + 6, 22, 18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#3a8ad0'; ctx.beginPath(); ctx.arc(C, C - 14, 9, 0, Math.PI * 2); ctx.fill(); break;
    case 'brick': for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { const x = 12 + k * 20 + (r % 2 ? 10 : 0), y = 20 + r * 16; if (x > 78) continue; ctx.fillStyle = '#b05a3a'; ctx.fillRect(x, y, 18, 13); ctx.strokeStyle = 'rgba(20,12,4,0.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, 18, 13); } gPips(ctx, lvl === 2 ? 2 : 1); break;
    case 'crane': ctx.strokeStyle = '#a07040'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(30, 86); ctx.lineTo(30, 14); ctx.lineTo(80, 24); ctx.stroke(); ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(72, 24); ctx.lineTo(72, 58); ctx.stroke(); ctx.fillStyle = '#9a9890'; ctx.fillRect(62, 58, 20, 16); break;
    case 'target': for (let i = 4; i > 0; i--) { ctx.fillStyle = i % 2 ? '#f0e0b0' : '#c03020'; ctx.beginPath(); ctx.arc(C, C, i * 9, 0, Math.PI * 2); ctx.fill(); } gArrow(ctx, C + 14, C - 14, Math.PI * 0.75, 40); break;
    case 'tower': ctx.fillStyle = '#b0aa9a'; ctx.fillRect(32, 30, 32, 56); ctx.fillRect(26, 22, 44, 12); for (let i = 0; i < 4; i++) ctx.fillRect(26 + i * 12, 12, 8, 12); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.strokeRect(32, 30, 32, 56); ctx.fillStyle = '#1a1410'; ctx.fillRect(44, 44, 8, 14); gPips(ctx, lvl === 3 ? 2 : 1); break;
    case 'flask': ctx.fillStyle = '#5ac0e0'; ctx.beginPath(); ctx.moveTo(40, 16); ctx.lineTo(56, 16); ctx.lineTo(56, 36); ctx.lineTo(78, 78); ctx.lineTo(18, 78); ctx.lineTo(40, 36); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#e8f8ff'; ctx.beginPath(); ctx.arc(40, 64, 4, 0, Math.PI * 2); ctx.arc(54, 56, 3, 0, Math.PI * 2); ctx.fill(); break;
    case 'gear': ctx.fillStyle = '#b0b4b8'; ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 30 : 22; ctx.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(C, C, 8, 0, Math.PI * 2); ctx.fill(); break;
    case 'cross': ctx.fillStyle = '#e8c040'; ctx.fillRect(42, 14, 12, 70); ctx.fillRect(24, 32, 48, 12); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.strokeRect(42, 14, 12, 70); break;
    case 'mace': gTool(ctx, 'mace', C, C + 6, -0.5); break;
    case 'arrowup': gArrow(ctx, C - 8, C + 4, -Math.PI / 4, 50); gUpArrow(ctx, 72, 24, 1); break;
    default: gText(ctx, t.name.slice(0, 2), C, C);
  }
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

function iconCmd(name) {
  const key = 'c|' + name;
  if (ICONS.has(key)) return ICONS.get(key);
  const [c, ctx] = iconCanvas('#6a6050', '#1e1a14');
  const C = ICON_PX / 2;
  switch (name) {
    case 'stop': ctx.fillStyle = '#b8302a'; ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(C + Math.cos(a) * 32, C + Math.sin(a) * 32); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#f0e0c0'; ctx.lineWidth = 4; ctx.stroke(); gText(ctx, 'STOP', C, C + 1, 20, '#fff'); break;
    case 'attackmove': gSword(ctx, C - 6, C + 22, -Math.PI / 5, 40); ctx.strokeStyle = '#f0d060'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(52, 70); ctx.lineTo(82, 70); ctx.lineTo(74, 62); ctx.moveTo(82, 70); ctx.lineTo(74, 78); ctx.stroke(); break;
    case 'aggressive': gSword(ctx, C - 10, C + 20, -Math.PI / 4.5, 44); gSword(ctx, C + 10, C + 20, Math.PI / 4.5, 44); break;
    case 'defensive': gShield(ctx, C, C, 1.2, '#2e4a7a'); break;
    case 'standground': ctx.fillStyle = '#6a4a2a'; ctx.fillRect(44, 16, 8, 70); ctx.fillStyle = '#c03a2a'; ctx.beginPath(); ctx.moveTo(52, 18); ctx.lineTo(84, 28); ctx.lineTo(52, 40); ctx.fill(); ctx.fillStyle = '#7a6a4a'; ctx.fillRect(24, 80, 48, 8); break;
    case 'noattack': ctx.fillStyle = '#e8d0b0'; ctx.beginPath(); ctx.ellipse(C, C + 10, 18, 22, 0, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 4; i++) { ctx.fillRect(32 + i * 9, 18, 7, 30); } ctx.fillRect(18, 44, 10, 22); ctx.strokeStyle = 'rgba(20,12,4,0.6)'; ctx.lineWidth = 2; ctx.stroke(); break;
    case 'garrison': case 'ungarrison': ctx.fillStyle = '#b0aa9a'; ctx.fillRect(14, 30, 40, 54); for (let i = 0; i < 3; i++) ctx.fillRect(14 + i * 15, 20, 10, 12); ctx.fillStyle = '#1a1410'; ctx.fillRect(26, 58, 16, 26); ctx.strokeStyle = name === 'garrison' ? '#5ad04a' : '#f0a040'; ctx.lineWidth = 7; ctx.beginPath(); if (name === 'garrison') { ctx.moveTo(86, 70); ctx.lineTo(52, 70); ctx.lineTo(62, 60); ctx.moveTo(52, 70); ctx.lineTo(62, 80); } else { ctx.moveTo(48, 70); ctx.lineTo(84, 70); ctx.lineTo(74, 60); ctx.moveTo(84, 70); ctx.lineTo(74, 80); } ctx.stroke(); break;
    case 'delete': ctx.strokeStyle = '#d03a2a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(24, 24); ctx.lineTo(72, 72); ctx.moveTo(72, 24); ctx.lineTo(24, 72); ctx.stroke(); break;
    case 'eco': iconOverlay(ctx, getBuildingSprite('house', 'west', 1, 'done'), 0.62); gTool(ctx, 'hammer', 72, 70, 0.6); break;
    case 'mil': iconOverlay(ctx, getBuildingSprite('barracks', 'west', 1, 'done'), 0.42); gSword(ctx, 74, 86, -0.4, 40); break;
    case 'back': ctx.strokeStyle = '#f0e0c0'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(72, C); ctx.lineTo(28, C); ctx.lineTo(44, C - 16); ctx.moveTo(28, C); ctx.lineTo(44, C + 16); ctx.stroke(); break;
    case 'bell': case 'allclear': ctx.fillStyle = '#d8b040'; ctx.beginPath(); ctx.moveTo(26, 70); ctx.quadraticCurveTo(28, 20, C, 18); ctx.quadraticCurveTo(68, 20, 70, 70); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#6a4a1a'; ctx.beginPath(); ctx.arc(C, 76, 7, 0, Math.PI * 2); ctx.fill(); if (name === 'allclear') { ctx.strokeStyle = '#5ad04a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(56, 64); ctx.lineTo(68, 78); ctx.lineTo(88, 50); ctx.stroke(); } break;
    case 'repair': gTool(ctx, 'hammer', C, C + 6, -0.6); break;
    case 'rally': ctx.fillStyle = '#6a4a2a'; ctx.fillRect(40, 16, 7, 66); ctx.fillStyle = '#2f62d6'; ctx.beginPath(); ctx.moveTo(47, 18); ctx.bezierCurveTo(60, 12, 70, 30, 84, 22); ctx.lineTo(84, 46); ctx.bezierCurveTo(70, 54, 60, 36, 47, 44); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.fillStyle = '#7a6a4a'; ctx.beginPath(); ctx.ellipse(44, 84, 22, 7, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 'reseed': iconOverlay(ctx, getBuildingSprite('farm', 'west', 1, 'done', 'f3'), 0.55); break;
    default:
      if (name.startsWith('buy_') || name.startsWith('sell_')) {
        const r = name.split('_')[1];
        const ic = resIcon(r, 40);
        ctx.drawImage(ic, 12, 12, 56, 56);
        if (name.startsWith('buy')) gUpArrow(ctx, 74, 70, 1.2); else gUpArrow(ctx, 74, 70, -1.2, '#e05a3a');
      } else gText(ctx, name.slice(0, 3), C, C, 22);
  }
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}
function iconOverlay(ctx, s, sc) {
  ctx.drawImage(s.c, (ICON_PX - s.w * sc) / 2 - 6, (ICON_PX - s.h * sc) / 2 - 2, s.w * sc, s.h * sc);
}
