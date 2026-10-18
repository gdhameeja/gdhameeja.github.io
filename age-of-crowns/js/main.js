'use strict';
// ============================================================================
//  Application shell: menus, game lifecycle, main loop, selection & commands.
// ============================================================================

const AI_NAMES = {
  britons: ['Alfred the Great', 'Æthelflæd', 'Edward Longshanks', 'Boudica'],
  franks: ['Charlemagne', 'Clovis', 'Charles Martel', 'Joan of Arc'],
  mongols: ['Genghis Khan', 'Subutai', 'Kublai Khan', 'Jebe'],
  byzantines: ['Justinian', 'Basil II', 'Theodora', 'Belisarius'],
};

function loadSettings() {
  const def = { sfx: 0.55, music: 0.22, musicOn: true, edge: true, hp: 'damaged', hidpi: false, fps: false, scroll: 900, gfx: '' };
  try { return { ...def, ...JSON.parse(localStorage.getItem('aoc-settings') || '{}') }; } catch (e) { return def; }
}
function saveSettings(s) { try { localStorage.setItem('aoc-settings', JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

const App = {
  screen: 'menu',
  isTouch: (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0),
  game: null, renderer: null, minimap: null, ui: null, input: null,
  audio: new Sound(),
  sel: [], groups: {}, page: 'main', speed: 1.5, paused: false,
  acc: 0, lastT: 0, mmT: 0, fps: 60, fpsAcc: 0, fpsN: 0,
  idleIdx: 0, tcIdx: 0,
  settings: loadSettings(),
  setup: {
    name: 'You', civ: 'britons', color: 1, map: 'arabia', size: 'small',
    opponents: [{ civ: 'random', difficulty: 'normal', team: 2 }, { civ: 'random', difficulty: 'normal', team: 3 }],
    startRes: 'standard', reveal: 'normal', speed: 1.5,
  },

  init() {
    this.audio.setVolumes(this.settings.sfx, this.settings.music);
    this.audio.musicOn = this.settings.musicOn;
    buildTerrainTextures();
    if (this.isTouch) document.body.classList.add('touch');
    this.resize();
    Menu.init(this);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerdown', () => this.audio.init(), { once: false });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'game' && !this.paused) this.togglePause(true); });
    requestAnimationFrame(t => { this.lastT = t; this.loop(t); });
  },

  resize() {
    // compact layout for short landscape screens (phones held sideways)
    document.body.classList.toggle('compact', window.innerHeight <= 560 && window.innerWidth > window.innerHeight);
    if (!this.renderer) return;
    const dpr = this.renderer.is3D || this.settings.hidpi ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
  },

  // ------------------------------------------------------------------ game lifecycle
  startGame() {
    const s = this.setup;
    const used = new Set([s.color]);
    const freeColor = () => { for (let c = 1; c < PLAYER_COLORS.length; c++) if (!used.has(c)) { used.add(c); return c; } return 8; };
    const players = [{ name: s.name || 'You', civ: s.civ === 'random' ? CIV_IDS[Math.floor(Math.random() * 4)] : s.civ, human: true, color: s.color, team: 1 }];
    const usedNames = new Set();
    for (const o of s.opponents) {
      const civ = o.civ === 'random' ? CIV_IDS[Math.floor(Math.random() * 4)] : o.civ;
      const names = AI_NAMES[civ].filter(n => !usedNames.has(n));
      const name = names[Math.floor(Math.random() * names.length)] || 'Rival';
      usedNames.add(name);
      players.push({ name, civ, ai: true, difficulty: o.difficulty, color: freeColor(), team: o.team });
    }
    const map = s.map === 'random' ? Object.keys(MAPS)[Math.floor(Math.random() * 6)] : s.map;
    const seed = (Math.random() * 1e9) | 0;
    this.lastSeed = seed;
    const t0 = performance.now();
    const game = new Game({ map, size: s.size, players, seed, startRes: s.startRes, reveal: s.reveal === 'explored' ? true : s.reveal === 'all' ? 'all' : false });
    if (s.reveal === 'explored' || s.reveal === 'all') game.explored.fill(1);
    console.log(`Map generated in ${(performance.now() - t0).toFixed(0)} ms`);
    this.game = game;
    this.mapName = MAPS[map].name;
    this.sel = []; this.groups = {}; this.page = 'main'; this.speed = s.speed; this.paused = false; this.acc = 0;
    document.getElementById('menu').hidden = true;
    document.getElementById('endscreen').hidden = true;
    document.getElementById('pause').hidden = true;
    document.getElementById('game').hidden = false;
    // fresh map canvas each game (a canvas can't switch between 2D and WebGL contexts)
    const old = document.getElementById('view');
    const cv = document.createElement('canvas');
    cv.id = 'view';
    old.replaceWith(cv);
    if (this.renderer && this.renderer.dispose) this.renderer.dispose();
    const gfx = this.settings.gfx || (this.isTouch ? 'medium' : 'high');
    this.renderer = null;
    if (gfx !== '2d' && typeof THREE !== 'undefined' && webglAvailable()) {
      try { this.renderer = new Renderer3D(cv, game, gfx); }
      catch (err) { console.warn('3D renderer unavailable, using 2D', err); this.renderer = null; }
    }
    if (!this.renderer) {
      const ov = document.getElementById('overlay2d'); if (ov) ov.hidden = true;
      const c2 = document.getElementById('view');
      const fresh = document.createElement('canvas'); fresh.id = 'view'; c2.replaceWith(fresh);
      this.renderer = new Renderer(fresh, game);
    }
    this.renderer.showHp = this.settings.hp;
    this.resize();
    this.ui = new UI(this);
    this.minimap = new Minimap(document.getElementById('minimap'), game, this.renderer);
    if (this.input) { this.input.app = this; this.input.bindCanvas(this.renderer.cv); this.input.bindMinimap(); } else this.input = new Input(this);
    this.input.edgeScroll = this.settings.edge;
    this.input.scrollSpeed = this.settings.scroll;
    this.input.clearMode();
    document.getElementById('speed-sel').value = String(this.speed);
    const tc = game.ents.get(game.players[game.viewer].startTC);
    this.renderer.cam.zoom = this.renderer.is3D ? (window.innerHeight < 560 ? 0.72 : 1.0) : 1.15;
    if (tc) { this.renderer.centerOn(tc.x + 1, tc.y + 1); }
    this.audio.listener = (x, y) => {
      const r = this.renderer, c = r.screenToTile(r.vw / 2, r.vh / 2);
      const d = Math.hypot(x - c.x, y - c.y) * r.cam.zoom;
      return clamp(1.15 - d / 22, 0, 1);
    };
    this.hookEvents();
    this.screen = 'game';
    this.ui.notify(`${this.mapName} — ${game.players.length - 1} players. Gather resources, grow your town and advance through the ages.`, 'info');
    if (this.isTouch) {
      this.ui.notify('Touch: tap to select, then tap a tree, bush or sheep to gather. Drag to scroll, pinch to zoom, long-press and drag to select a group.', 'tip');
      if (window.innerHeight > window.innerWidth) this.ui.notify('Turn your phone sideways for a bigger view of the battlefield.', 'warn');
    } else this.ui.notify(`Tip: select villagers and right-click trees, berries or sheep to gather. Build Houses to grow beyond ${game.players[game.viewer].popCap} population.`, 'tip');
  },

  hookEvents() {
    const g = this.game, ui = this.ui, A = this.audio, R = this.renderer, me = g.viewer;
    const meP = g.players[me];
    let housedT = -99;
    g.on('notify', (pid, text, kind) => { if (pid === me || pid === 0) ui.notify(text, kind); });
    g.on('cantAfford', (pid, missing) => { if (pid === me) this.cantAfford(missing); });
    g.on('attacked', (pid, ent) => {
      if (pid !== me) return;
      const onScreen = A.listener && A.listener(ent.x, ent.y) > 0.6;
      if (!onScreen) { ui.notify(ent.kind === 'building' ? `Your ${ent.def.name} is under attack!` : 'You are under attack!', 'alert'); A.play('attacked'); }
      this.minimap.ping(ent.x, ent.y);
      this.lastAlert = { x: ent.x, y: ent.y };
    });
    g.on('age', (p, age) => {
      if (p.id === me) { ui.notify(`Your people have advanced to the ${AGES[age]}!`, 'good'); A.play('age'); }
      else if (meP.isEnemy(p.id) || true) ui.notify(`${p.name} (${p.civ.name}) has advanced to the ${AGES[age]}.`, 'info');
    });
    g.on('researched', (p, id) => { if (p.id === me) { ui.notify(`${TECHS[id].name} researched.`, 'good'); A.play('research'); } });
    g.on('built', b => {
      if (b.owner !== me) return;
      if (b.type === 'farm' || b.def.wall) return;
      A.playAt('built', b.x, b.y);
      if (['towncenter', 'castle', 'wonder', 'market', 'university', 'monastery', 'siegeworkshop', 'blacksmith'].includes(b.type)) ui.notify(`${b.def.name} completed.`, 'good');
      if (b.type === 'wonder') { for (const p of g.players.slice(1)) if (p.id !== me) ui.notify(`Your Wonder stands! Defend it for 5 minutes to win.`, 'good'); }
    });
    g.on('placed', b => { if (b.owner === me) A.play('place'); else if (b.type === 'wonder') ui.notify(`${g.players[b.owner].name} has begun building a Wonder!`, 'alert'); });
    g.on('trained', (u, b) => { if (u.owner === me) A.playAt('trained', b.x, b.y); });
    g.on('housed', (p) => { if (p.id === me && g.time - housedT > 12) { housedT = g.time; ui.notify('You need to build more Houses.', 'warn'); A.play('error'); } });
    g.on('defeated', p => {
      ui.notify(`${p.name} has been defeated.`, p.id === me ? 'alert' : 'info');
      if (p.id === me && !g.over) { A.play('defeat'); setTimeout(() => this.showEnd(false, 'Your civilization has fallen.'), 1500); }
    });
    g.on('gameover', (team, how) => {
      const won = team === meP.team;
      A.play(won ? 'victory' : 'defeat');
      setTimeout(() => this.showEnd(won, how === 'wonder' ? (won ? 'Your Wonder has stood the test of time.' : 'A rival Wonder has outlasted you.') : won ? 'All your enemies have been conquered.' : 'Your civilization has fallen.'), 1200);
    });
    g.on('converted', (u, from, to) => {
      if (from === me) ui.notify(`One of your ${u.st.name}s has been converted!`, 'alert');
      else if (to === me) ui.notify(`Your monk converted an enemy ${u.st.name}.`, 'good');
    });
    g.on('died', e => { if (e.selected) e.selected = false; });
    g.on('sfx', (name, x, y) => {
      if (x || y) {
        const v = A.listener ? A.listener(x, y) : 0;
        if (v > 0.05) {
          if (name === 'melee' && Math.random() < 0.35) R.burst('blood', x, y, 3);
          else if (name === 'die') R.burst('dust', x, y, 4);
          else if (name === 'collapse') R.burst('bigdust', x, y, 22);
          else if (name === 'wallFall') R.burst('dust', x, y, 8);
          else if (name === 'impact') R.burst('dust', x, y, 10);
          else if (name === 'hammer' && Math.random() < 0.3) R.burst('dust', x, y, 1);
          else if (name === 'convert') R.burst('sparkle', x, y, 14);
        }
        A.playAt(name, x, y);
      } else A.play(name);
    });
  },

  showEnd(won, reason) {
    if (this.screen !== 'game') return;
    this.paused = true;
    const g = this.game;
    const el = document.getElementById('endscreen');
    el.hidden = false;
    el.querySelector('.end-title').textContent = won ? 'Victory' : 'Defeat';
    el.querySelector('.end-title').className = 'end-title ' + (won ? 'won' : 'lost');
    el.querySelector('.end-reason').textContent = `${reason} · ${fmtTime(g.time)} · ${this.mapName}`;
    const ps = g.players.slice(1);
    const row = (label, fn) => `<tr><th>${label}</th>${ps.map(p => `<td>${fn(p)}</td>`).join('')}</tr>`;
    const tot = p => Math.floor(p.st.gathered.food + p.st.gathered.wood + p.st.gathered.gold + p.st.gathered.stone);
    el.querySelector('.end-table').innerHTML = `<table>
      <thead><tr><th></th>${ps.map(p => `<th><i style="background:${p.color.main}"></i>${esc(p.name)}<small>${esc(p.civ.name)}${p.alive ? '' : ' · defeated'}</small></th>`).join('')}</tr></thead>
      <tbody>
      ${row('Score', p => this.ui.score(p))}
      ${row('Units killed', p => p.st.kills)}
      ${row('Units lost', p => p.st.lost)}
      ${row('Buildings razed', p => p.st.razed)}
      ${row('Units trained', p => p.st.trained)}
      ${row('Food gathered', p => Math.floor(p.st.gathered.food))}
      ${row('Wood gathered', p => Math.floor(p.st.gathered.wood))}
      ${row('Gold gathered', p => Math.floor(p.st.gathered.gold))}
      ${row('Stone gathered', p => Math.floor(p.st.gathered.stone))}
      ${row('Total gathered', p => tot(p))}
      ${row('Technologies', p => p.st.techs)}
      ${row('Feudal Age', p => p.st.ageTimes[1] != null ? fmtTime(p.st.ageTimes[1]) : '—')}
      ${row('Castle Age', p => p.st.ageTimes[2] != null ? fmtTime(p.st.ageTimes[2]) : '—')}
      ${row('Imperial Age', p => p.st.ageTimes[3] != null ? fmtTime(p.st.ageTimes[3]) : '—')}
      </tbody></table>`;
    drawTimeline(el.querySelector('canvas'), g);
    el.querySelector('#end-continue').hidden = !won;
  },

  quitToMenu() {
    this.screen = 'menu';
    this.game = null;
    this.paused = false;
    document.getElementById('game').hidden = true;
    document.getElementById('pause').hidden = true;
    document.getElementById('endscreen').hidden = true;
    document.getElementById('menu').hidden = false;
    Menu.refreshPreviews();
  },

  // ------------------------------------------------------------------ main loop
  loop(now) {
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.screen === 'game' && this.game) {
      if (!this.paused) {
        this.acc += dt * this.speed;
        let n = 0;
        while (this.acc >= SIM_DT && n < 12) { this.game.step(SIM_DT); this.acc -= SIM_DT; n++; }
        if (n >= 12) this.acc = 0;
      }
      this.input.update(dt);
      this.renderer.render(this.paused ? 1 : clamp(this.acc / SIM_DT, 0, 1), this.paused ? 0 : dt);
      this.mmT -= dt;
      if (this.mmT <= 0) { this.mmT = 0.15; this.minimap.draw(0.15); }
      this.ui.update(dt);
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc >= 0.5) {
        this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
        const f = document.getElementById('fps');
        if (this.settings.fps) { f.hidden = false; f.textContent = `${this.fps.toFixed(0)} fps · ${this.game.units.length} units · ${this.renderer.stats.entities} drawn · path ${this.game.stats.pathMs.toFixed(1)}ms`; }
        else f.hidden = true;
      }
    }
    requestAnimationFrame(t => this.loop(t));
  },

  // ------------------------------------------------------------------ selection
  setSelection(ents) {
    for (const e of this.sel) e.selected = false;
    this.sel = ents.filter(e => e && !e.dead);
    for (const e of this.sel) e.selected = true;
    this.page = 'main';
    if (this.ui) { this.ui.infoT = 0; this.ui.cmdT = 0; }
  },
  ownUnits() { const me = this.game.viewer; return this.sel.filter(e => e.kind === 'unit' && e.owner === me && !e.dead); },
  selSound() {
    const e = this.sel[0];
    if (!e) return;
    if (e.kind === 'unit') this.audio.play(e.isVillager ? 'selVil' : e.type === 'sheep' ? 'sheep' : 'selMil');
    else if (e.kind === 'building') this.audio.play('selBld');
  },
  clickSelect(sx, sy, shift, ctrl) {
    const g = this.game;
    const e = this.renderer.pick(sx, sy);
    if (!e) { if (!shift) this.setSelection([]); return; }
    const now = performance.now();
    const dbl = now - this.input.lastClick.t < 350 && this.input.lastClick.id === e.id;
    this.input.lastClick = { t: now, id: e.id };
    const own = e.owner === g.viewer;
    if (own && (dbl || ctrl) && e.kind === 'unit') {
      const same = this.renderer.list.filter(it => it.kind === 'unit' && it.e.owner === g.viewer && it.e.type === e.type).map(it => it.e);
      this.setSelection(same);
    } else if (own && (dbl || ctrl) && e.kind === 'building') {
      const same = this.renderer.list.filter(it => it.kind === 'bld' && it.e.owner === g.viewer && it.e.type === e.type).map(it => it.e);
      this.setSelection(same);
    } else if (shift && own && this.sel.length && this.sel[0].owner === g.viewer) {
      if (this.sel.includes(e)) this.setSelection(this.sel.filter(x => x !== e));
      else this.setSelection([...this.sel, e]);
    } else this.setSelection([e]);
    this.selSound();
  },
  boxSelect(x0, y0, x1, y1, shift) {
    const g = this.game;
    let units = this.renderer.pickBox(x0, y0, x1, y1).filter(u => u.owner === g.viewer);
    const nonSheep = units.filter(u => !u.st.animal);
    if (nonSheep.length) units = nonSheep;
    if (!units.length) { if (!shift) this.setSelection([]); return; }
    this.setSelection(shift ? [...new Set([...this.sel.filter(e => e.owner === g.viewer && e.kind === 'unit'), ...units])] : units);
    this.selSound();
  },
  centerOnSelection() {
    const s = this.sel.filter(e => !e.dead);
    if (!s.length) { if (this.lastAlert) this.renderer.centerOn(this.lastAlert.x, this.lastAlert.y); return; }
    let x = 0, y = 0;
    for (const e of s) { x += e.x; y += e.y; }
    this.renderer.centerOn(x / s.length, y / s.length);
  },
  selectIdle(vil) {
    const g = this.game;
    const list = g.units.filter(u => u.owner === g.viewer && !u.dead && !u.garrisonedIn && !u.order && (vil ? u.isVillager : (!u.isVillager && !u.st.animal)));
    if (!list.length) { this.ui.notify(vil ? 'No idle villagers.' : 'No idle military units.', 'info'); return; }
    if (vil) {
      this.idleIdx = (this.idleIdx + 1) % list.length;
      this.setSelection([list[this.idleIdx]]);
    } else this.setSelection(list);
    this.centerOnSelection();
    this.selSound();
  },
  gotoTC() {
    const g = this.game;
    const tcs = g.buildings.filter(b => b.owner === g.viewer && b.type === 'towncenter' && !b.dead);
    if (!tcs.length) return;
    this.tcIdx = (this.tcIdx + 1) % tcs.length;
    this.setSelection([tcs[this.tcIdx]]);
    this.centerOnSelection();
  },
  deleteSelection() {
    const own = this.sel.filter(e => e.owner === this.game.viewer);
    if (own.length) { this.game.commandDelete(own); this.setSelection([]); }
  },
  askDelete(blds) { this.game.commandDelete(blds); this.setSelection([]); },
  ringBell() {
    this.game.commandRingBell(this.game.viewer);
    this.ui.notify('Town bell rung — villagers are taking shelter.', 'warn');
  },
  applyCheat(text) {
    if (!this.game || !text.trim()) return;
    const msg = this.game.cheat(this.game.viewer, text);
    if (msg) { this.ui.notify(`Cheat: ${msg}`, 'good'); this.audio.play('research'); }
    else { this.ui.notify(`“${text.trim()}” isn’t a cheat code.`, 'warn'); this.audio.play('error'); }
  },
  openChat() {
    const f = document.getElementById('chat'), inp = document.getElementById('chat-input');
    f.hidden = false; inp.value = ''; inp.focus();
  },
  cantAfford(missing) {
    this.ui.notify(`Not enough ${missing.join(' and ')}.`, 'warn');
    this.audio.play('error');
  },
  changeSpeed(d) {
    const speeds = [1, 1.5, 2, 3];
    const i = clamp(speeds.indexOf(this.speed) + d, 0, speeds.length - 1);
    this.speed = speeds[i < 0 ? 1 : i];
    document.getElementById('speed-sel').value = String(this.speed);
    this.ui.notify(`Game speed: ${{ 1: 'Slow', 1.5: 'Normal', 2: 'Fast', 3: 'Very fast' }[this.speed]}`, 'info');
  },
  togglePause(force) {
    if (this.screen !== 'game') return;
    this.paused = force === true ? true : !this.paused;
    const el = document.getElementById('pause');
    el.hidden = !this.paused;
    el.querySelector('.pause-title').textContent = 'Paused';
    if (this.paused) Menu.fillSettings(el);
  },
  openMenu() {
    if (!document.getElementById('endscreen').hidden) return;
    if (!this.paused) this.togglePause();
    else { this.togglePause(); }
  },

  cursorFor(h) {
    const g = this.game;
    const units = this.sel.length && this.sel[0].kind === 'unit' && this.sel[0].owner === g.viewer;
    if (!h) return '';
    if (!units) return 'pointer';
    if (h.kind === 'resource') return this.sel.some(u => u.isVillager) ? 'cell' : 'pointer';
    if (h.owner && g.players[g.viewer].isEnemy(h.owner)) return 'crosshair';
    if (h.kind === 'unit' && h.owner === 0 && h.st.food) return this.sel.some(u => u.isVillager) ? 'cell' : 'crosshair';
    if (h.kind === 'building' && h.owner === g.viewer && (!h.built || h.hp < h.maxHp) && this.sel.some(u => u.isVillager)) return 'copy';
    return 'pointer';
  },

  // ------------------------------------------------------------------ commands
  rightClick(sx, sy, shift, alt, ctrl) {
    const g = this.game, me = g.viewer, R = this.renderer;
    const own = this.sel.filter(e => e.owner === me && !e.dead);
    if (!own.length) return;
    const target = R.pick(sx, sy);
    const t = R.screenToTile(sx, sy);
    const units = own.filter(e => e.kind === 'unit');
    if (units.length) {
      if (target && !(target.kind === 'unit' && units.includes(target))) {
        if (alt && target.kind === 'building' && g.players[me].isAlly(target.owner) && target.def.garrison) { g.commandGarrison(units, target); R.addMarker(target.x, target.y, 'move'); }
        else {
          g.commandTarget(units, target, shift);
          if (target.kind === 'building' && target.owner === me && units.some(u => u.isVillager)) this.renderer.flashBuilding(target);
          const enemy = target.owner && g.players[me].isEnemy(target.owner);
          R.addMarker(target.x, target.y, enemy ? 'attack' : target.kind === 'resource' || (target.kind === 'unit' && target.st.food) ? 'gather' : 'move');
        }
      } else {
        g.commandMove(units, t.x, t.y, shift, ctrl);
        R.addMarker(t.x, t.y, ctrl ? 'attack' : 'move');
      }
      this.audio.play('ack');
      return;
    }
    // buildings: set rally point
    const blds = own.filter(e => e.kind === 'building' && e.built && (e.def.trains || e.def.garrison));
    if (!blds.length && this.isTouch) { this.setSelection([]); return; }
    if (blds.length) {
      const ent = target && (target.kind === 'resource' || target.kind === 'building') ? target : null;
      for (const b of blds) g.commandRally(b, ent ? ent.x : t.x, ent ? ent.y : t.y, ent);
      R.addMarker(t.x, t.y, 'move');
      this.audio.play('ack');
    }
  },
  commandPoint(x, y, shift, attackMove) {
    const units = this.ownUnits();
    if (units.length) { this.game.commandMove(units, x, y, shift, attackMove); this.renderer.addMarker(x, y, attackMove ? 'attack' : 'move'); this.audio.play('ack'); }
  },
  placeBuilding(type, tx, ty, shift) {
    const g = this.game;
    const vils = this.ownUnits().filter(u => u.isVillager);
    if (!vils.length) { this.ui.notify('Select villagers to build.', 'warn'); return; }
    const b = g.commandBuild(vils, type, tx, ty, shift);
    if (!b) this.audio.play('error');
    else this.renderer.flashBuilding(b);
  },
  placeWall(type, ax, ay, bx, by, shift) {
    const vils = this.ownUnits().filter(u => u.isVillager);
    if (!vils.length) return;
    const n = this.game.commandBuildLine(vils, type, ax, ay, bx, by, shift);
    if (!n) this.audio.play('error');
  },
};

// ------------------------------------------------------------------ end-screen timeline chart
function drawTimeline(cv, g) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const ps = g.players.slice(1);
  let maxT = 1, maxV = 10;
  for (const p of ps) for (const s of p.st.timeline) { maxT = Math.max(maxT, s.t); maxV = Math.max(maxV, s.pop); }
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const X = t => pad.l + (W - pad.l - pad.r) * t / maxT, Y = v => H - pad.b - (H - pad.t - pad.b) * v / maxV;
  ctx.strokeStyle = 'rgba(232,214,170,0.15)'; ctx.fillStyle = 'rgba(232,214,170,0.7)'; ctx.font = '11px Alegreya Sans, sans-serif'; ctx.lineWidth = 1;
  for (let v = 0; v <= maxV; v += Math.max(10, Math.ceil(maxV / 5 / 10) * 10)) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(v, pad.l - 6, Y(v) + 4); }
  ctx.textAlign = 'center';
  for (let m = 0; m <= maxT / 60; m += Math.max(1, Math.ceil(maxT / 60 / 8))) ctx.fillText(m + 'm', X(m * 60), H - 8);
  for (const p of ps) {
    const tl = p.st.timeline;
    if (!tl.length) continue;
    ctx.strokeStyle = p.color.main; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(X(0), Y(4));
    for (const s of tl) ctx.lineTo(X(s.t), Y(s.pop));
    ctx.stroke();
    const last = tl[tl.length - 1];
    ctx.fillStyle = p.color.main; ctx.beginPath(); ctx.arc(X(last.t), Y(last.pop), 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

// ============================================================================
//  Main menu
// ============================================================================
const Menu = {
  init(app) {
    this.app = app;
    const s = app.setup;
    // civilisations
    const civs = document.getElementById('civ-cards');
    civs.innerHTML = CIV_IDS.map(id => {
      const c = CIVS[id];
      return `<button class="civ-card" data-civ="${id}"><img src="${iconUnit(c.unique, 1)}" alt=""><b>${c.name}</b><span>${c.tagline}</span></button>`;
    }).join('');
    civs.addEventListener('click', e => { const b = e.target.closest('.civ-card'); if (!b) return; s.civ = b.dataset.civ; this.render(); });
    // maps
    const maps = document.getElementById('map-cards');
    maps.innerHTML = Object.keys(MAPS).map(id => `<button class="map-card" data-map="${id}"><canvas width="132" height="70"></canvas><b>${MAPS[id].name}</b></button>`).join('') +
      `<button class="map-card" data-map="random"><div class="rand">?</div><b>Random</b></button>`;
    maps.addEventListener('click', e => { const b = e.target.closest('.map-card'); if (!b) return; s.map = b.dataset.map; this.render(); });
    // colours
    const cols = document.getElementById('color-pick');
    cols.innerHTML = PLAYER_COLORS.slice(1).map((c, i) => `<button class="swatch" data-c="${i + 1}" style="background:${c.main}" title="${c.name}"></button>`).join('');
    cols.addEventListener('click', e => { const b = e.target.closest('.swatch'); if (!b) return; s.color = +b.dataset.c; this.render(); });
    document.getElementById('p-name').addEventListener('input', e => { s.name = e.target.value.slice(0, 24); });
    for (const [id, key] of [['size-sel', 'size'], ['res-sel', 'startRes'], ['reveal-sel', 'reveal'], ['mspeed-sel', 'speed']]) {
      document.getElementById(id).addEventListener('change', e => { s[key] = key === 'speed' ? +e.target.value : e.target.value; this.render(); });
    }
    document.getElementById('opp-list').addEventListener('change', e => {
      const row = e.target.closest('[data-i]'); if (!row) return;
      const o = s.opponents[+row.dataset.i];
      o[e.target.dataset.k] = e.target.dataset.k === 'team' ? +e.target.value : e.target.value;
    });
    document.getElementById('opp-list').addEventListener('click', e => {
      const b = e.target.closest('.opp-del'); if (!b) return;
      s.opponents.splice(+b.closest('[data-i]').dataset.i, 1); this.autoSize(); this.render();
    });
    document.getElementById('opp-add').onclick = () => {
      if (s.opponents.length >= 5) return;
      s.opponents.push({ civ: 'random', difficulty: s.opponents.length ? s.opponents[s.opponents.length - 1].difficulty : 'normal', team: s.opponents.length + 2 });
      this.autoSize(); this.render();
    };
    document.getElementById('all-vs-me').onclick = () => { s.opponents.forEach(o => { o.team = 2; }); this.render(); };
    document.getElementById('ffa').onclick = () => { s.opponents.forEach((o, i) => { o.team = i + 2; }); this.render(); };
    document.getElementById('start-btn').onclick = () => {
      app.audio.init();
      // phones: go fullscreen and lock to landscape (ignored where unsupported)
      if (app.isTouch && !window.matchMedia('(display-mode: fullscreen)').matches) {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) Promise.resolve(req.call(el)).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
      }
      app.startGame();
    };
    const gsel = document.getElementById('gfx-sel');
    gsel.value = app.settings.gfx || (app.isTouch ? 'medium' : 'high');
    if (typeof THREE === 'undefined' || !webglAvailable()) { gsel.value = '2d'; gsel.disabled = true; }
    gsel.onchange = () => { app.settings.gfx = gsel.value; saveSettings(app.settings); };
    document.getElementById('howto-btn').onclick = () => { document.getElementById('howto').hidden = !document.getElementById('howto').hidden; };
    // pause menu
    const pause = document.getElementById('pause');
    pause.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'resume') app.togglePause();
      else if (a === 'restart') { app.startGame(); }
      else if (a === 'quit') app.quitToMenu();
      else if (a === 'resign') { app.paused = false; pause.hidden = true; app.game.resign(app.game.viewer); }
    });
    pause.addEventListener('input', e => this.readSettings(e));
    pause.addEventListener('change', e => this.readSettings(e));
    // cheats panel (pause menu) and keyboard chat box
    const CHEATS = [
      ['cheese steak jerky', '+1,000 food'], ['lumberjack', '+1,000 wood'], ['robin hood', '+1,000 gold'], ['rock on', '+1,000 stone'],
      ['ninjalui', '+100,000 of everything'], ['marco', 'Reveal the whole map'], ['polo', 'Toggle fog of war'],
      ['aegis', 'Instant building, training & research'], ['to the future', 'Advance one age instantly'],
      ['how do you turn this on', 'Spawn a machine-gun Cobra Car'], ['big army', 'Spawn 6 knights and 6 archers'],
      ['natural wonders', 'Take control of every wild animal'], ['black death', 'Wipe out all enemies'],
      ['i r winner', 'Win immediately'], ['wimpywimpywimpy', 'Give up'],
    ];
    document.getElementById('cheat-list').innerHTML = CHEATS.map(([c, d]) => `<button type="button" class="cheat" data-code="${c}"><b>${c}</b><span>${d}</span></button>`).join('');
    document.getElementById('cheat-list').addEventListener('click', e => {
      const b = e.target.closest('.cheat'); if (!b) return;
      app.applyCheat(b.dataset.code);
      b.classList.add('used'); setTimeout(() => b.classList.remove('used'), 600);
    });
    document.getElementById('cheat-form').addEventListener('submit', e => {
      e.preventDefault();
      const i = document.getElementById('cheat-input'); app.applyCheat(i.value); i.value = '';
    });
    const chat = document.getElementById('chat');
    chat.addEventListener('submit', e => { e.preventDefault(); const i = document.getElementById('chat-input'); app.applyCheat(i.value); chat.hidden = true; i.blur(); });
    document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Escape') { chat.hidden = true; e.target.blur(); } e.stopPropagation(); });
    document.getElementById('chat-input').addEventListener('blur', () => { setTimeout(() => { chat.hidden = true; }, 100); });
    const end = document.getElementById('endscreen');
    end.querySelector('#end-menu').onclick = () => app.quitToMenu();
    end.querySelector('#end-again').onclick = () => app.startGame();
    end.querySelector('#end-continue').onclick = () => { end.hidden = true; app.paused = false; };
    this.render();
    this.refreshPreviews();
  },

  autoSize() {
    const s = this.app.setup, n = s.opponents.length + 1;
    const need = n <= 2 ? 'tiny' : n === 3 ? 'small' : n === 4 ? 'medium' : 'large';
    const order = ['tiny', 'small', 'medium', 'large'];
    if (order.indexOf(s.size) < order.indexOf(need)) s.size = need;
  },

  render() {
    const s = this.app.setup;
    document.querySelectorAll('.civ-card').forEach(b => b.classList.toggle('on', b.dataset.civ === s.civ));
    document.querySelectorAll('.map-card').forEach(b => b.classList.toggle('on', b.dataset.map === s.map));
    document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', +b.dataset.c === s.color));
    document.getElementById('p-name').value = s.name;
    document.getElementById('size-sel').value = s.size;
    document.getElementById('res-sel').value = s.startRes;
    document.getElementById('reveal-sel').value = s.reveal;
    document.getElementById('mspeed-sel').value = String(s.speed);
    const civ = CIVS[s.civ];
    document.getElementById('civ-detail').innerHTML = `<h3>${civ.name} <small>${civ.tagline}</small></h3><ul>${civ.bonuses.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;
    document.getElementById('map-desc').textContent = s.map === 'random' ? 'A surprise battlefield chosen when the game begins.' : MAPS[s.map].desc;
    const civOpts = sel => `<option value="random"${sel === 'random' ? ' selected' : ''}>Random civ</option>` + CIV_IDS.map(id => `<option value="${id}"${sel === id ? ' selected' : ''}>${CIVS[id].name}</option>`).join('');
    document.getElementById('opp-list').innerHTML = s.opponents.map((o, i) => `
      <div class="opp" data-i="${i}">
        <span class="opp-n">Rival ${i + 1}</span>
        <select data-k="civ" aria-label="Civilization">${civOpts(o.civ)}</select>
        <select data-k="difficulty" aria-label="Difficulty">${['easy', 'normal', 'hard'].map(d => `<option value="${d}"${o.difficulty === d ? ' selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select>
        <select data-k="team" aria-label="Team">${[1, 2, 3, 4, 5, 6].map(t => `<option value="${t}"${o.team === t ? ' selected' : ''}>Team ${t}${t === 1 ? ' (yours)' : ''}</option>`).join('')}</select>
        <button class="opp-del" title="Remove rival" ${s.opponents.length <= 1 ? 'disabled' : ''}>✕</button>
      </div>`).join('');
    document.getElementById('opp-add').disabled = s.opponents.length >= 5;
    const n = s.opponents.length + 1;
    const recommended = n <= 2 ? 'tiny' : n === 3 ? 'small' : n === 4 ? 'medium' : 'large';
    document.getElementById('size-hint').textContent = `Recommended for ${n} players: ${MAP_SIZES[recommended].name.split(' ')[0]}`;
  },

  refreshPreviews() {
    const ids = Object.keys(MAPS);
    let i = 0;
    const next = () => {
      if (i >= ids.length) return;
      const id = ids[i++];
      const cv = document.querySelector(`.map-card[data-map="${id}"] canvas`);
      if (cv && !cv.dataset.done) { drawMapPreview(cv, id); cv.dataset.done = '1'; }
      setTimeout(next, 30);
    };
    next();
  },

  fillSettings(el) {
    const st = this.app.settings;
    el.querySelector('#set-sfx').value = st.sfx;
    el.querySelector('#set-music').value = st.music;
    el.querySelector('#set-musicon').checked = st.musicOn;
    el.querySelector('#set-edge').checked = st.edge;
    el.querySelector('#set-hp').value = st.hp;
    el.querySelector('#set-hidpi').checked = st.hidpi;
    el.querySelector('#set-fps').checked = st.fps;
    el.querySelector('#set-scroll').value = st.scroll;
    el.querySelector('#set-gfx').value = st.gfx || (App.isTouch ? 'medium' : 'high');
  },
  readSettings(e) {
    const app = this.app, st = app.settings, el = document.getElementById('pause');
    if (!e.target.id || !e.target.id.startsWith('set-')) return;
    st.sfx = +el.querySelector('#set-sfx').value;
    st.music = +el.querySelector('#set-music').value;
    st.musicOn = el.querySelector('#set-musicon').checked;
    st.edge = el.querySelector('#set-edge').checked;
    st.hp = el.querySelector('#set-hp').value;
    const hd = el.querySelector('#set-hidpi').checked;
    const changed = hd !== st.hidpi;
    st.hidpi = hd;
    st.fps = el.querySelector('#set-fps').checked;
    st.scroll = +el.querySelector('#set-scroll').value;
    const gfx = el.querySelector('#set-gfx').value;
    if (gfx !== (st.gfx || (App.isTouch ? 'medium' : 'high'))) { st.gfx = gfx; app.ui && app.ui.notify('Graphics setting changes when the next game starts (Restart).', 'info'); }
    app.audio.setVolumes(st.sfx, st.music);
    app.audio.toggleMusic(st.musicOn);
    if (app.input) { app.input.edgeScroll = st.edge; app.input.scrollSpeed = st.scroll; }
    if (app.renderer) app.renderer.showHp = st.hp;
    if (changed) app.resize();
    saveSettings(st);
  },
};

function drawMapPreview(cv, mapId) {
  const g = new Game({ map: mapId, n: 72, players: [{ civ: 'britons' }, { civ: 'franks' }, { civ: 'mongols' }], seed: 4242 + mapId.length * 97 });
  const n = g.n, ctx = cv.getContext('2d');
  const base = makeCanvas(n, n), bx = base.getContext('2d');
  const img = bx.createImageData(n, n);
  const cache = TERRAINS.map(t => hexRgb(t.mini));
  for (let i = 0; i < n * n; i++) {
    let c = cache[g.terrain[i]];
    const e = g.ents.get(g.occ[i]);
    if (e) c = e.kind === 'building' ? hexRgb(g.players[e.owner].color.main) : e.type === 'tree' ? [36, 74, 28] : e.type === 'gold' ? [232, 196, 50] : e.type === 'stone' ? [170, 170, 165] : c;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  bx.putImageData(img, 0, 0);
  const W = cv.width, H = cv.height, s = W / (2 * n);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(s, s / 2, -s, s / 2, W / 2, (H - W / 2) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

window.addEventListener('DOMContentLoaded', () => App.init());

// Offline support when served over http(s): cache the game so it runs without a connection
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claude\.ai|claudeusercontent/.test(location.hostname)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
