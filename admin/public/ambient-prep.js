// admin/public/ambient-prep.js
// Prepares one song for the startup screen's sound cloud, in the browser:
// decode → find its key (whole song) → pick 3 excerpts → even out loudness → WAV.
// The server turns the WAVs into small MP3s (or keeps compact mono WAVs without ffmpeg).

import { chroma, detectKey, pickExcerpts, normalize, encodeWav } from './ambient-analysis.js';

const ANALYSIS_RATE = 11025;
const EXCERPTS = 3;
const SECONDS = 8;

async function render(buffer, { channels, rate, start = 0, seconds = buffer.duration }) {
  const frames = Math.max(1, Math.round(seconds * rate));
  const ctx = new OfflineAudioContext(channels, frames, rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0, start, seconds);
  const out = await ctx.startRendering();
  return Array.from({ length: channels }, (_, c) => out.getChannelData(c).slice());
}

// Short fades so an excerpt never starts or ends with a click.
function fade(channels, rate, ms = 15) {
  const n = Math.min(Math.round((rate * ms) / 1000), Math.floor(channels[0].length / 2));
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const g = i / n;
      ch[i] *= g;
      ch[ch.length - 1 - i] *= g;
    }
  }
  return channels;
}

/**
 * @param {string} url         the song, as the site plays it
 * @param {'mp3'|'wav'} format 'mp3' → stereo 44.1 kHz WAV for the server to convert;
 *                             'wav' → compact mono 22 kHz WAV, stored as is
 * @returns {Promise<{key, duration, starts, files: Blob[]}>}
 */
export async function prepareSong(url, format = 'mp3') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the song (${res.status}).`);
  const bytes = await res.arrayBuffer();
  const decoder = new OfflineAudioContext(2, 1, 44100);
  const buffer = await decoder.decodeAudioData(bytes);

  // Key, from the whole song mixed to mono at a low rate (fast, plenty for pitch).
  const [mono] = await render(buffer, { channels: 1, rate: ANALYSIS_RATE });
  const key = detectKey(chroma(mono, ANALYSIS_RATE));

  const startsAt = pickExcerpts(mono, ANALYSIS_RATE, { count: EXCERPTS, seconds: SECONDS }).map((s) => s / ANALYSIS_RATE);
  const seconds = Math.min(SECONDS, buffer.duration);
  const rate = format === 'mp3' ? 44100 : 22050;
  const channels = format === 'mp3' ? 2 : 1;

  const files = [];
  for (const start of startsAt) {
    const pcm = fade(normalize(await render(buffer, { channels, rate, start, seconds })), rate);
    files.push(new Blob([encodeWav(pcm, rate)], { type: 'audio/wav' }));
  }
  return { key, duration: +buffer.duration.toFixed(2), starts: startsAt.map((s) => +s.toFixed(2)), files };
}
