// ae-boot/sfx.js
// The startup screen's sound effects, shared by the site (ambient.js) and the admin's
// preview buttons: a single water drop, the string stand-in, and generated reverbs.

// A generated stereo room: decorrelated noise with an exponential decay that also
// darkens over time (high frequencies die first), and a short build-up.
export function impulse(ctx, seconds = 3, decay = 2.6) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const coef = 0.15 + 0.8 * t; // more smoothing later → darker tail
      lp = lp * coef + (Math.random() * 2 - 1) * (1 - coef);
      const build = Math.min(1, i / (rate * 0.03));
      d[i] = lp * (1 - t) ** decay * build * 1.6;
    }
  }
  return buf;
}

// A send/return reverb: connect sources to `.input`; `.output` goes to your mix.
// amount 0–1 sets the send; seconds sets the size of the space.
export function makeReverb(ctx, { amount = 0.4, seconds = 3 } = {}) {
  const input = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, seconds, 2.4);
  const output = ctx.createGain();
  input.gain.value = amount;
  input.connect(conv).connect(output);
  return { input, output, conv };
}

// One water drop: a tiny impact, then a resonating bubble whose pitch rises fast and
// fades — the "plink" of a single drop. pitch 1 = default; 0.5 lower, 2 higher.
export function waterDrop(ctx, dest, when = ctx.currentTime, { pitch = 1, level = 0.7 } = {}) {
  const t = Math.max(when, ctx.currentTime);
  const f0 = 620 * pitch;
  const f1 = 1650 * pitch;

  // the bubble's ringing tone
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.045);
  o.frequency.exponentialRampToValueAtTime(f1 * 1.08, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.004);
  g.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.2);

  // the impact: a 4 ms tick of bright noise
  const n = ctx.createBufferSource();
  const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.006), ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length) ** 2;
  n.buffer = nb;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.value = level * 0.18;
  n.connect(hp).connect(ng).connect(dest);
  n.start(t);
  return t + 0.2;
}

// The string stand-in: a soft, slowly beating high cluster in the given major key
// (0 = C … 11 = B). Returns { stop(at) }.
export function stringStandIn(ctx, dest, targetKey = 0) {
  const tonic = 69 + ((targetKey - 9 + 12) % 12) + 12; // around A5
  const notes = [0, 7, 14, 19].map((d) => tonic + d - 12);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7;
  const trem = ctx.createGain(); trem.gain.value = 0.7;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.25;
  lfo.connect(lfoAmt).connect(trem.gain);
  const oscs = notes.map((m, i) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 440 * 2 ** ((m - 69) / 12);
    o.detune.value = (i % 2 ? 1 : -1) * 6;
    const g = ctx.createGain(); g.gain.value = 0.06 / (i + 1);
    o.connect(g).connect(lp);
    o.start();
    return o;
  });
  lp.connect(trem).connect(dest);
  lfo.start();
  return { stop: (at = ctx.currentTime) => { oscs.forEach((o) => o.stop(at)); lfo.stop(at); } };
}

// Defaults for the effect controls (data/settings.json → startup).
export const SFX_DEFAULTS = Object.freeze({
  bubbleReverb: 0.45,   // send into the drop's reverb, 0–1
  bubbleSpace: 3,       // size of that reverb, seconds
  dropPitch: 1,         // 0.5–2
  stringReverb: 0.35,
  stringSpace: 4,
});
