// ae-boot/ambient.js
// The waiting screen's sound: a generative granular cloud made from the label's songs.
//
// Nothing loops. Every few milliseconds a short "grain" is cut from a song excerpt,
// tuned to the shared key, windowed, panned and sent into dry / reverb / echo paths.
// The pointer steers it:
//   angle around the button  → which songs (they sit in a circle around it)
//   distance from the button → far: a distant, smeared, reverberant cloud
//                              near: drier, clearer, the songs actually play
//   left ↔ right             → where in the songs (through their excerpts)
//   top ↕ bottom             → grain size and shimmer (small and bright ↔ long and smeared)
// A string sound rises as you near the button. On click: the cloud stops, a bubble
// plays, and the boot sound starts with the animation.
//
// Browsers only allow sound after the visitor clicks, taps or presses a key, so the
// cloud wakes on the first such gesture (or right away if the browser already allows it).

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const cents = (c) => 2 ** (c / 1200);

// Unit Hann window, reused (scaled per grain) for grain envelopes.
const HANN = (() => {
  const n = 128;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.sin((Math.PI * i) / (n - 1)) ** 2;
  return w;
})();

export class AEAmbient {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.overlay    the startup overlay (#ae-boot)
   * @param {object} opts.computer        the AEComputerBoot controller
   * @param {string} [opts.base]          site root, relative to the page ('./')
   */
  constructor({ overlay, computer, base = './' }) {
    this.overlay = overlay;
    this.computer = computer;
    this.base = base;
    this.state = 'idle';      // idle → listening (cloud) → activated → finished
    this.bank = null;
    this.songs = [];          // { item, angle, buffers: [] }
    this.grains = 0;          // live grains
    this.stats = { grains: 0, loaded: 0 };
    this.abort = new AbortController();
    this.pointer = { x: 0.5, y: 0.5, active: false, last: 0 };
    this.smooth = { focus: 0.15, angle: 0, nx: 0.5, ny: 0.5 };
    this.playhead = 0;        // seconds, advances with the music when near the button
    this.nextGrain = 0;
    this.muted = readPref() === 'off';
    this.mobile = matchMedia('(pointer: coarse)').matches;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.state = 'finished'; return; }
    this.ctx = new AC({ latencyHint: 'playback' });
    this.buildGraph();
    this.buildToggle();
    this.listen();
    this.ready = this.load().catch((e) => console.warn('æ sound:', e.message));
    // Allowed already (returning visitor, or the browser trusts the site)? Then start.
    this.ctx.resume().then(() => this.ctx.state === 'running' && this.wake(false)).catch(() => {});
    setTimeout(() => this.ctx && this.ctx.state === 'running' && this.wake(false), 400);
  }

  // ------------------------------------------------------------------ audio graph
  buildGraph() {
    const c = this.ctx;
    this.out = c.createGain();
    this.out.gain.value = this.muted ? 0 : 1;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.005; limiter.release.value = 0.25;
    this.out.connect(limiter).connect(c.destination);

    // the cloud: grains → cloudIn → (dry through a tone filter) + reverb + echo
    this.cloud = c.createGain(); this.cloud.gain.value = 0;
    this.cloud.connect(this.out);
    this.cloudIn = c.createGain();
    this.tone = c.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.Q.value = 0.4; this.tone.frequency.value = 2000;
    this.dry = c.createGain();
    this.cloudIn.connect(this.tone).connect(this.dry).connect(this.cloud);

    this.reverb = c.createConvolver();
    this.reverb.buffer = impulse(c, 6.5, 2.6);
    this.reverbSend = c.createGain();
    this.reverbOut = c.createGain(); this.reverbOut.gain.value = 0.9;
    this.cloudIn.connect(this.reverbSend).connect(this.reverb).connect(this.reverbOut).connect(this.cloud);

    // stereo ping-pong echo, darkening on each repeat
    this.echoSend = c.createGain(); this.echoSend.gain.value = 0;
    const dl = c.createDelay(2); const dr = c.createDelay(2);
    dl.delayTime.value = 0.43; dr.delayTime.value = 0.61;
    const fb = c.createGain(); fb.gain.value = 0.48;
    const damp = c.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2400;
    const merge = c.createChannelMerger(2);
    this.echoSend.connect(dl);
    dl.connect(dr); dr.connect(damp).connect(fb).connect(dl);
    dl.connect(merge, 0, 0); dr.connect(merge, 0, 1);
    const echoOut = c.createGain(); echoOut.gain.value = 0.55;
    merge.connect(echoOut).connect(this.cloud);
    merge.connect(this.reverbSend); // echoes bloom into the reverb too
    this.cloudIn.connect(this.echoSend);

    // string (tension) and effects (bubble, boot)
    this.stringGain = c.createGain(); this.stringGain.gain.value = 0;
    this.stringGain.connect(this.out);
    const stringVerb = c.createGain(); stringVerb.gain.value = 0.35;
    this.stringGain.connect(stringVerb).connect(this.reverbSend);
    this.fx = c.createGain(); this.fx.gain.value = 1;
    this.fx.connect(this.out);
    // the effects' own reverb, so it keeps ringing after the cloud has faded
    this.fxVerb = c.createGain();
    const fxRev = c.createConvolver(); fxRev.buffer = this.reverb.buffer;
    const fxRevOut = c.createGain(); fxRevOut.gain.value = 0.8;
    this.fxVerb.connect(fxRev).connect(fxRevOut).connect(this.fx);
  }

  // ------------------------------------------------------------------ sound toggle
  buildToggle() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ae-sound-toggle';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.ctx.state !== 'running' || this.state === 'idle') {
        this.muted = false;
        writePref('on');
        this.ctx.resume().then(() => this.wake(true));
      } else {
        this.setMuted(!this.muted);
      }
      this.updateToggle();
    }, { signal: this.abort.signal });
    this.toggle = b;
    this.overlay.append(b);
    this.updateToggle();
  }

  updateToggle() {
    if (!this.toggle) return;
    const on = !this.muted && this.ctx.state === 'running' && this.state !== 'idle';
    this.toggle.dataset.on = String(on);
    this.toggle.innerHTML = `${on ? SPEAKER_ON : SPEAKER_OFF}<span>${on ? 'sound on' : this.state === 'idle' ? 'click anywhere for sound' : 'sound off'}</span>`;
    this.toggle.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  }

  setMuted(m) {
    this.muted = m;
    writePref(m ? 'off' : 'on');
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(m ? 0 : 1, t, 0.12);
  }

  // ------------------------------------------------------------------ input
  listen() {
    const sig = { signal: this.abort.signal };
    const move = (e) => {
      const p = e.touches ? e.touches[0] : e;
      if (!p) return;
      this.pointer.x = clamp(p.clientX / innerWidth);
      this.pointer.y = clamp(p.clientY / innerHeight);
      this.pointer.px = p.clientX; this.pointer.py = p.clientY;
      this.pointer.active = true;
      this.pointer.last = performance.now();
    };
    addEventListener('pointermove', move, { passive: true, ...sig });
    addEventListener('touchmove', move, { passive: true, ...sig });

    // The first click / tap / key wakes the sound (not on the power button: that
    // one goes straight to the bubble and the boot).
    const gesture = (e) => {
      if (this.state === 'finished') return;
      if (e.type === 'pointerdown') move(e);
      const onButton = e.target && e.target.closest && e.target.closest('.ae-power-button');
      if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.updateToggle()).catch(() => {});
      if (!onButton && this.state === 'idle' && !(e.target && e.target.closest && e.target.closest('.ae-sound-toggle'))) {
        if (this.muted && e.type === 'pointerdown') { /* respect an explicit "sound off" */ return; }
        this.ctx.resume().then(() => this.wake(true)).catch(() => {});
      }
    };
    addEventListener('pointerdown', gesture, { capture: true, ...sig });
    addEventListener('keydown', gesture, { capture: true, ...sig });

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || this.state === 'finished') return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this.state !== 'idle') this.ctx.resume().catch(() => {});
    }, sig);

    // Controller hooks: click → bubble; boot starts → boot sound; desktop → done.
    const power = this.computer && this.computer.power;
    const boot = this.computer && this.computer.boot;
    power && power.addEventListener('activating', () => this.activate(), sig);
    boot && boot.addEventListener('play', () => this.bootSound(), sig);
    this.computer && this.computer.addEventListener('enter', (e) => this.finish(e.detail && e.detail.reason), sig);
  }

  // ------------------------------------------------------------------ loading
  async load() {
    const res = await fetch(`${this.base}ambient/bank.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('no sound bank');
    this.bank = await res.json();
    const s = this.bank.settings || {};
    this.level = { cloud: s.volume ?? 0.8, string: s.stringVolume ?? 0.6, fx: s.effectsVolume ?? 0.9 };
    this.fx.gain.value = this.level.fx;
    this.targetKey = this.bank.targetKey || 0;

    // sound effects (files when added in the admin, built-in stand-ins otherwise)
    this.sfx = {};
    await Promise.all(['bubble', 'string', 'boot'].map(async (name) => {
      const src = this.bank.sounds && this.bank.sounds[name];
      if (!src) return;
      try { this.sfx[name] = await this.decode(`${this.base}${src}`); } catch { /* stand-in */ }
    }));
    if (this.state === 'listening') this.startString();

    if (s.ambient === false || !(this.bank.items || []).length) return;
    // A different handful of songs each visit, spread in a circle around the button.
    const items = shuffle(this.bank.items.slice()).slice(0, this.mobile ? 6 : 12);
    this.songs = items.map((item, i) => ({ item, angle: (i / items.length) * TAU, buffers: [], files: shuffle(item.files.slice()) }));
    // one excerpt each first, a few at a time; then a second excerpt each, later
    const queue = this.songs.map((s) => [s, 0]);
    const work = async () => {
      for (let job; (job = queue.shift());) {
        const [song, i] = job;
        if (this.state === 'finished' || this.state === 'activated') return;
        try {
          song.buffers.push(await this.decode(`${this.base}${song.files[i]}`));
          this.stats.loaded++;
        } catch { /* skip this excerpt */ }
      }
    };
    await Promise.all([work(), work(), work()]);
    if (this.mobile) return;
    await sleep(15000);
    for (const s of this.songs) if (s.files[1]) queue.push([s, 1]);
    await Promise.all([work(), work()]);
  }

  async decode(url) {
    const r = await fetch(url, { signal: this.abort.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.arrayBuffer();
    return await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
  }

  // ------------------------------------------------------------------ cloud
  wake(fromGesture) {
    if (this.state !== 'idle' || this.ctx.state !== 'running') { this.updateToggle(); return; }
    this.state = 'listening';
    if (fromGesture && this.muted) this.setMuted(false);
    const t = this.ctx.currentTime;
    this.cloud.gain.cancelScheduledValues(t);
    this.cloud.gain.setValueAtTime(0, t);
    this.cloud.gain.linearRampToValueAtTime((this.level ? this.level.cloud : 0.8) * 0.9, t + 3.5);
    this.nextGrain = t + 0.05;
    this.startString();
    this.tick = this.tick.bind(this);
    this.timer = setInterval(this.tick, 25);
    this.updateToggle();
  }

  // Where the button is, in pixels.
  center() {
    const btn = this.computer && this.computer.power && this.computer.power.button;
    const r = btn && btn.getBoundingClientRect();
    return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : [innerWidth / 2, innerHeight / 2];
  }

  // Pointer → musical parameters (smoothed).
  steer(dt) {
    const now = performance.now();
    let px = this.pointer.px, py = this.pointer.py;
    const idle = !this.pointer.active || now - this.pointer.last > 4500;
    if (idle) {
      // nobody moving: drift slowly around, mostly in the outer cloud
      const t = now / 1000;
      const [cx, cy] = this.center();
      const R = Math.hypot(innerWidth, innerHeight) / 2;
      const rr = R * (0.55 + 0.3 * Math.sin(t * 0.071));
      px = cx + Math.cos(t * 0.043 + 1) * rr;
      py = cy + Math.sin(t * 0.031) * rr * 0.7;
    }
    const [cx, cy] = this.center();
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(innerWidth - cx, cy), Math.hypot(cx, innerHeight - cy), Math.hypot(innerWidth - cx, innerHeight - cy));
    const r = clamp(Math.hypot(px - cx, py - cy) / (far * 0.9));
    const focus = clamp(1 - r) ** 1.6;               // 1 at the button, 0 far away
    const angle = Math.atan2(py - cy, px - cx);
    const k = 1 - Math.exp(-dt * (idle ? 0.6 : 3));  // smoothing
    const s = this.smooth;
    s.focus = lerp(s.focus, focus, k);
    let da = angle - s.angle; da = Math.atan2(Math.sin(da), Math.cos(da));
    s.angle += da * k;
    s.nx = lerp(s.nx, clamp(px / innerWidth), k);
    s.ny = lerp(s.ny, clamp(py / innerHeight), k);
  }

  tick() {
    if (this.state !== 'listening' || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const now = c.currentTime;
    const dt = this.lastTick ? now - this.lastTick : 0.025;
    this.lastTick = now;
    this.steer(dt);
    const { focus, ny } = this.smooth;

    // distance → space: far is wet, dark, echoing; near is dry, bright, present
    const p = (param, v) => param.setTargetAtTime(v, now, 0.15);
    p(this.dry.gain, lerp(0.12, 1.0, focus ** 0.9));
    p(this.reverbSend.gain, lerp(1.0, 0.18, focus ** 0.7));
    p(this.echoSend.gain, lerp(0.55, 0.0, Math.min(1, focus * 1.6)));
    p(this.tone.frequency, lerp(700, 15000, focus ** 1.4) * lerp(1.3, 0.8, ny));
    // string: louder as you near the button
    p(this.stringGain.gain, this.level ? this.level.string * 0.32 * focus ** 2.2 : 0);

    // the music moves forward when you're close; it nearly freezes far away
    this.playhead += dt * lerp(0.04, 1.0, focus ** 1.3);

    const ready = this.songs.filter((s) => s.buffers.length);
    if (!ready.length) return;
    const density = lerp(26, 10, focus);                       // grains per second
    while (this.nextGrain < now + 0.12) {
      if (this.grains < 70) this.grain(this.nextGrain, ready);
      this.nextGrain += (1 / density) * rand(0.55, 1.45);
    }
    if (this.nextGrain < now) this.nextGrain = now + 0.01;
  }

  grain(when, ready) {
    const c = this.ctx;
    const { focus, angle, nx, ny } = this.smooth;

    // which song: von Mises weights around the pointer's angle — broad far, sharp near
    const sharp = lerp(0.8, 9, focus ** 1.2);
    let total = 0;
    const w = ready.map((s) => { const v = Math.exp(sharp * Math.cos(s.angle - angle)); total += v; return v; });
    let pick = Math.random() * total, i = 0;
    while (pick > w[i] && i < w.length - 1) pick -= w[i++];
    const song = ready[i];
    const buf = song.buffers[Math.floor(Math.random() * song.buffers.length)];

    // grain size: near → follows the song (≈0.3 s), far → long smears; y scales it
    const size = lerp(0.9, 0.32, focus) * lerp(0.28, 1.7, ny) * rand(0.75, 1.3);
    // pitch: tuned to the shared key; far away, some grains jump an octave
    let rate = 2 ** ((song.item.shift || 0) / 12) * cents(rand(-1, 1) * lerp(16, 3, focus));
    const octave = Math.random();
    if (octave < (1 - focus) * lerp(0.08, 0.3, 1 - ny)) rate *= 2;            // shimmer, more at the top
    else if (octave > 1 - (1 - focus) * lerp(0.05, 0.22, ny)) rate *= 0.5;    // depth, more at the bottom

    // position: left↔right moves through the excerpt, plus the moving playhead, plus jitter
    const span = buf.duration;
    const need = size * rate;
    if (need >= span) return;
    const centre = (nx * span * 0.85 + this.playhead) % span;
    const jitter = lerp(span * 0.45, 0.04, focus ** 0.8);
    const offset = clamp(centre + rand(-1, 1) * jitter, 0, span - need);

    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const env = c.createGain();
    const amp = Math.min(1.1, 1.25 / Math.sqrt(Math.max(1, lerp(26, 10, focus) * size)));
    const curve = new Float32Array(HANN.length);
    for (let k = 0; k < curve.length; k++) curve[k] = HANN[k] * amp;
    env.gain.setValueAtTime(0, when);
    env.gain.setValueCurveAtTime(curve, when, size);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const spread = lerp(1, 0.4, focus);
    if (pan) pan.pan.value = clamp(rand(-spread, spread) + (nx - 0.5) * 0.5 * focus, -1, 1);
    src.connect(env);
    (pan ? env.connect(pan) : env).connect(this.cloudIn);
    src.start(when, offset, need);
    this.grains++;
    this.stats.grains++;
    src.onended = () => { this.grains--; src.disconnect(); env.disconnect(); pan && pan.disconnect(); };
  }

  // ------------------------------------------------------------------ string (tension)
  startString() {
    if (this.stringNode || this.state !== 'listening') return;
    const c = this.ctx;
    if (this.sfx && this.sfx.string) {
      const s = c.createBufferSource();
      s.buffer = this.sfx.string; s.loop = true;
      s.connect(this.stringGain); s.start();
      this.stringNode = { stop: (t) => s.stop(t) };
      return;
    }
    // Stand-in: a soft, slowly beating high cluster in the shared key.
    const tonic = 69 + (((this.targetKey ?? 0) - 9 + 12) % 12) + 12; // tonic around A5
    const notes = [0, 7, 14, 19].map((d) => tonic + d - 12);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7;
    const trem = c.createGain(); trem.gain.value = 0.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
    const lfoAmt = c.createGain(); lfoAmt.gain.value = 0.25;
    lfo.connect(lfoAmt).connect(trem.gain);
    const oscs = notes.map((m, i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * 2 ** ((m - 69) / 12);
      o.detune.value = (i % 2 ? 1 : -1) * 6;
      const g = c.createGain(); g.gain.value = 0.06 / (i + 1);
      o.connect(g).connect(lp);
      o.start();
      return o;
    });
    lp.connect(trem).connect(this.stringGain);
    lfo.start();
    this.stringNode = { stop: (t) => { oscs.forEach((o) => o.stop(t)); lfo.stop(t); } };
  }

  // ------------------------------------------------------------------ click → bubble
  activate() {
    if (this.state === 'activated' || this.state === 'finished') return;
    const wasListening = this.state === 'listening';
    this.state = 'activated';
    clearInterval(this.timer);
    const c = this.ctx;
    if (c.state !== 'running') c.resume().catch(() => {});
    const t = c.currentTime;
    for (const g of [this.cloud.gain, this.stringGain.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + (wasListening ? 0.35 : 0.05));
    }
    this.stringNode && this.stringNode.stop(t + 0.5);
    this.toggle && this.toggle.remove();
    this.playBubble(t + 0.01);
  }

  playBubble(t) {
    const c = this.ctx;
    if (this.sfx && this.sfx.bubble) {
      const s = c.createBufferSource(); s.buffer = this.sfx.bubble; s.connect(this.fx); s.start(t);
      return;
    }
    // Stand-in: two small water "bloops" (a sine swept upward, with a fast decay).
    for (const [d, f0, f1, len, lv] of [[0, 260, 900, 0.16, 0.5], [0.075, 520, 1500, 0.1, 0.25]]) {
      const o = c.createOscillator(); o.type = 'sine';
      const g = c.createGain();
      o.frequency.setValueAtTime(f0, t + d);
      o.frequency.exponentialRampToValueAtTime(f1, t + d + len);
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(lv, t + d + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
      o.connect(g); g.connect(this.fx);
      const verb = c.createGain(); verb.gain.value = 0.3; g.connect(verb).connect(this.fxVerb);
      o.start(t + d); o.stop(t + d + len + 0.05);
    }
  }

  // ------------------------------------------------------------------ boot sound (in sync)
  bootSound() {
    const c = this.ctx;
    if (!c || this.bootNode) return;
    // the visible frame starts now; compensate for the audio output delay
    const t = c.currentTime + Math.max(0, 0.01 - (c.outputLatency || 0));
    if (this.sfx && this.sfx.boot) {
      const s = c.createBufferSource(); s.buffer = this.sfx.boot;
      const g = c.createGain(); g.gain.value = 1;
      s.connect(g).connect(this.fx); s.start(t);
      this.bootNode = { gain: g, end: t + s.buffer.duration, stop: (at) => s.stop(at) };
      return;
    }
    // Stand-in following the animation's moments: light rises, the flare, the logo, the sweep.
    const d = (this.computer && this.computer.boot && this.computer.boot.duration) || 9.2;
    const k = d / 9.2;
    const g = c.createGain(); g.gain.value = 0.9; g.connect(this.fx);
    const toVerb = c.createGain(); toVerb.gain.value = 0.6; g.connect(toVerb).connect(this.fxVerb);
    const root = 220 * 2 ** ((((this.targetKey ?? 0) - 9 + 12) % 12) / 12);
    const nodes = [];
    // a swelling pad (root, fifth, ninth) from the light to the logo
    for (const [ratio, lv] of [[1, 0.09], [1.5, 0.06], [2.25, 0.04], [0.5, 0.07]]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = root * ratio;
      const e = c.createGain();
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(lv * 0.4, t + 0.55 * k);
      e.gain.linearRampToValueAtTime(lv, t + 1.5 * k);
      e.gain.linearRampToValueAtTime(lv * 0.6, t + 3.9 * k);
      e.gain.linearRampToValueAtTime(0, t + 8.6 * k);
      o.connect(e).connect(g); o.start(t); o.stop(t + 9 * k); nodes.push(o);
    }
    // bell chime when the chrome logo appears, glints during the sweep
    const bell = (at, f, lv, len) => {
      for (const [m, a] of [[1, 1], [2.76, 0.35], [5.4, 0.15]]) {
        if (f * m > Math.min(14000, c.sampleRate * 0.45)) continue; // keep partials audible, no aliasing
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
        const e = c.createGain();
        e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(lv * a, at + 0.006);
        e.gain.exponentialRampToValueAtTime(0.0001, at + len / m ** 0.5);
        o.connect(e).connect(g); o.start(at); o.stop(at + len); nodes.push(o);
      }
    };
    bell(t + 3.92 * k, root * 4, 0.14, 4);
    bell(t + 3.92 * k + 0.09, root * 6, 0.07, 3);
    for (const [at, m] of [[5.32, 6], [6.33, 8], [7.05, 9], [8.35, 12]]) bell(t + at * k, root * m, 0.035, 1.6);
    this.bootNode = { gain: g, end: t + 9.6 * k, stop: (at) => nodes.forEach((o) => { try { o.stop(at); } catch { /* already stopped */ } }) };
  }

  // ------------------------------------------------------------------ the end
  finish(reason) {
    if (this.state === 'finished') return;
    if (this.state !== 'activated') this.activate();
    this.state = 'finished';
    this.abort.abort();
    clearInterval(this.timer);
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    let until = t + 1.5;
    if (this.bootNode) {
      if (reason === 'complete') until = Math.max(until, this.bootNode.end + 0.5);
      else {
        // skipped / timed out: fade the boot sound quickly
        this.bootNode.gain.gain.cancelScheduledValues(t);
        this.bootNode.gain.gain.setTargetAtTime(0, t, 0.12);
        this.bootNode.stop(t + 1);
      }
    }
    setTimeout(() => { c.close().catch(() => {}); }, Math.max(0, (until - t) * 1000) + 4000); // let the reverb ring out
  }
}

// ------------------------------------------------------------------ helpers
const SPEAKER_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function readPref() { try { return localStorage.getItem('ae-sound'); } catch { return null; } }
function writePref(v) { try { localStorage.setItem('ae-sound', v); } catch { /* private mode */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// A generated stereo hall: decorrelated noise with an exponential decay that also
// darkens over time (high frequencies die first), and a short build-up.
function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const coef = 0.15 + 0.8 * t;           // more smoothing later → darker tail
      lp = lp * coef + (Math.random() * 2 - 1) * (1 - coef);
      const build = Math.min(1, i / (rate * 0.06));
      d[i] = lp * (1 - t) ** decay * build * 1.6;
    }
  }
  return buf;
}
