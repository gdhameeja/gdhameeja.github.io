'use strict';
// ============================================================================
//  Mouse & keyboard: selection, smart right-click, building placement,
//  wall dragging, camera control, hotkeys and control groups.
// ============================================================================

class Input {
  constructor(app) {
    this.app = app;
    this.cv = app.renderer.cv;
    this.mx = 0; this.my = 0; this.inside = false; this.inWindow = false;
    this.box = null;
    this.placing = null; this.wallStart = null;
    this.mode = null;          // 'attackmove' | 'garrison' | null
    this.pan = null;
    this.keys = new Set();
    this.lastClick = { t: 0, id: 0 };
    this.groupTap = { k: null, t: 0 };
    this.edgeScroll = true;
    this.scrollSpeed = 900;
    this.bind();
  }

  bind() {
    // window-level listeners: attached once
    window.addEventListener('mousemove', e => this.move(e));
    window.addEventListener('mouseup', e => this.up(e));
    // edge scrolling uses the window edges, since the HUD covers the top and bottom of the map canvas
    window.addEventListener('mousemove', () => { this.inWindow = true; });
    document.addEventListener('mouseout', e => { if (!e.relatedTarget) this.inWindow = false; });
    window.addEventListener('keydown', e => this.keydown(e));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.inside = false; this.inWindow = false; });
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    this.bindCanvas(this.cv);
    this.bindMinimap();
  }

  // the map canvas is recreated when switching between 2D and 3D rendering
  bindCanvas(cv) {
    this.cv = cv;
    cv.addEventListener('mousedown', e => this.down(e));
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { e.preventDefault(); this.app.renderer.setZoom(this.app.renderer.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener('mouseenter', () => { this.inside = true; });
    cv.addEventListener('mouseleave', () => { this.inside = false; });
    this.touch = new TouchControls(this);
  }

  // the minimap canvas is rebuilt with the HUD for every game
  bindMinimap() {
    const mm = document.getElementById('minimap');
    if (!mm || mm._bound) return;
    mm._bound = true;
    const mmMove = (e, right) => {
      const r = mm.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (mm.width / r.width), my = (e.clientY - r.top) * (mm.height / r.height);
      const t = this.app.minimap.fromMini(mx, my);
      if (right) this.app.commandPoint(t.x, t.y, e.shiftKey, e.ctrlKey);
      else this.app.renderer.centerOn(t.x, t.y);
    };
    mm.addEventListener('mousedown', e => { e.preventDefault(); if (e.button === 2) mmMove(e, true); else { this.mmDrag = true; mmMove(e, false); } });
    mm.addEventListener('mousemove', e => { if (this.mmDrag) mmMove(e, false); });
    mm.addEventListener('contextmenu', e => e.preventDefault());
    mm.addEventListener('touchstart', e => { e.preventDefault(); mmMove(e.touches[0], false); }, { passive: false });
    mm.addEventListener('touchmove', e => { e.preventDefault(); mmMove(e.touches[0], false); }, { passive: false });
  }

  get game() { return this.app.game; }
  get r() { return this.app.renderer; }

  setMode(m) { this.mode = m; this.placing = null; this.r.ghost = null; this.cv.style.cursor = 'crosshair'; }
  clearMode() { this.mode = null; this.placing = null; this.wallStart = null; this.r.ghost = null; this.r.dragLine = null; this.cv.style.cursor = ''; }

  startPlacing(type) {
    const g = this.game, p = g.players[g.viewer];
    const can = g.canBuildType(p.id, type);
    if (!can.ok) { this.app.ui.notify(can.why, 'warn'); this.app.audio.play('error'); return; }
    const cost = p.buildingCost(type);
    if (!p.canAfford(cost)) { this.app.cantAfford(p.missing(cost)); return; }
    this.mode = null;
    this.placing = type;
    this.wallStart = null;
    this.updateGhost();
    this.app.ui.cmdT = 0;
  }

  overHud() {
    const el = document.elementFromPoint(this.mx, this.my);
    return !!el && el !== this.cv;
  }

  tileAtMouse(size) {
    // while the cursor is over the HUD (e.g. just after clicking a build button) preview at screen centre
    const [sx, sy] = this.overHud() ? [this.r.vw / 2, this.r.vh * 0.42] : [this.mx, this.my];
    const t = this.r.screenToTile(sx, sy);
    const off = (size - 1) / 2;
    return { tx: Math.floor(t.x - off), ty: Math.floor(t.y - off), x: t.x, y: t.y };
  }

  updateGhost() {
    if (!this.placing) { this.r.ghost = null; return; }
    const d = BUILDINGS[this.placing];
    const { tx, ty } = this.tileAtMouse(d.size);
    const ok = this.game.canPlace(this.placing, tx, ty, this.game.viewer);
    this.r.ghost = { type: this.placing, tx, ty, ok };
    if (this.wallStart) {
      const tiles = this.game.lineTiles(this.wallStart[0], this.wallStart[1], tx, ty).slice(0, 60);
      this.r.dragLine = tiles.map(([x, y]) => [x, y, this.game.canPlace(this.placing, x, y, this.game.viewer)]);
    }
  }

  localXY(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    if (this.app.paused && !this.app.allowWhilePaused) return;
    const [x, y] = this.localXY(e);
    this.mx = x; this.my = y;
    if (e.button === 1) { e.preventDefault(); this.pan = { x, y, cx: this.r.cam.x, cy: this.r.cam.y }; return; }
    if (e.button === 2) {
      if (this.placing || this.mode) { this.clearMode(); return; }
      this.app.rightClick(x, y, e.shiftKey, e.altKey, e.ctrlKey);
      return;
    }
    if (e.button !== 0) return;
    if (this.placing) {
      const d = BUILDINGS[this.placing];
      const { tx, ty } = this.tileAtMouse(d.size);
      if (d.wall) { this.wallStart = [tx, ty]; this.updateGhost(); return; }
      this.app.placeBuilding(this.placing, tx, ty, e.shiftKey);
      if (!e.shiftKey) this.clearMode(); else this.updateGhost();
      return;
    }
    if (this.mode) { this.modeClick(x, y, e.shiftKey); return; }
    this.box = { x0: x, y0: y, x1: x, y1: y };
  }

  // A click/tap while a targeting mode (attack-move, garrison, rally) is active
  modeClick(x, y, shift) {
    const t = this.r.screenToTile(x, y);
    const target = this.r.pick(x, y);
    if (this.mode === 'attackmove') {
      if (target && target.owner && this.game.players[this.game.viewer].isEnemy(target.owner)) this.app.rightClick(x, y, shift, false, false);
      else this.app.commandPoint(t.x, t.y, shift, true);
    } else if (this.mode === 'garrison') {
      if (target && target.kind === 'building') this.game.commandGarrison(this.app.ownUnits(), target);
    } else if (this.mode === 'rally') {
      this.app.rightClick(x, y, false, false, false);
    }
    if (!shift) this.clearMode();
  }

  move(e) {
    const [x, y] = this.localXY(e);
    this.mx = x; this.my = y;
    if (this.pan) {
      const z = this.r.cam.zoom;
      this.r.cam.x = this.pan.cx - (x - this.pan.x) / z;
      this.r.cam.y = this.pan.cy - (y - this.pan.y) / z;
      this.r.clampCam();
      return;
    }
    if (this.box) { this.box.x1 = x; this.box.y1 = y; if (Math.abs(x - this.box.x0) + Math.abs(y - this.box.y0) > 6) this.r.selBox = this.box; }
    if (this.placing) this.updateGhost();
  }

  up(e) {
    if (e.button === 1) { this.pan = null; return; }
    if (e.button !== 0) return;
    if (this.placing && this.wallStart) {
      const { tx, ty } = this.tileAtMouse(1);
      this.app.placeWall(this.placing, this.wallStart[0], this.wallStart[1], tx, ty, e.shiftKey);
      this.wallStart = null; this.r.dragLine = null;
      if (!e.shiftKey) this.clearMode();
      return;
    }
    if (!this.box) return;
    const b = this.box;
    this.box = null; this.r.selBox = null;
    const drag = Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) > 6;
    if (drag) this.app.boxSelect(b.x0, b.y0, b.x1, b.y1, e.shiftKey);
    else this.app.clickSelect(b.x0, b.y0, e.shiftKey, e.ctrlKey);
  }

  // per-frame camera scrolling
  update(dt) {
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has('ArrowLeft')) dx -= 1;
    if (k.has('ArrowRight')) dx += 1;
    if (k.has('ArrowUp')) dy -= 1;
    if (k.has('ArrowDown')) dy += 1;
    if (this.edgeScroll && this.inWindow && !this.pan && !this.box && document.hasFocus()) {
      const m = 6, vw = this.r.vw, vh = this.r.vh;
      if (this.mx < m) dx -= 1; else if (this.mx > vw - m) dx += 1;
      if (this.my < m) dy -= 1; else if (this.my > vh - m) dy += 1;
    }
    if (dx || dy) {
      const s = this.scrollSpeed * dt / this.r.cam.zoom;
      this.r.cam.x += dx * s; this.r.cam.y += dy * s;
      this.r.clampCam();
      if (this.placing) this.updateGhost();
    }
    // hover feedback
    if (this.inside && !this.pan) {
      const h = this.box ? null : this.r.pick(this.mx, this.my);
      this.r.hover = h;
      if (!this.placing && !this.mode) this.cv.style.cursor = this.app.cursorFor(h);
    }
  }

  keydown(e) {
    const app = this.app;
    if (!app.game || app.screen !== 'game') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.keys.add(e.code);
    const code = e.code;
    if (code === 'F3' || code === 'Pause') { e.preventDefault(); app.togglePause(); return; }
    if (code === 'F10' || (code === 'Escape' && app.paused)) { e.preventDefault(); app.openMenu(); return; }
    if (app.paused) return;
    if (code === 'F4') { e.preventDefault(); document.getElementById('scores').classList.toggle('show'); return; }
    if (code === 'Escape') {
      if (this.placing || this.mode) this.clearMode();
      else if (app.page !== 'main') app.page = 'main';
      else app.setSelection([]);
      return;
    }
    if (code === 'Delete') { app.deleteSelection(); return; }
    // control groups
    const dm = code.match(/^Digit(\d)$/);
    if (dm) {
      const n = dm[1];
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { app.groups[n] = app.sel.filter(x => x.owner === app.game.viewer).map(x => x.id); app.ui.notify(`Group ${n} assigned (${app.groups[n].length})`, 'info'); return; }
      const ents = (app.groups[n] || []).map(id => app.game.ents.get(id)).filter(x => x && !x.dead && x.owner === app.game.viewer);
      if (e.shiftKey) app.setSelection([...new Set([...app.sel, ...ents])]);
      else app.setSelection(ents);
      const now = performance.now();
      if (this.groupTap.k === n && now - this.groupTap.t < 350) app.centerOnSelection();
      this.groupTap = { k: n, t: now };
      return;
    }
    if (code === 'Period') { app.selectIdle(true); return; }
    if (code === 'Comma') { app.selectIdle(false); return; }
    if (code === 'Space') { e.preventDefault(); app.centerOnSelection(); return; }
    if (code === 'Equal' || code === 'NumpadAdd') { app.changeSpeed(1); return; }
    if (code === 'Minus' || code === 'NumpadSubtract') { app.changeSpeed(-1); return; }
    // command grid hotkeys
    const letter = code.startsWith('Key') ? code.slice(3) : null;
    if (letter) {
      const i = GRID_KEYS.indexOf(letter);
      if (i >= 0 && app.ui.cmds[i]) { e.preventDefault(); app.ui.pressSlot(i, e.shiftKey, false); return; }
      if (letter === 'H') { app.gotoTC(); return; }
    }
  }
}

// ============================================================================
//  Touch controls (phones & tablets)
//   tap: select, or command the selected units  ·  drag: scroll  ·  pinch: zoom
//   long-press + drag: selection box  ·  double-tap: all of that type on screen
//   while placing: drag the preview (held above the finger), lift to build
// ============================================================================
const PLACE_LIFT = 56;   // px the building preview floats above the finger

class TouchControls {
  constructor(inp) {
    this.inp = inp;
    this.mode = 'none';
    this.lastTap = { t: 0, id: 0 };
    const cv = inp.cv, opt = { passive: false };
    cv.addEventListener('touchstart', e => this.start(e), opt);
    cv.addEventListener('touchmove', e => this.move(e), opt);
    cv.addEventListener('touchend', e => this.end(e, false), opt);
    cv.addEventListener('touchcancel', e => this.end(e, true), opt);
  }
  get app() { return this.inp.app; }
  get r() { return this.inp.app.renderer; }
  pos(t) { const rc = this.inp.cv.getBoundingClientRect(); return [t.clientX - rc.left, t.clientY - rc.top]; }

  start(e) {
    e.preventDefault();
    const app = this.app, r = this.r, inp = this.inp;
    app.audio.init();
    if (!app.game || app.paused) return;
    const ts = e.touches;
    clearTimeout(this.lp);
    if (ts.length === 1) {
      const [x, y] = this.pos(ts[0]);
      this.sx = this.x = x; this.sy = this.y = y;
      this.cam0 = { x: r.cam.x, y: r.cam.y };
      if (inp.placing) {
        this.mode = 'place';
        inp.mx = x; inp.my = y - PLACE_LIFT;
        if (BUILDINGS[inp.placing].wall) { const { tx, ty } = inp.tileAtMouse(1); inp.wallStart = [tx, ty]; }
        inp.updateGhost();
        return;
      }
      this.mode = 'pending';
      this.lp = setTimeout(() => {
        if (this.mode !== 'pending') return;
        this.mode = 'box';
        this.box = { x0: x, y0: y, x1: x, y1: y };
        r.selBox = this.box;
        if (navigator.vibrate) navigator.vibrate(12);
      }, 420);
    } else {
      const [a, b] = [this.pos(ts[0]), this.pos(ts[1])];
      if (this.mode === 'place') { inp.wallStart = null; r.dragLine = null; }
      this.pinch = { d0: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), z0: r.cam.zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, cx: r.cam.x, cy: r.cam.y };
      this.mode = 'pinch';
      r.selBox = null;
    }
  }

  move(e) {
    e.preventDefault();
    const r = this.r, inp = this.inp, ts = e.touches;
    if (!this.app.game) return;
    if (this.mode === 'pinch' && ts.length >= 2) {
      const [a, b] = [this.pos(ts[0]), this.pos(ts[1])];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, P = this.pinch;
      r.cam.x = P.cx; r.cam.y = P.cy; r.cam.zoom = P.z0;
      r.setZoom(P.z0 * d / P.d0, P.mx, P.my);
      r.cam.x -= (mx - P.mx) / r.cam.zoom; r.cam.y -= (my - P.my) / r.cam.zoom;
      r.clampCam();
      return;
    }
    if (ts.length !== 1) return;
    const [x, y] = this.pos(ts[0]);
    this.x = x; this.y = y;
    if (this.mode === 'pending' && Math.hypot(x - this.sx, y - this.sy) > 12) { clearTimeout(this.lp); this.mode = 'pan'; }
    if (this.mode === 'pan') {
      r.cam.x = this.cam0.x - (x - this.sx) / r.cam.zoom;
      r.cam.y = this.cam0.y - (y - this.sy) / r.cam.zoom;
      r.clampCam();
    } else if (this.mode === 'box') {
      this.box.x1 = x; this.box.y1 = y;
    } else if (this.mode === 'place') {
      inp.mx = x; inp.my = y - PLACE_LIFT;
      inp.updateGhost();
    }
  }

  end(e, cancel) {
    e.preventDefault();
    clearTimeout(this.lp);
    const app = this.app, r = this.r, inp = this.inp;
    if (!app.game) return;
    if (e.touches.length > 0) { if (this.mode === 'pinch') this.mode = 'pinchwait'; return; }
    const mode = this.mode;
    this.mode = 'none';
    r.selBox = null;
    if (cancel) return;
    if (mode === 'pending') this.tap(this.x, this.y);
    else if (mode === 'box') {
      const b = this.box;
      if (Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) < 14) app.clickSelect(b.x0, b.y0, false, true);   // long-press: all of that type
      else app.boxSelect(b.x0, b.y0, b.x1, b.y1, false);
    } else if (mode === 'place' && inp.placing) {
      const d = BUILDINGS[inp.placing];
      if (d.wall && inp.wallStart) {
        const { tx, ty } = inp.tileAtMouse(1);
        app.placeWall(inp.placing, inp.wallStart[0], inp.wallStart[1], tx, ty, false);
        inp.clearMode();
      } else {
        const { tx, ty } = inp.tileAtMouse(d.size);
        if (app.game.canPlace(inp.placing, tx, ty, app.game.viewer)) { app.placeBuilding(inp.placing, tx, ty, false); inp.clearMode(); }
        else { app.ui.notify('Can’t build there — drag the outline to open ground.', 'warn'); app.audio.play('error'); }
      }
    }
  }

  tap(x, y) {
    const app = this.app, inp = this.inp, g = app.game, me = g.viewer;
    this.r.pickPad = 12;   // fingers are less precise than a mouse
    try { this._tap(x, y); } finally { this.r.pickPad = 0; }
  }
  _tap(x, y) {
    const app = this.app, inp = this.inp, g = app.game, me = g.viewer;
    if (inp.mode) { inp.modeClick(x, y, false); return; }
    const e = this.pickTouch(x, y);
    const now = performance.now();
    const dbl = e && now - this.lastTap.t < 330 && this.lastTap.id === e.id;
    this.lastTap = { t: now, id: e ? e.id : 0 };
    if (dbl && e.owner === me) { app.clickSelect(x, y, false, true); return; }
    const units = app.sel.filter(s => !s.dead && s.owner === me && s.kind === 'unit');
    if (units.length) {
      // tapping one of your own things selects it, unless it's work for the selected villagers
      if (e && e.owner === me && !this.isWorkTarget(units, e)) { app.setSelection([e]); app.selSound(); return; }
      app.rightClick(x, y, false, false, false);
      return;
    }
    if (e) { app.setSelection([e]); app.selSound(); }
    else app.setSelection([]);
  }

  // Finger-friendly picking: among everything near the touch point, prefer
  // people over animals and the entity closest to the finger.
  pickTouch(x, y) {
    const r = this.r, pad = r.pickPad || 0;
    const [wx, wy] = r.is3D ? [x, y] : r.screenToWorld(x, y);
    const zp = r.is3D ? 1 : r.cam.zoom;
    let best = null, bs = 1e9;
    for (const h of r.hitList) {
      if (h.bld || h.res || h.e.dead || h.e.kind !== 'unit') continue;
      const p = pad / zp;
      if (wx < h.x0 - p || wx > h.x1 + p || wy < h.y0 - p || wy > h.y1 + p) continue;
      const cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
      const s = Math.hypot(wx - cx, wy - cy) * zp + (h.e.st.animal ? 18 : 0);
      if (s < bs) { bs = s; best = h.e; }
    }
    return best || r.pick(x, y);
  }

  isWorkTarget(units, b) {
    const vils = units.filter(u => u.isVillager);
    if (!vils.length) return false;
    // your own sheep: villagers slaughter them for food
    if (b.kind === 'unit') return !!(b.st.animal && b.st.food);
    if (b.kind !== 'building') return false;
    if (!b.built || b.hp < b.maxHp || b.type === 'farm') return true;
    return vils.some(u => u.carry > 0 && b.def.drop && b.def.drop.includes(u.carryType));
  }
}
