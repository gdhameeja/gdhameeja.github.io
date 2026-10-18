'use strict';
// ============================================================================
//  HUD: resource bar, command grid, selection info, notifications, tooltips,
//  scoreboard. All DOM work is diffed/throttled to keep frames smooth.
// ============================================================================

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A villager is named after its current (or most recent) job, as in AoE II
function villagerJob(u) {
  if (u.order && u.order.type === 'repair') return 'repair';
  if (u.order && u.order.type === 'build') return 'build';
  return u.task || null;
}
function villagerName(u) { const j = villagerJob(u); return j ? VILLAGER_ROLES[j] : 'Villager'; }
const unitName = u => u.isVillager ? villagerName(u) : u.st.name;
const unitIcon = (u, col) => u.isVillager ? iconVillager(villagerJob(u), col) : iconUnit(u.type, col);
const ECO_BUILD = ['house', 'mill', 'lumbercamp', 'miningcamp', 'farm', 'market', 'blacksmith', 'monastery', 'university', 'towncenter', 'wonder'];
const MIL_BUILD = ['barracks', 'archeryrange', 'stable', 'siegeworkshop', 'castle', 'watchtower', 'palisade', 'stonewall', 'gate'];

class UI {
  constructor(app) {
    this.app = app;
    this.resEls = {};
    this.lastInfo = ''; this.lastCmdKey = '';
    this.infoT = 0; this.cmdT = 0; this.scoreT = 0;
    this.cmds = [];
    this.resIcons = {};
    for (const r of [...RES, 'pop']) this.resIcons[r] = resIcon(r, 20).toDataURL();
    this.buildHud();
  }

  buildHud() {
    const hud = $('#hud');
    const resHtml = RES.map(r => `<div class="res" data-tip="${r}"><img src="${this.resIcons[r]}" alt=""><span id="r-${r}">0</span><em id="rv-${r}"></em></div>`).join('');
    $('#topbar').innerHTML = `
      <div class="res-row">${resHtml}
        <div class="res pop" data-tip="pop"><img src="${this.resIcons.pop}" alt=""><span id="r-pop">0/0</span></div>
        <button class="idle-btn" id="idle-vil" title="Select idle villager (.)"><span id="idle-count">0</span> idle</button>
      </div>
      <div class="age-block"><div id="age-label">Dark Age</div><div id="age-prog"></div></div>
      <div class="top-right">
        <span id="clock">00:00</span>
        <select id="speed-sel" title="Game speed (+/-)">
          <option value="1">Slow</option><option value="1.5" selected>Normal</option><option value="2">Fast</option><option value="3">Very fast</option>
        </select>
        <button id="btn-score" title="Scores (F4)">Scores</button>
        <button id="btn-pause" title="Pause (F3)">Pause</button>
        <button id="btn-menu" title="Menu (F10)">Menu</button>
      </div>`;
    $('#bottom').innerHTML = `
      <div id="cmd-wrap"><div id="cmd-title"></div><div id="cmd-grid"></div></div>
      <div id="info"></div>
      <div id="mini-wrap"><canvas id="minimap" width="300" height="160"></canvas>
        <div class="mini-btns">
          <button id="mm-idle-mil" title="Select idle military (,)">Idle army</button>
          <button id="mm-tc" title="Go to Town Center (H)">Town</button>
          <button id="mm-bell" title="Ring town bell">Bell</button>
        </div>
      </div>`;
    for (const r of RES) this.resEls[r] = $('#r-' + r);
    this.popEl = $('#r-pop'); this.clockEl = $('#clock'); this.ageEl = $('#age-label'); this.agePr = $('#age-prog');
    this.idleEl = $('#idle-count');
    this.grid = $('#cmd-grid'); this.info = $('#info'); this.cmdTitle = $('#cmd-title');
    this.tip = $('#tooltip');
    // 15 fixed buttons
    let gh = '';
    for (let i = 0; i < 15; i++) gh += `<button class="cmd" data-slot="${i}"><img alt=""><b class="hk">${GRID_KEYS[i]}</b><i class="badge"></i><s class="prog"></s></button>`;
    this.grid.innerHTML = gh;
    this.btns = [...this.grid.children];
    const hint = document.createElement('div');
    hint.id = 'mode-hint'; hint.hidden = true;
    $('#hud').appendChild(hint);
    this.hintEl = hint;
    // touch toolbar (phones / tablets)
    const tb = document.createElement('div');
    tb.id = 'touchbar';
    tb.innerHTML = `<button data-t="idle" title="Next idle villager">Idle</button><button data-t="army" title="Select idle army">Army</button>
      <button data-t="town" title="Town Center">Town</button><button data-t="clear" title="Clear selection">✕</button>`;
    tb.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const t = b.dataset.t;
      if (t === 'idle') this.app.selectIdle(true); else if (t === 'army') this.app.selectIdle(false);
      else if (t === 'town') this.app.gotoTC(); else { this.app.input.clearMode(); this.app.page = 'main'; this.app.setSelection([]); }
    });
    $('#hud').appendChild(tb);
    // long-press a command button on a touch screen to read its tooltip
    this.grid.addEventListener('touchstart', e => {
      const b = e.target.closest('.cmd'); if (!b) return;
      const c = this.cmds[+b.dataset.slot];
      if (!c) return;
      this.showTip(this.cmdTipHtml(c), b);
      clearTimeout(this.tipT); this.tipT = setTimeout(() => this.hideTip(), 2200);
    }, { passive: true });
    this.grid.addEventListener('click', e => {
      const b = e.target.closest('.cmd'); if (!b) return;
      this.pressSlot(+b.dataset.slot, e.shiftKey, false);
    });
    this.grid.addEventListener('contextmenu', e => {
      e.preventDefault();
      const b = e.target.closest('.cmd'); if (!b) return;
      this.pressSlot(+b.dataset.slot, e.shiftKey, true);
    });
    this.grid.addEventListener('mousemove', e => {
      const b = e.target.closest('.cmd');
      if (!b) { this.hideTip(); return; }
      const c = this.cmds[+b.dataset.slot];
      if (c) this.showTip(this.cmdTipHtml(c), b); else this.hideTip();
    });
    this.grid.addEventListener('mouseleave', () => this.hideTip());
    $('#topbar').addEventListener('mousemove', e => {
      const r = e.target.closest('[data-tip]');
      if (!r) { this.hideTip(); return; }
      this.showTip(this.resTip(r.dataset.tip), r);
    });
    $('#topbar').addEventListener('mouseleave', () => this.hideTip());
    this.info.addEventListener('click', e => this.onInfoClick(e));
    $('#idle-vil').onclick = () => this.app.selectIdle(true);
    $('#mm-idle-mil').onclick = () => this.app.selectIdle(false);
    $('#mm-tc').onclick = () => this.app.gotoTC();
    $('#mm-bell').onclick = () => this.app.ringBell();
    $('#btn-pause').onclick = () => this.app.togglePause();
    $('#btn-menu').onclick = () => this.app.openMenu();
    $('#btn-score').onclick = () => $('#scores').classList.toggle('show');
    $('#speed-sel').onchange = e => { this.app.speed = +e.target.value; e.target.blur(); };
  }

  resTip(r) {
    const g = this.app.game, p = g.players[g.viewer];
    if (r === 'pop') return `<h4>Population</h4><p>${p.pop} of ${p.popCap} housing. Build Houses (+5) to raise the cap, up to ${MAX_POP}.</p>`;
    let gatherers = 0;
    for (const u of g.units) if (u.owner === g.viewer && u.isVillager && u.order && u.order.type === 'gather' && KIND_RES[u.order.kind] === r) gatherers++;
    return `<h4>${r[0].toUpperCase() + r.slice(1)}</h4><p>${gatherers} villager${gatherers === 1 ? '' : 's'} gathering. Total gathered: ${Math.floor(p.st.gathered[r])}.</p>`;
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt) {
    const app = this.app, g = app.game, p = g.players[g.viewer];
    if (!p) return;
    for (const r of RES) {
      const v = String(Math.floor(p.res[r]));
      if (this.resEls[r].textContent !== v) this.resEls[r].textContent = v;
    }
    const pop = `${p.pop}/${p.popCap}`;
    if (this.popEl.textContent !== pop) { this.popEl.textContent = pop; this.popEl.parentElement.classList.toggle('housed', p.pop >= p.popCap && p.popCap < MAX_POP); }
    const clk = fmtTime(g.time);
    if (this.clockEl.textContent !== clk) this.clockEl.textContent = clk;
    if (this.ageEl.textContent !== AGES[p.age]) this.ageEl.textContent = AGES[p.age];
    this.infoT -= dt; this.cmdT -= dt; this.scoreT -= dt;
    if (this.infoT <= 0) {
      this.infoT = 0.2;
      this.renderInfo();
      let idle = 0;
      for (const u of g.units) if (u.owner === g.viewer && u.isVillager && !u.order && !u.garrisonedIn && !u.dead) idle++;
      if (this.idleEl.textContent !== String(idle)) { this.idleEl.textContent = idle; $('#idle-vil').classList.toggle('has', idle > 0); }
      // age-up progress
      let ap = '';
      for (const b of g.buildings) if (b.owner === g.viewer && b.queue.length && b.queue[0].kind === 'tech' && TECHS[b.queue[0].id].ageUp) { const q = b.queue[0]; ap = `Advancing to ${TECHS[q.id].name} — ${Math.floor(q.t / q.total * 100)}%`; }
      if (this.agePr.textContent !== ap) this.agePr.textContent = ap;
    }
    if (this.cmdT <= 0) { this.cmdT = 0.15; this.renderCmds(); }
    // what the next click will do
    const inp = app.input;
    let hint = '';
    if (inp.placing) {
      const d = BUILDINGS[inp.placing];
      hint = d.wall ? `<b>Building ${esc(d.name)}</b> — drag on the map to draw the wall · Shift: keep placing · Right-click or Esc: cancel`
        : `<b>Placing a ${esc(d.name)}</b> — click on the map to build it · Shift: place several · Right-click or Esc: cancel`;
    } else if (inp.mode === 'attackmove') hint = '<b>Attack move</b> — click a destination · Right-click or Esc: cancel';
    else if (inp.mode === 'garrison') hint = '<b>Garrison</b> — click a Town Center, tower or castle · Right-click or Esc: cancel';
    else if (inp.mode === 'rally') hint = '<b>Rally point</b> — click where new units should gather · Right-click or Esc: cancel';
    if (hint && App.isTouch) hint = hint.replace(/ · Right-click or Esc: cancel/g, ' · tap ✕ to cancel').replace(/ · Shift: [^·]*/g, '').replace(/click/g, 'tap').replace(/drag on the map/g, 'drag your finger');
    if (hint !== this.lastHint) { this.lastHint = hint; this.hintEl.innerHTML = hint; this.hintEl.hidden = !hint; }
    if (this.scoreT <= 0) { this.scoreT = 1; this.renderScores(); }
  }

  // ------------------------------------------------------------------ command panel
  ownSel() {
    const g = this.app.game;
    return this.app.sel.filter(e => !e.dead && e.owner === g.viewer && !e.garrisonedIn);
  }

  computeCmds() {
    const app = this.app, g = app.game, p = g.players[g.viewer];
    const sel = this.ownSel();
    const cmds = new Array(15).fill(null);
    let title = '';
    if (!sel.length) return { cmds, title };
    const units = sel.filter(e => e.kind === 'unit');
    const blds = sel.filter(e => e.kind === 'building');
    if (units.length) {
      const vils = units.filter(u => u.isVillager);
      const mil = units.filter(u => !u.isVillager && !u.st.animal);
      if (vils.length && (app.page === 'eco' || app.page === 'mil')) {
        const list = app.page === 'eco' ? ECO_BUILD : MIL_BUILD;
        title = app.page === 'eco' ? 'Build economic' : 'Build military';
        list.forEach((type, i) => {
          const d = BUILDINGS[type];
          const can = g.canBuildType(p.id, type);
          if (!can.ok && d.age > p.age + 1) return;
          const cost = p.buildingCost(type);
          cmds[i] = {
            icon: iconBuilding(type, app.renderer.styles[p.id], p.colorIdx), name: d.name, cost, desc: d.desc + (d.pop ? ` Supports ${d.pop} population.` : ''),
            why: can.ok ? null : can.why, afford: p.canAfford(cost), stats: `HP ${d.hp}`, active: app.input.placing === type,
            run: () => app.input.startPlacing(type),
          };
        });
        cmds[14] = { icon: iconCmd('back'), name: 'Back', key: 'Esc', run: () => { app.page = 'main'; } };
        return { cmds, title };
      }
      if (vils.length) {
        const names = new Set(vils.map(villagerName));
        const one = names.size === 1 ? [...names][0] : 'Villager';
        title = vils.length === units.length ? (vils.length > 1 ? `${vils.length} ${one}s` : one) : `${units.length} units`;
        cmds[0] = { icon: iconCmd('eco'), name: 'Build Economic Building', desc: 'Houses, drop sites, farms, markets…', run: () => { app.page = 'eco'; } };
        cmds[1] = { icon: iconCmd('mil'), name: 'Build Military Building', desc: 'Barracks, ranges, stables, walls, towers…', run: () => { app.page = 'mil'; } };
        cmds[2] = { icon: iconCmd('repair'), name: 'Repair', desc: 'Right-click a damaged building with villagers to repair it.', why: 'Right-click a damaged building', run: () => {} };
        cmds[3] = { icon: iconCmd('garrison'), name: 'Garrison', desc: 'Next left-click on a Town Center, tower or castle garrisons the selection. (Alt + right-click also works.)', run: () => app.input.setMode('garrison') };
      } else if (mil.length) {
        title = units.length > 1 ? `${units.length} units` : units[0].st.name;
        const stance = units[0].stance;
        cmds[0] = { icon: iconCmd('attackmove'), name: 'Attack Move', desc: 'Move to a point, attacking any enemy met on the way. (Ctrl + right-click also works.)', run: () => app.input.setMode('attackmove') };
        cmds[3] = { icon: iconCmd('garrison'), name: 'Garrison', desc: 'Next left-click on a building garrisons the selection. (Alt + right-click also works.)', run: () => app.input.setMode('garrison') };
        const st = (s, n, d) => ({ icon: iconCmd(s), name: n, desc: d, active: stance === s, run: () => g.commandStance(units, s) });
        if (!units.every(u => u.st.monk)) {
          cmds[5] = st('aggressive', 'Aggressive Stance', 'Engage enemies in sight and pursue them.');
          cmds[6] = st('defensive', 'Defensive Stance', 'Engage nearby enemies but return to position.');
          cmds[7] = st('standground', 'Stand Ground', 'Hold position; attack only enemies in range.');
          cmds[8] = st('noattack', 'No Attack', 'Never attack automatically.');
        }
      } else {
        title = units[0].st.name;
      }
      cmds[10] = { icon: iconCmd('stop'), name: 'Stop', run: () => g.commandStop(units) };
      cmds[14] = { icon: iconCmd('delete'), name: 'Delete', key: 'Del', desc: 'Kill the selected units.', run: () => g.commandDelete(units) };
      return { cmds, title };
    }
    // buildings (use the first type; commands apply to all selected of that type)
    const type = blds[0].type;
    const same = blds.filter(b => b.type === type);
    const b0 = same[0];
    const def = b0.def;
    title = same.length > 1 ? `${same.length} × ${def.name}` : def.name;
    let slot = 0;
    if (!b0.built) {
      cmds[14] = { icon: iconCmd('delete'), name: 'Delete foundation', desc: 'Cancel construction.', run: () => g.commandDelete(same) };
      return { cmds, title };
    }
    for (const t0 of def.trains || []) {
      const t = p.resolve(t0);
      const st = p.stats[t];
      if (st.age > p.age + 1) { slot++; continue; }
      const can = g.canTrain(b0, t);
      const cost = p.unitCost(t);
      const queued = same.reduce((s, b) => s + b.queue.filter(q => q.kind === 'unit' && q.type === t).length, 0);
      const bonus = Object.keys(st.bonus || {}).filter(k => st.bonus[k]).map(k => `+${st.bonus[k]} vs ${k}`).join(', ');
      cmds[slot++] = {
        icon: iconUnit(t, p.colorIdx), name: st.name, cost, desc: st.desc, why: can.ok ? null : can.why, afford: p.canAfford(cost), badge: queued || '',
        stats: `HP ${st.hp} · Attack ${st.atk}${st.range ? ` · Range ${st.range}` : ''} · Armor ${st.armor.m}/${st.armor.p}${bonus ? ' · ' + bonus : ''}`,
        run: (shift) => { this.trainOn(same, t0, shift ? 5 : 1); },
        alt: () => { for (const b of same) for (let i = b.queue.length - 1; i >= 0; i--) if (b.queue[i].kind === 'unit' && b.queue[i].type === t) { g.commandCancel(b, i); return; } },
      };
    }
    const techs = Object.keys(TECHS).filter(id => TECHS[id].at === type);
    if (type === 'towncenter') slot = 1;
    for (const id of techs) {
      const t = TECHS[id];
      const can = g.canResearch(b0, id);
      if (can.hidden) {
        // show "researching" state
        const busy = same.find(b => b.queue.some(q => q.kind === 'tech' && q.id === id));
        if (!busy) continue;
      }
      let s = slot;
      if (t.ageUp) s = 4;
      else { while (cmds[s] && s < 14) s++; slot = s + 1; }
      if (s > 13) break;
      const cost = p.techCost(id);
      const busy = same.find(b => b.queue.some(q => q.kind === 'tech' && q.id === id));
      cmds[s] = {
        icon: iconTech(id), name: t.name, cost, desc: t.desc, why: busy ? 'Researching…' : can.why, afford: p.canAfford(cost),
        prog: busy ? busy.queue.find(q => q.id === id) : null,
        run: () => { const b = same.find(b => !b.queue.length) || same[0]; g.commandResearch(b, id); },
      };
    }
    if (type === 'towncenter') {
      cmds[10] = { icon: iconCmd('bell'), name: 'Ring Town Bell', desc: 'All villagers seek shelter in the nearest Town Center, tower or castle.', run: () => app.ringBell() };
      cmds[11] = { icon: iconCmd('allclear'), name: 'All Clear', desc: 'Villagers leave shelter and return to work.', run: () => g.commandAllClear(p.id) };
    }
    if (type === 'market') {
      ['food', 'wood', 'stone'].forEach((r, i) => {
        cmds[5 + i] = { icon: iconCmd('buy_' + r), name: `Buy 100 ${r}`, costTxt: `${g.marketPrice(r, true)} gold`, desc: 'Prices rise with every purchase.', afford: p.res.gold >= g.marketPrice(r, true), run: () => g.commandMarket(p.id, 'buy', r) };
        cmds[10 + i] = { icon: iconCmd('sell_' + r), name: `Sell 100 ${r}`, costTxt: `+${g.marketPrice(r, false)} gold`, desc: 'Prices fall with every sale.', afford: p.res[r] >= 100, run: () => g.commandMarket(p.id, 'sell', r) };
      });
    }
    if (type === 'farm') {
      cmds[0] = { icon: iconCmd('reseed'), name: `Auto-reseed: ${p.autoReseed === false ? 'Off' : 'On'}`, desc: 'Exhausted farms are rebuilt automatically for 60 wood.', active: p.autoReseed !== false, run: () => { p.autoReseed = p.autoReseed === false; } };
    }
    if (def.trains || def.garrison) cmds[12] = { icon: iconCmd('rally'), name: 'Set Rally Point', key: 'C', desc: 'Choose where new units gather (a resource sends villagers straight to work). Right-click the map also sets it.', active: app.input.mode === 'rally', run: () => app.input.setMode('rally') };
    if (def.garrison && same.some(b => b.garrison.length)) cmds[13] = { icon: iconCmd('ungarrison'), name: 'Ungarrison', desc: 'Release all garrisoned units.', run: () => same.forEach(b => g.commandUngarrison(b)) };
    cmds[14] = { icon: iconCmd('delete'), name: 'Delete', key: 'Del', desc: 'Destroy this building.', run: () => app.askDelete(same) };
    return { cmds, title };
  }

  trainOn(blds, type, count) {
    const g = this.app.game;
    for (let i = 0; i < count; i++) {
      const b = blds.slice().sort((a, b) => a.queue.length - b.queue.length)[0];
      if (!g.commandTrain(b, type, 1)) break;
    }
  }

  renderCmds() {
    const { cmds, title } = this.computeCmds();
    this.cmds = cmds;
    if (this.cmdTitle.textContent !== title) this.cmdTitle.textContent = title;
    for (let i = 0; i < 15; i++) {
      const b = this.btns[i], c = cmds[i];
      if (!c) { if (!b.classList.contains('empty')) { b.className = 'cmd empty'; b.querySelector('img').removeAttribute('src'); } continue; }
      const img = b.querySelector('img');
      if (img.getAttribute('src') !== c.icon) img.src = c.icon;
      const dis = !!c.why || c.afford === false;
      const cls = 'cmd' + (dis ? ' dis' : '') + (c.active ? ' active' : '') + (c.why ? ' locked' : '');
      if (b.className !== cls) b.className = cls;
      const badge = b.querySelector('.badge');
      const bt = c.badge ? String(c.badge) : '';
      if (badge.textContent !== bt) badge.textContent = bt;
      const pr = b.querySelector('.prog');
      const pw = c.prog ? Math.floor(c.prog.t / c.prog.total * 100) + '%' : '0%';
      if (pr.style.width !== pw) pr.style.width = pw;
    }
  }

  pressSlot(i, shift, right) {
    const c = this.cmds[i];
    if (!c) return;
    const btn = this.btns[i];
    btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
    clearTimeout(btn._pt); btn._pt = setTimeout(() => btn.classList.remove('pressed'), 220);
    if (right && c.alt) { c.alt(); this.app.audio.play('click'); this.cmdT = 0; return; }
    if (c.why && !c.prog && c.name !== 'Repair') { this.notify(c.why, 'warn'); this.app.audio.play('error'); return; }
    c.run(shift);
    this.app.audio.play('click');
    this.cmdT = 0;
  }

  cmdTipHtml(c) {
    let h = `<h4>${esc(c.name)} <kbd>${esc(c.key || GRID_KEYS[this.cmds.indexOf(c)])}</kbd></h4>`;
    if (c.cost) {
      const p = this.app.game.players[this.app.game.viewer];
      h += '<div class="cost">' + RES.filter(r => c.cost[r]).map(r => `<span class="${p.res[r] < c.cost[r] ? 'short' : ''}"><img src="${this.resIcons[r]}">${c.cost[r]}</span>`).join('') + '</div>';
    }
    if (c.costTxt) h += `<div class="cost"><span><img src="${this.resIcons.gold}">${esc(c.costTxt)}</span></div>`;
    if (c.desc) h += `<p>${esc(c.desc)}</p>`;
    if (c.stats) h += `<p class="stats">${esc(c.stats)}</p>`;
    if (c.why) h += `<p class="why">${esc(c.why)}</p>`;
    if (c.alt) h += `<p class="hint">Shift-click queues 5 · right-click removes one</p>`;
    return h;
  }

  showTip(html, anchor) {
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html;
    this.tip.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const tr = this.tip.getBoundingClientRect();
    let x = r.left, y = r.top - tr.height - 8;
    if (y < 4) y = r.bottom + 8;
    x = clamp(x, 6, window.innerWidth - tr.width - 6);
    this.tip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
  hideTip() { this.tip.classList.remove('show'); }

  // ------------------------------------------------------------------ info panel
  renderInfo() {
    const app = this.app, g = app.game;
    const sel = app.sel.filter(e => !e.dead && !(e.kind === 'unit' && e.garrisonedIn));
    if (sel.length !== app.sel.length) app.setSelection(sel);
    let html = '';
    if (!sel.length) html = this.emptyInfo();
    else if (sel.length === 1) html = this.singleInfo(sel[0]);
    else html = this.multiInfo(sel);
    if (html !== this.lastInfo) { this.info.innerHTML = html; this.lastInfo = html; this.info.classList.toggle('empty', !sel.length); }
  }

  emptyInfo() {
    const g = this.app.game, p = g.players[g.viewer];
    const civ = p.civ;
    return `<div class="info-empty"><div class="civ-name">${esc(p.name)} — ${esc(civ.name)}</div>
      <ul>${civ.bonuses.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  }

  hpBar(f, txt) {
    const col = f > 0.5 ? '#4caf3a' : f > 0.25 ? '#d8b42a' : '#d0402a';
    return `<div class="hp"><div style="width:${(clamp(f, 0, 1) * 100).toFixed(1)}%;background:${col}"></div><span>${txt}</span></div>`;
  }

  singleInfo(e) {
    const g = this.app.game;
    const own = e.owner === g.viewer;
    const pl = g.players[e.owner];
    const owner = e.owner ? `<span class="owner" style="color:${pl.color.light}">${esc(pl.name)}${pl.civ ? ' · ' + esc(pl.civ.name) : ''}</span>` : '';
    if (e.kind === 'resource') {
      const icon = RESOURCES[e.type].res;
      return `<div class="info-single"><div class="portrait res-portrait"><img src="${this.resIcons[icon]}"></div>
        <div class="meta"><div class="name">${esc(e.type === 'carcass' ? UNITS[e.animal].name + ' (carcass)' : RESOURCES[e.type].name)}</div>
        <div class="big-amount"><img src="${this.resIcons[icon]}">${Math.ceil(e.amount)} ${icon}</div></div></div>`;
    }
    if (e.kind === 'unit') {
      const st = e.st;
      const icon = unitIcon(e, pl.colorIdx);
      let status = '';
      if (e.isVillager) {
        const o = e.order;
        const doing = !o ? 'Idle' : o.type === 'gather' ? (o.phase === 'drop' ? 'Returning to drop off' : 'Working') : o.type === 'dropoff' ? 'Returning to drop off' : o.type === 'build' ? 'Constructing' : o.type === 'repair' ? 'Repairing' : o.type === 'garrison' ? 'Seeking shelter' : 'Moving';
        status = `Villager · ${doing}${e.carry >= 1 ? ` · carrying ${Math.floor(e.carry)} ${e.carryType}` : ''}`;
      } else if (st.monk) status = `Faith ${Math.floor(e.faith)}%`;
      else if (!st.animal) status = { aggressive: 'Aggressive', defensive: 'Defensive', standground: 'Standing ground', noattack: 'No attack' }[e.stance];
      if (st.animal && st.food) status = `${st.food} food`;
      const bonus = Object.keys(st.bonus || {}).filter(k => st.bonus[k]).map(k => `+${st.bonus[k]} vs ${k}`).join(', ');
      const stats = st.animal ? '' : `<div class="stats">
        <span><b>Attack</b>${st.atk}${st.atkType === 'pierce' ? ' pierce' : ''}</span>
        <span title="Melee / pierce armor"><b>Armor</b>${st.armor.m}/${st.armor.p}</span>
        ${st.range ? `<span><b>Range</b>${st.range}${st.minRange ? ` (min ${st.minRange})` : ''}</span>` : ''}
        <span><b>Speed</b>${st.speed.toFixed(2)}</span><span><b>Sight</b>${st.los}</span></div>
        ${bonus ? `<div class="bonus">${esc(bonus)}</div>` : ''}`;
      return `<div class="info-single"><div class="portrait"><img src="${icon}"></div>
        <div class="meta"><div class="name">${esc(unitName(e))} ${owner}</div>
        ${this.hpBar(e.hp / st.hp, `${Math.ceil(e.hp)}/${st.hp}`)}
        ${stats}<div class="status">${esc(status || '')}</div></div></div>`;
    }
    // building
    const d = e.def;
    const icon = iconBuilding(e.type, this.app.renderer.styles[e.owner] || 'west', pl.colorIdx);
    let extra = '';
    if (!e.built) extra = `<div class="status">Under construction — ${Math.floor(e.progress * 100)}%</div>`;
    else if (e.type === 'farm') extra = `<div class="status">${Math.ceil(e.food)} food remaining${e.farmer && g.ents.get(e.farmer) ? ' · being farmed' : ''}</div>`;
    else if (e.type === 'wonder') { const left = Math.max(0, 300 - (g.time - e.builtAt)); extra = `<div class="status wonder">Victory in ${fmtTime(left)}</div>`; }
    if (d.garrison && e.built) extra += `<div class="status">Garrison ${e.garrison.length}/${d.garrison}</div>`;
    if (d.pop && e.built) extra += `<div class="status">Houses ${d.pop} population</div>`;
    if (d.atk && e.built) {
      const p = g.players[e.owner];
      extra += `<div class="stats"><span><b>Attack</b>${d.atk + p.mods.towerAtk + (e.type === 'watchtower' ? p.mods.towerAtkT : 0)}</span><span><b>Range</b>${d.range + p.mods.towerRange}</span><span><b>Armor</b>${d.armor.m + p.mods.buildingArmor}/${d.armor.p + p.mods.buildingArmor}</span><span><b>Arrows</b>${d.arrows + e.garrison.length}</span></div>`;
    }
    let queue = '';
    if (own && e.queue.length) {
      const q0 = e.queue[0];
      const qIcon = q => q.kind === 'unit' ? iconUnit(q.type, pl.colorIdx) : iconTech(q.id);
      const qName = q => q.kind === 'unit' ? UNITS[q.type].name : TECHS[q.id].name;
      queue = `<div class="queue"><div class="q-main" data-q="0" title="Click to cancel"><img src="${qIcon(q0)}"><div><div class="q-name">${esc(qName(q0))}${q0.housed ? ' <em>(need houses)</em>' : ''}</div>
        <div class="q-bar"><div style="width:${(q0.t / q0.total * 100).toFixed(1)}%"></div></div></div></div>
        <div class="q-rest">${e.queue.slice(1).map((q, i) => `<img data-q="${i + 1}" src="${qIcon(q)}" title="${esc(qName(q))} — click to cancel">`).join('')}</div></div>`;
    }
    return `<div class="info-single"><div class="portrait"><img src="${icon}"></div>
      <div class="meta"><div class="name">${esc(d.name)} ${owner}</div>
      ${this.hpBar(e.hp / e.maxHp, `${Math.ceil(e.hp)}/${e.maxHp}`)}${extra}</div>${queue}</div>`;
  }

  multiInfo(sel) {
    const g = this.app.game;
    const shown = sel.slice(0, 60);
    return `<div class="info-multi">${shown.map((e, i) => {
      const pl = g.players[e.owner];
      const icon = e.kind === 'unit' ? unitIcon(e, pl.colorIdx) : iconBuilding(e.type, this.app.renderer.styles[e.owner] || 'west', pl.colorIdx);
      const title = e.kind === 'unit' ? unitName(e) : e.def.name;
      const f = e.kind === 'unit' ? e.hp / e.st.hp : e.hp / e.maxHp;
      return `<div class="mini" data-i="${i}" title="${esc(title)}"><img src="${icon}"><i style="width:${(f * 100).toFixed(0)}%;background:${f > 0.5 ? '#4caf3a' : f > 0.25 ? '#d8b42a' : '#d0402a'}"></i></div>`;
    }).join('')}${sel.length > 60 ? `<div class="more">+${sel.length - 60}</div>` : ''}</div>`;
  }

  onInfoClick(e) {
    const app = this.app, g = app.game;
    const q = e.target.closest('[data-q]');
    if (q) {
      const b = app.sel[0];
      if (b && b.kind === 'building' && b.owner === g.viewer) { g.commandCancel(b, +q.dataset.q); app.audio.play('click'); this.infoT = 0; }
      return;
    }
    const m = e.target.closest('.mini');
    if (m) {
      const ent = app.sel[+m.dataset.i];
      if (!ent) return;
      if (e.shiftKey) app.setSelection(app.sel.filter(x => x !== ent));
      else if (e.ctrlKey) app.setSelection(app.sel.filter(x => x.type === ent.type));
      else app.setSelection([ent]);
    }
  }

  // ------------------------------------------------------------------ notifications & scores
  notify(text, kind = 'info') {
    const box = $('#notices');
    const last = box.lastElementChild;
    if (last && last.dataset.text === text && Date.now() - +last.dataset.t < 2500) return;
    const d = document.createElement('div');
    d.className = 'notice ' + kind;
    d.textContent = text;
    d.dataset.text = text; d.dataset.t = Date.now();
    box.appendChild(d);
    while (box.children.length > 6) box.firstElementChild.remove();
    setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 600); }, kind === 'alert' ? 6000 : 4200);
  }

  score(p) {
    const s = p.st, g = s.gathered;
    return Math.round((g.food + g.wood + g.gold + g.stone) / 10 + s.kills * 6 + s.razed * 30 + s.techs * 12 + p.age * 120 + s.converted * 10);
  }

  renderScores() {
    const g = this.app.game;
    const rows = g.players.slice(1).map(p => ({ p, s: this.score(p) })).sort((a, b) => b.s - a.s);
    const html = `<h4>Scores</h4>` + rows.map(({ p, s }) => `<div class="sc-row ${p.alive ? '' : 'dead'}"><i style="background:${p.color.main}"></i><span>${esc(p.name)}</span><em>${AGES[p.age].split(' ')[0]}</em><b>${s}</b></div>`).join('');
    const el = $('#scores');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}
