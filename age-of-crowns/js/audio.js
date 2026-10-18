'use strict';
// ============================================================================
//  Synthesised sound effects and a light generative music loop (Web Audio).
// ============================================================================

class Sound {
  constructor() {
    this.ac = null;
    this.sfxVol = 0.55; this.musicVol = 0.22;
    this.musicOn = true;
    this.last = {};
    this.listener = null;   // fn(x,y) -> volume factor (0..1) based on camera
  }

  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createDynamicsCompressor();
    this.master.connect(this.ac.destination);
    this.sfx = this.ac.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.mus = this.ac.createGain(); this.mus.gain.value = this.musicOn ? this.musicVol : 0; this.mus.connect(this.master);
    const len = this.ac.sampleRate * 1.5;
    this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    if (this.ac) { this.sfx.gain.value = sfx; this.mus.gain.value = this.musicOn ? music : 0; }
  }
  toggleMusic(on) { this.musicOn = on; if (this.ac) this.mus.gain.setTargetAtTime(on ? this.musicVol : 0, this.ac.currentTime, 0.3); }

  // ------------------------------------------------------------------ primitives
  tone(f, dur, type = 'sine', vol = 0.3, { at = 0, attack = 0.005, slide = null, out = null, lp = null, vib = 0 } = {}) {
    const ac = this.ac, t = ac.currentTime + at;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    if (vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = vib; lg.gain.value = f * 0.03; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; o.connect(f2); node = f2; }
    node.connect(g); g.connect(out || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, type = 'bandpass', freq = 1000, q = 1, vol = 0.3, { at = 0, attack = 0.003, sweep = null } = {}) {
    const ac = this.ac, t = ac.currentTime + at;
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // positional play
  playAt(name, x, y) {
    if (!this.ac) return;
    const v = this.listener ? this.listener(x, y) : 1;
    if (v <= 0.02) return;
    this.play(name, v);
  }

  play(name, v = 1) {
    if (!this.ac || this.ac.state !== 'running') return;
    const now = this.ac.currentTime;
    const gap = { chop: 0.12, mine: 0.12, hammer: 0.14, till: 0.15, pluck: 0.15, cut: 0.15, melee: 0.06, bow: 0.05, die: 0.08, throw: 0.08 }[name] || 0.04;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const r = Math.random;
    switch (name) {
      case 'click': this.tone(1100, 0.04, 'square', 0.05 * v); break;
      case 'selVil': this.tone(520, 0.09, 'triangle', 0.14 * v); this.tone(660, 0.1, 'triangle', 0.12 * v, { at: 0.06 }); break;
      case 'selMil': this.tone(196, 0.12, 'sawtooth', 0.07 * v, { lp: 900 }); this.noise(0.06, 'highpass', 3500, 1, 0.06 * v); break;
      case 'selBld': this.tone(330, 0.12, 'triangle', 0.1 * v); break;
      case 'ack': this.tone(620, 0.05, 'triangle', 0.1 * v, { slide: 760 }); break;
      case 'error': this.tone(150, 0.18, 'sawtooth', 0.08 * v, { lp: 600 }); break;
      case 'melee': this.noise(0.08, 'bandpass', 2600 + r() * 1200, 6, 0.25 * v); this.tone(1600 + r() * 900, 0.14, 'sine', 0.05 * v); break;
      case 'hitBuilding': this.noise(0.1, 'bandpass', 700, 2, 0.2 * v); break;
      case 'ram': this.noise(0.3, 'lowpass', 300, 1, 0.45 * v); this.tone(70, 0.25, 'sine', 0.3 * v); break;
      case 'bow': this.noise(0.12, 'highpass', 2500, 1, 0.12 * v, { sweep: 6000 }); break;
      case 'throw': this.noise(0.16, 'bandpass', 900, 1.5, 0.12 * v, { sweep: 400 }); break;
      case 'catapult': this.tone(140, 0.3, 'sawtooth', 0.12 * v, { slide: 60, lp: 500 }); this.noise(0.4, 'bandpass', 600, 1, 0.12 * v, { sweep: 200 }); break;
      case 'impact': this.noise(0.45, 'lowpass', 500, 1, 0.4 * v); this.tone(70, 0.35, 'sine', 0.3 * v, { slide: 40 }); break;
      case 'chop': this.noise(0.06, 'bandpass', 450 + r() * 200, 3, 0.18 * v); this.tone(220, 0.05, 'triangle', 0.06 * v); break;
      case 'mine': this.tone(2100 + r() * 500, 0.07, 'sine', 0.08 * v); this.noise(0.04, 'highpass', 3000, 1, 0.08 * v); break;
      case 'till': this.noise(0.09, 'lowpass', 900, 1, 0.12 * v); break;
      case 'pluck': this.noise(0.05, 'highpass', 2800, 1, 0.05 * v); break;
      case 'cut': this.noise(0.07, 'bandpass', 1800, 2, 0.06 * v); break;
      case 'treeFall': this.noise(0.5, 'bandpass', 700, 1, 0.16 * v, { sweep: 250 }); this.noise(0.35, 'lowpass', 300, 1, 0.3 * v, { at: 0.55 }); break;
      case 'hammer': this.noise(0.04, 'bandpass', 1300, 3, 0.15 * v); this.tone(280, 0.05, 'square', 0.04 * v); break;
      case 'die': this.noise(0.25, 'lowpass', 700, 1, 0.2 * v); this.tone(180 + r() * 60, 0.22, 'sawtooth', 0.04 * v, { slide: 90, lp: 800 }); break;
      case 'siegeDie': this.noise(0.6, 'lowpass', 500, 1, 0.3 * v); break;
      case 'animalDie': this.tone(420, 0.22, 'triangle', 0.08 * v, { slide: 180 }); break;
      case 'collapse': this.noise(1.6, 'lowpass', 400, 1, 0.5 * v, { sweep: 120 }); this.noise(0.8, 'bandpass', 900, 1, 0.15 * v, { at: 0.15 }); break;
      case 'wallFall': this.noise(0.6, 'lowpass', 600, 1, 0.3 * v, { sweep: 200 }); break;
      case 'built': [523, 659, 784].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.1 * v, { at: i * 0.07 })); break;
      case 'farmDone': this.tone(600, 0.12, 'triangle', 0.08 * v); break;
      case 'reseed': this.tone(700, 0.06, 'triangle', 0.06 * v); break;
      case 'trained': this.tone(440, 0.16, 'triangle', 0.1 * v); this.tone(554, 0.2, 'triangle', 0.09 * v, { at: 0.08 }); break;
      case 'research': [660, 880, 990, 1320].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.08 * v, { at: i * 0.08 })); break;
      case 'age': [[262, 0], [330, 0.18], [392, 0.36], [523, 0.54], [392, 0.9], [523, 1.08]].forEach(([f, at], i) => { this.tone(f, i === 5 ? 0.9 : 0.3, 'sawtooth', 0.09, { at, lp: 1400, attack: 0.03 }); this.tone(f / 2, i === 5 ? 0.9 : 0.3, 'triangle', 0.08, { at }); }); break;
      case 'attacked': this.tone(220, 0.7, 'sawtooth', 0.12, { lp: 700, attack: 0.08, vib: 5 }); this.tone(165, 0.7, 'sawtooth', 0.09, { lp: 600, attack: 0.08, at: 0.05 }); break;
      case 'bell': for (let k = 0; k < 3; k++) [1, 2.76, 5.4].forEach((m, i) => this.tone(420 * m, 1.4, 'sine', 0.12 / (i + 1), { at: k * 0.45 })); break;
      case 'convert': {
        const ac = this.ac, t = ac.currentTime;
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = 170;
        f.type = 'bandpass'; f.Q.value = 6;
        for (let i = 0; i < 3; i++) { f.frequency.setValueAtTime(350, t + i * 0.4); f.frequency.exponentialRampToValueAtTime(1300, t + i * 0.4 + 0.2); f.frequency.exponentialRampToValueAtTime(350, t + i * 0.4 + 0.4); }
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * v, t + 0.05); g.gain.setValueAtTime(0.25 * v, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 1.35);
        break;
      }
      case 'coin': this.tone(1320, 0.08, 'square', 0.04 * v); this.tone(1760, 0.12, 'square', 0.04 * v, { at: 0.06 }); break;
      case 'sheep': this.tone(310, 0.45, 'sawtooth', 0.06 * v, { lp: 1400, vib: 9 }); break;
      case 'victory': [392, 494, 587, 784, 587, 784].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12, { at: i * 0.2 })); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.6, 'sawtooth', 0.08, { at: i * 0.35, lp: 700 })); break;
      case 'place': this.noise(0.08, 'lowpass', 600, 1, 0.2 * v); this.tone(200, 0.08, 'triangle', 0.08 * v); break;
    }
  }

  // ------------------------------------------------------------------ music: drone + modal plucked melody
  startMusic() {
    const ac = this.ac;
    const scale = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];   // D dorian
    const root = 146.83;
    let step = 3, t = ac.currentTime + 1;
    const drone = (f, type, vol) => {
      const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 500;
      g.gain.value = vol; o.connect(lp); lp.connect(g); g.connect(this.mus); o.start();
    };
    drone(root / 2, 'sawtooth', 0.035); drone(root * 0.75, 'triangle', 0.03);
    const pluck = (f, at, dur, vol) => this.tone(f, dur, 'triangle', vol, { at: at - ac.currentTime, attack: 0.004, out: this.mus, lp: 2200 });
    const tick = () => {
      if (!this.ac) return;
      while (t < ac.currentTime + 2) {
        const phrase = Math.random() < 0.15;
        const dur = phrase ? 1.2 : [0.3, 0.45, 0.6][Math.floor(Math.random() * 3)];
        step = clamp(step + Math.floor(Math.random() * 5) - 2, 0, scale.length - 1);
        const f = root * Math.pow(2, scale[step] / 12);
        if (Math.random() > 0.12) pluck(f, t, dur * 2.2, 0.16);
        if (Math.random() < 0.25) pluck(f * 1.5, t + 0.02, dur * 2, 0.06);
        if (step === 0 || Math.random() < 0.1) pluck(root / 2 * Math.pow(2, scale[Math.floor(Math.random() * 4)] / 12), t, 1.6, 0.09);
        t += dur;
      }
      setTimeout(tick, 500);
    };
    tick();
  }
}
