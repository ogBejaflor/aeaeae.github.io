// admin/public/ambient-analysis.js
// Pure audio analysis for the startup-screen sound cloud. No Web Audio here, so it
// runs (and is tested) anywhere: key detection, picking excerpts, loudness, WAV export.

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// ------------------------------------------------------------------ FFT (radix-2, in place)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ------------------------------------------------------------------ chroma
// Sum of pitch-class energy over the whole signal. Uses spectral peaks only
// (local maxima), each frame normalised so loud passages don't dominate.
export function chroma(signal, sampleRate, { size = 8192, hop = 4096, minHz = 55, maxHz = 1760 } = {}) {
  const out = new Float64Array(12);
  if (signal.length < size) return out;
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2);
  const lo = Math.max(2, Math.floor((minHz * size) / sampleRate));
  const hi = Math.min(size / 2 - 2, Math.ceil((maxHz * size) / sampleRate));
  // pitch class of each bin, precomputed
  const pcOf = new Int8Array(size / 2).fill(-1);
  for (let k = lo; k <= hi; k++) {
    const f = (k * sampleRate) / size;
    pcOf[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const frame = new Float64Array(12);
  for (let start = 0; start + size <= signal.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < size; i++) {
      const v = signal[start + i] * win[i];
      re[i] = v; im[i] = 0;
      energy += v * v;
    }
    if (energy < 1e-6) continue; // silence
    fft(re, im);
    for (let k = lo - 1; k <= hi + 1; k++) mag[k] = Math.hypot(re[k], im[k]);
    frame.fill(0);
    for (let k = lo; k <= hi; k++) {
      if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) frame[pcOf[k]] += Math.sqrt(mag[k]);
    }
    let total = 0;
    for (let c = 0; c < 12; c++) total += frame[c];
    if (total > 0) for (let c = 0; c < 12; c++) out[c] += frame[c] / total;
  }
  return out;
}

// ------------------------------------------------------------------ key
// Krumhansl–Kessler key profiles, correlated against the chroma for all 24 keys.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// → { tonic: 0–11, mode: 'major'|'minor', name: 'E minor', score, confidence }
export function detectKey(chromaVector) {
  const scores = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      scores.push({ tonic, mode, score: correlate(Array.from(chromaVector), rotated) });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  return {
    tonic: best.tonic,
    mode: best.mode,
    name: keyName(best.tonic, best.mode),
    score: +best.score.toFixed(3),
    confidence: +(best.score - scores[1].score).toFixed(3),
  };
}

export const keyName = (tonic, mode) => `${NOTE_NAMES[tonic]} ${mode}`;

// The major key that shares its notes (A minor → C major). Songs are tuned so these line up.
export const relativeMajor = (tonic, mode) => (mode === 'minor' ? (tonic + 3) % 12 : tonic);

// Smallest transposition (−6…+5 semitones) that moves a key onto the target tonic.
export function shiftTo(tonic, mode, targetMajorTonic) {
  let d = (targetMajorTonic - relativeMajor(tonic, mode)) % 12;
  if (d < 0) d += 12;
  return d > 5 ? d - 12 : d;
}

// ------------------------------------------------------------------ excerpts
// Pick `count` loud-ish windows of `seconds`, one in each part of the song
// (skipping the very start and end), so every excerpt has music in it.
export function pickExcerpts(signal, sampleRate, { count = 3, seconds = 8, block = 0.5 } = {}) {
  const len = Math.round(seconds * sampleRate);
  if (signal.length <= len) return [0];
  const b = Math.round(block * sampleRate);
  const rms = [];
  for (let i = 0; i + b <= signal.length; i += b) {
    let s = 0;
    for (let j = i; j < i + b; j++) s += signal[j] * signal[j];
    rms.push(Math.sqrt(s / b));
  }
  const winBlocks = Math.max(1, Math.round(seconds / block));
  const usable = rms.length - winBlocks;
  if (usable <= 0) return [0];
  const from = Math.floor(usable * 0.06);
  const to = Math.ceil(usable * 0.94);
  const starts = [];
  for (let part = 0; part < count; part++) {
    const a = from + Math.floor(((to - from) * part) / count);
    const z = from + Math.floor(((to - from) * (part + 1)) / count);
    let best = a;
    let bestScore = -1;
    // the whole window stays inside this part, so excerpts never overlap
    for (let s = a; s <= Math.max(a, z - winBlocks); s++) {
      let sum = 0;
      for (let k = s; k < s + winBlocks; k++) sum += rms[k] || 0;
      if (sum > bestScore) { bestScore = sum; best = s; }
    }
    starts.push(best * b);
  }
  return [...new Set(starts)];
}

// RMS of all channels together.
export function rmsOf(channels) {
  let s = 0, n = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { s += ch[i] * ch[i]; n++; }
  return n ? Math.sqrt(s / n) : 0;
}

// Scale to a common loudness (target RMS), never letting peaks clip.
export function normalize(channels, targetRms = 0.12) {
  const r = rmsOf(channels);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (!r || !peak) return channels;
  const gain = Math.min(targetRms / r, 0.98 / peak);
  return channels.map((ch) => ch.map((v) => v * gain));
}

// ------------------------------------------------------------------ WAV (16-bit PCM)
export function encodeWav(channels, sampleRate) {
  const nch = channels.length;
  const frames = channels[0].length;
  const buf = new ArrayBuffer(44 + frames * nch * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * nch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, frames * nch * 2, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}
