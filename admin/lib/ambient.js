// admin/lib/ambient.js
// The startup screen's sound cloud: prepared song excerpts and its sound effects.
//
//   data/ambient.json        one entry per prepared song: key, excerpt files, size
//   ambient/<id>-<n>.mp3     excerpts (MP3 via ffmpeg; mono WAV when ffmpeg is missing)
//   ambient/sounds/<name>.*  bubble (click), string (tension), boot (with the animation)
//   ambient/bank.json        built by scripts/build.js — what the site loads
//
// The excerpts are cut and analysed in the admin page (admin/public/ambient-prep.js);
// this file stores them and keeps the list tidy.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const build = require('../../scripts/build.js');

const { ROOT, DATA, nfc } = build;
const FILE = path.join(DATA, 'ambient.json');
const DIR = path.join(ROOT, 'ambient');
const SOUNDS = path.join(DIR, 'sounds');
const SOUND_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const read = () => build.readJSON(FILE, { items: [] });
function write(data) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
const idOf = (track) => crypto.createHash('sha1').update(nfc(track)).digest('hex').slice(0, 12);
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function removeFiles(item) {
  for (const f of item.files || []) fs.rmSync(path.join(ROOT, f), { force: true });
}

// Drop entries for songs that no longer exist, and excerpt files nobody uses.
function prune() {
  const data = read();
  const before = data.items.length;
  data.items = data.items.filter((it) => {
    const keep = fs.existsSync(path.join(ROOT, it.track));
    if (!keep) removeFiles(it);
    return keep;
  });
  if (data.items.length !== before) write(data);
  const used = new Set(data.items.flatMap((it) => it.files || []));
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR)) {
      if (/^[0-9a-f]{12}-\d+\.(mp3|wav)$/.test(f) && !used.has(`ambient/${f}`)) fs.rmSync(path.join(DIR, f), { force: true });
    }
  }
}

// For the admin page: every song on the site and whether it's prepared.
function state(ffmpeg) {
  prune();
  const data = read();
  const byTrack = new Map(data.items.map((it) => [nfc(it.track), it]));
  const songs = build.visibleTracks().map((t) => {
    const it = byTrack.get(t.track);
    let status = 'missing';
    if (it) status = it.size !== t.size ? 'stale' : (ffmpeg && it.format === 'wav') ? 'upgrade' : 'ready';
    return {
      ...t,
      id: idOf(t.track),
      status,
      key: it ? it.key : null,
      keyOverride: it ? it.keyOverride || null : null,
      enabled: it ? it.enabled !== false : true,
      format: it ? it.format : null,
    };
  });
  const sounds = {};
  for (const name of build.SOUND_NAMES) {
    const f = fs.existsSync(SOUNDS) && fs.readdirSync(SOUNDS).find((x) => x.replace(/\.[^.]+$/, '') === name);
    if (f) sounds[name] = { url: rel(path.join(SOUNDS, f)).split('/').map(encodeURIComponent).join('/'), size: fs.statSync(path.join(SOUNDS, f)).size };
  }
  let bank = {};
  try { bank = JSON.parse(fs.readFileSync(path.join(DIR, 'bank.json'), 'utf8')); } catch { /* not built yet */ }
  return { songs, sounds, targetKey: bank.targetKey ?? null, targetName: bank.targetName || null, format: ffmpeg ? 'mp3' : 'wav' };
}

function convert(bin, from, to) {
  return new Promise((ok, fail) => execFile(bin,
    ['-y', '-loglevel', 'error', '-i', from, '-codec:a', 'libmp3lame', '-b:a', '112k', '-ar', '44100', to],
    { timeout: 120000 },
    (err, _o, stderr) => (err ? fail(new Error(`Converting an excerpt failed: ${stderr || err.message}`)) : ok())));
}

// Save one prepared song: meta = { track, size, key, duration, starts }, files = WAV excerpts.
async function saveItem(meta, files, ffmpeg) {
  const track = nfc(String(meta.track || ''));
  const song = build.visibleTracks().find((t) => t.track === track);
  if (!song) throw new UserError('That song isn’t on the site any more.', 404);
  const key = meta.key || {};
  if (!(Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12 && ['major', 'minor'].includes(key.mode))) {
    throw new UserError('Missing the song’s key.');
  }
  if (!files.length || files.length > 6) throw new UserError('Expected 1–6 excerpts.');
  for (const f of files) {
    const head = Buffer.alloc(12);
    const fd = fs.openSync(f.path, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new UserError('Excerpts must be WAV.');
  }

  const id = idOf(track);
  const data = read();
  const old = data.items.find((it) => it.id === id);
  if (old) removeFiles(old);
  fs.mkdirSync(DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < files.length; i++) {
    if (ffmpeg) {
      const to = path.join(DIR, `${id}-${i + 1}.mp3`);
      await convert(ffmpeg, files[i].path, to);
      fs.rmSync(files[i].path, { force: true });
      out.push(rel(to));
    } else {
      const to = path.join(DIR, `${id}-${i + 1}.wav`);
      fs.renameSync(files[i].path, to);
      out.push(rel(to));
    }
  }
  const item = {
    id,
    track,
    size: song.size,
    artist: song.artist,
    title: song.title,
    key: { tonic: key.tonic, mode: key.mode, name: key.name, confidence: key.confidence },
    keyOverride: old ? old.keyOverride : undefined,
    enabled: old ? old.enabled !== false : true,
    duration: meta.duration,
    starts: meta.starts,
    files: out,
    format: ffmpeg ? 'mp3' : 'wav',
    preparedAt: new Date().toISOString(),
  };
  data.items = data.items.filter((it) => it.id !== id).concat(item);
  data.items.sort((a, b) => a.track.localeCompare(b.track));
  write(data);
}

// Change a prepared song: { enabled }, or { keyOverride: {tonic, mode} | null }
function updateItem(id, patch) {
  const data = read();
  const it = data.items.find((x) => x.id === id);
  if (!it) throw new UserError('Prepare this song first.', 404);
  if (patch.enabled !== undefined) it.enabled = !!patch.enabled;
  if (patch.keyOverride !== undefined) {
    const k = patch.keyOverride;
    if (k === null) delete it.keyOverride;
    else if (Number.isInteger(k.tonic) && k.tonic >= 0 && k.tonic < 12 && ['major', 'minor'].includes(k.mode)) it.keyOverride = { tonic: k.tonic, mode: k.mode };
    else throw new UserError('Unknown key.');
  }
  write(data);
}

function saveSound(name, file) {
  if (!build.SOUND_NAMES.includes(name)) throw new UserError('Unknown sound.');
  const ext = path.extname(file.originalname).toLowerCase();
  if (!SOUND_EXT.has(ext)) {
    fs.rmSync(file.path, { force: true });
    throw new UserError('Please choose an audio file (MP3, WAV, M4A or OGG).');
  }
  fs.mkdirSync(SOUNDS, { recursive: true });
  for (const f of fs.readdirSync(SOUNDS)) if (f.replace(/\.[^.]+$/, '') === name) fs.rmSync(path.join(SOUNDS, f));
  const to = path.join(SOUNDS, `${name}${ext}`);
  fs.renameSync(file.path, to);
}

function deleteSound(name) {
  if (!build.SOUND_NAMES.includes(name)) throw new UserError('Unknown sound.');
  if (!fs.existsSync(SOUNDS)) return;
  for (const f of fs.readdirSync(SOUNDS)) if (f.replace(/\.[^.]+$/, '') === name) fs.rmSync(path.join(SOUNDS, f));
}

module.exports = { state, saveItem, updateItem, saveSound, deleteSound, prune, idOf };
