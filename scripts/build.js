// scripts/build.js
// Turns the editable content (data/*.json, Catalogo/, Archive/) into the small
// JS data files the site loads. The site itself never reads data/*.json directly,
// so it keeps working as a plain static site (GitHub Pages) and on any host.
//
//   node scripts/build.js            → build everything
//   require('./build').buildAll()    → same, from the admin server
//
// Inputs
//   data/settings.json       background, pop-up timing, welcome message, gallery options
//   data/roster.json         artists: order, bio, hidden, album order
//   data/notifications.json  pop-ups: [{ title, body, icon?, hidden? }]
//   Catalogo/<Artist>/photo.jpg              artist photo (or artist.jpg/.png/.webp)
//   Catalogo/<Artist>/<Album>/cover.jpg      album cover
//   Catalogo/<Artist>/<Album>/*.mp3|*.wav    tracks (.mp3 preferred when both exist)
//   Catalogo/<Artist>/<Album>/album.json     optional: { type, year, hidden, tracks: [{ file, title }] }
//                                            type: "album" (default) | "ep" | "single"
//   Archive/**                               gallery pictures and videos
//
// Outputs (assets/js/)
//   musicData.js  notificationsData.js  galleryData.js  siteSettings.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'Catalogo');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'assets', 'js');

const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac)$/i;
const COVER_RE = /^cover\.(jpe?g|png|webp)$/i;
const PHOTO_RE = /^(photo|artist)\.(jpe?g|png|webp)$/i;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);
// documents an artist can have in their folder (bio PDFs, press kits, riders…)
const DOC_EXT = new Set(['.pdf', '.txt', '.md', '.rtf', '.doc', '.docx', '.odt', '.pages']);

// Extra files sitting in an artist's folder (not the photo): pictures and documents.
// Shown inside the artist's folder on the desktop; pictures also appear in the Gallery.
function artistExtras(artistFolder) {
  const dir = path.join(CATALOG, artistFolder);
  const out = [];
  for (const f of listFiles(dir).sort(naturalSort)) {
    if (PHOTO_RE.test(f)) continue;
    const ext = path.extname(f).toLowerCase();
    const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : DOC_EXT.has(ext) ? 'doc' : null;
    if (kind) out.push({ name: f, kind, ext: ext.slice(1), src: url('Catalogo', artistFolder, f) });
  }
  return out;
}

const DEFAULT_SETTINGS = {
  siteTitle: 'æ Label Website',
  background: { image: 'assets/images/desktop-background.jpg', fit: 'cover', color: '#000000' },
  popups: {
    enabled: true,
    minDelay: 5,
    maxDelay: 20,
    shuffle: true,
    welcome: {
      enabled: true,
      title: "Hi, I'm Clippy 👋",
      body: 'Welcome to æ. Double-click folders to explore — or open the Terminal and type “help”.',
    },
  },
  gallery: { includeCatalog: true },
  // Startup screen sound: the granular cloud of the label's songs + sound effects
  startup: {
    ambient: true,        // play the sound cloud while waiting
    volume: 0.8,          // sound cloud
    stringVolume: 0.6,    // tension sound, louder near the button
    effectsVolume: 0.9,   // bubble on click + boot sound
    targetKey: 'auto',    // 'auto' or 0–11 (C … B): the major key every song is tuned to
    bubbleReverb: 0.45,   // the drop on click: reverb send 0–1 and size in seconds
    bubbleSpace: 3,
    dropPitch: 1,         // 0.5–2
    stringReverb: 0.35,   // the string: reverb send 0–1 and size in seconds
    stringSpace: 4,
  },
};

// ---------- helpers ----------
const RELEASE_TYPES = ['album', 'ep', 'single'];
const nfc = (s) => String(s).normalize('NFC');
const same = (a, b) => nfc(a) === nfc(b);
const isHidden = (name) => name.startsWith('.');
const url = (...segs) => segs.map((s) => encodeURIComponent(s)).join('/');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fs.existsSync(file)) console.warn(`Warning: ${path.relative(ROOT, file)} is not valid JSON (${e.message})`);
    return fallback;
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !isHidden(d.name))
    .map((d) => d.name);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !isHidden(d.name))
    .map((d) => d.name);
}

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// "03 - My_Song.wav" → "My Song"
function titleFromFile(file) {
  return file
    .replace(AUDIO_RE, '')
    .replace(/^(\d+[\s_.\-]+)/, '')
    .replaceAll('_', ' ')
    .trim();
}

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

// ---------- settings ----------
function loadSettings() {
  return deepMerge(DEFAULT_SETTINGS, readJSON(path.join(DATA, 'settings.json'), {}));
}

// ---------- roster ----------
// The roster lists every artist folder in Catalogo (new folders are appended),
// in the order chosen in the admin. Entries without a folder are kept too.
function loadRoster() {
  const roster = readJSON(path.join(DATA, 'roster.json'), []);
  const folders = listDirs(CATALOG);
  for (const f of folders) {
    if (!roster.some((r) => same(r.folder || r.name, f))) roster.push({ name: nfc(f) });
  }
  return roster.map((r) => ({ ...r, name: nfc(r.name), folder: folders.find((f) => same(f, r.folder || r.name)) || null }));
}

// ---------- albums ----------
// Reads one album folder. Returns null when it has no playable audio.
function readAlbum(artistFolder, albumFolder) {
  const dir = path.join(CATALOG, artistFolder, albumFolder);
  const files = listFiles(dir);
  const meta = readJSON(path.join(dir, 'album.json'), {});

  // one entry per song: prefer .mp3 over a .wav/.flac with the same name
  const byStem = new Map();
  for (const f of files.filter((f) => AUDIO_RE.test(f)).sort(naturalSort)) {
    const stem = f.replace(AUDIO_RE, '').toLowerCase();
    const prev = byStem.get(stem);
    if (!prev || /\.mp3$/i.test(f)) byStem.set(stem, f);
  }
  const available = [...byStem.values()];
  const stemOf = (f) => String(f).replace(AUDIO_RE, '').toLowerCase();

  // order + titles from album.json, then anything not listed (natural order)
  const ordered = [];
  for (const t of meta.tracks || []) {
    const hit = available.find((f) => stemOf(f) === stemOf(t.file) && !ordered.some((o) => o.file === f));
    if (hit) ordered.push({ file: hit, title: (t.title || '').trim() || titleFromFile(hit) });
  }
  for (const f of available) {
    if (!ordered.some((o) => o.file === f)) ordered.push({ file: f, title: titleFromFile(f) });
  }

  const cover = files.find((f) => COVER_RE.test(f));
  return {
    folder: albumFolder,
    title: nfc((meta.title || '').trim() || albumFolder),
    type: RELEASE_TYPES.includes(meta.type) ? meta.type : 'album',
    year: meta.year || null,
    hidden: !!meta.hidden,
    cover: cover ? url('Catalogo', artistFolder, albumFolder, cover) : null,
    tracks: ordered.map((t) => ({ title: t.title, file: url('Catalogo', artistFolder, albumFolder, t.file) })),
  };
}

function orderAlbums(folders, order = []) {
  const out = [];
  for (const name of order) {
    const f = folders.find((x) => same(x, name));
    if (f && !out.includes(f)) out.push(f);
  }
  for (const f of folders.sort(naturalSort)) if (!out.includes(f)) out.push(f);
  return out;
}

// ---------- builders ----------
function buildMusic() {
  const roster = loadRoster().filter((r) => !r.hidden);
  const catalog = [];
  const artists = [];
  let albumId = 1;
  let trackId = 1;

  roster.forEach((r, i) => {
    const albumIds = [];
    let photo = null;
    let files = [];
    if (r.folder) {
      const artistDir = path.join(CATALOG, r.folder);
      const p = listFiles(artistDir).find((f) => PHOTO_RE.test(f));
      if (p) photo = url('Catalogo', r.folder, p);
      files = artistExtras(r.folder);

      for (const albumFolder of orderAlbums(listDirs(artistDir), r.albums)) {
        const a = readAlbum(r.folder, albumFolder);
        if (a.hidden || !a.tracks.length) continue;
        const id = `a_${albumId++}`;
        albumIds.push(id);
        catalog.push({
          id,
          artist: r.name,
          albumTitle: a.title,
          type: a.type,
          year: a.year,
          coverArt: a.cover || 'assets/images/default-album-art.png',
          tracks: a.tracks.map((t) => ({ id: `t_${trackId++}`, title: t.title, file: t.file, duration: '--' })),
        });
      }
    }
    artists.push({ id: `ar_${i + 1}`, name: r.name, photo, bio: r.bio || '', files, albums: albumIds });
  });

  const js = `// assets/js/musicData.js
// Generated by scripts/build.js from Catalogo/ and data/roster.json.
// Edit content in the admin (admin/) — changes here are overwritten.

window.musicCatalog = ${JSON.stringify(catalog, null, 2)};

window.musicArtists = ${JSON.stringify(artists, null, 2)};
`;
  writeIfChanged(path.join(OUT, 'musicData.js'), js);
  return { albums: catalog.length, artists: artists.length };
}

function buildNotifications() {
  const list = readJSON(path.join(DATA, 'notifications.json'), [])
    .filter((n) => !n.hidden && (n.title || n.body))
    .map((n) => {
      const o = { title: n.title || '', body: n.body || '' };
      if (n.icon) o.icon = n.icon;
      return o;
    });
  const js = `// Generated by scripts/build.js from data/notifications.json\nwindow.aeNotificationsData = ${JSON.stringify(list, null, 2)};\n`;
  writeIfChanged(path.join(OUT, 'notificationsData.js'), js);
  return { popups: list.length };
}

function buildGallery(settings) {
  const media = [];
  const dirs = ['Archive'];
  if (settings.gallery.includeCatalog) dirs.push('Catalogo');

  const walk = (abs) => {
    if (!fs.existsSync(abs)) return;
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => !isHidden(e.name))
      .sort((a, b) => naturalSort(a.name, b.name));
    for (const e of entries) {
      const full = path.join(abs, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
      if (!type) continue;
      const rel = path.relative(ROOT, full).split(path.sep);
      media.push({ src: url(...rel), type, filename: e.name, directory: rel.slice(0, -1).join('/') });
    }
  };
  dirs.forEach((d) => walk(path.join(ROOT, d)));

  const js = `// Generated by scripts/build.js from Archive/${settings.gallery.includeCatalog ? ' and Catalogo/' : ''}\nwindow.aeGalleryData = ${JSON.stringify(media, null, 2)};\n`;
  writeIfChanged(path.join(OUT, 'galleryData.js'), js);
  return { media: media.length };
}

function buildSettings(settings) {
  const pub = {
    siteTitle: settings.siteTitle,
    background: settings.background,
    popups: settings.popups,
  };
  const js = `// Generated by scripts/build.js from data/settings.json\nwindow.aeSiteSettings = ${JSON.stringify(pub, null, 2)};\n`;
  writeIfChanged(path.join(OUT, 'siteSettings.js'), js);
}

// Browsers (and GitHub Pages) keep script files for a while. Tag each data script in
// index.html with a fingerprint of its content, so a published change loads straight away.
// ---------- startup sound cloud ----------
// Every visible track (what the site plays), for the admin to prepare excerpts from.
function visibleTracks() {
  const out = [];
  for (const r of loadRoster().filter((x) => !x.hidden && x.folder)) {
    const artistDir = path.join(CATALOG, r.folder);
    for (const albumFolder of orderAlbums(listDirs(artistDir), r.albums)) {
      const a = readAlbum(r.folder, albumFolder);
      if (a.hidden) continue;
      for (const t of a.tracks) {
        const rel = t.file.split('/').map(decodeURIComponent).join('/');
        let size = 0;
        try { size = fs.statSync(path.join(ROOT, rel)).size; } catch { /* missing */ }
        out.push({ track: nfc(rel), url: t.file, artist: r.name, album: a.title, title: t.title, size });
      }
    }
  }
  return out;
}

const RELATIVE_MAJOR = (tonic, mode) => (mode === 'minor' ? (tonic + 3) % 12 : tonic);
const SHIFT = (from, to) => { let d = ((to - from) % 12 + 12) % 12; return d > 5 ? d - 12 : d; };
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SOUND_NAMES = ['bubble', 'string', 'boot'];

// ambient/bank.json: what the startup screen loads. Built from data/ambient.json
// (prepared by the admin) for the songs currently on the site.
function buildAmbient(settings) {
  const dir = path.join(ROOT, 'ambient');
  const data = readJSON(path.join(DATA, 'ambient.json'), { items: [] });
  const tracks = new Map(visibleTracks().map((t) => [t.track, t]));
  const items = (data.items || [])
    .filter((it) => it.enabled !== false && tracks.has(nfc(it.track)) && tracks.get(nfc(it.track)).size === it.size)
    .filter((it) => (it.files || []).every((f) => fs.existsSync(path.join(ROOT, f))) && (it.files || []).length)
    .map((it) => ({ ...it, key: it.keyOverride || it.key }));

  // Target: the major key most songs already share (fewest/smallest shifts), unless set.
  const s = settings.startup || {};
  let target = Number.isInteger(s.targetKey) ? s.targetKey : null;
  if (target === null) {
    let best = 0, bestCost = Infinity;
    for (let k = 0; k < 12; k++) {
      const cost = items.reduce((c, it) => c + Math.abs(SHIFT(RELATIVE_MAJOR(it.key.tonic, it.key.mode), k)), 0);
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    target = best;
  }

  const sounds = {};
  for (const name of SOUND_NAMES) {
    const f = listFiles(path.join(dir, 'sounds')).find((x) => x.replace(/\.[^.]+$/, '') === name);
    if (f) {
      const abs = path.join(dir, 'sounds', f);
      // ?v= changes when the file does, so a replaced sound isn't served from cache
      sounds[name] = `${url('ambient', 'sounds', f)}?v=${fs.statSync(abs).size.toString(36)}`;
    }
  }

  const bank = {
    version: 1,
    targetKey: target,
    targetName: `${NOTE[target]} major / ${NOTE[(target + 9) % 12]} minor`,
    settings: {
      ambient: s.ambient !== false,
      volume: s.volume ?? 0.8,
      stringVolume: s.stringVolume ?? 0.6,
      effectsVolume: s.effectsVolume ?? 0.9,
      bubbleReverb: s.bubbleReverb ?? 0.45,
      bubbleSpace: s.bubbleSpace ?? 3,
      dropPitch: s.dropPitch ?? 1,
      stringReverb: s.stringReverb ?? 0.35,
      stringSpace: s.stringSpace ?? 4,
    },
    sounds,
    items: items.map((it) => ({
      id: it.id,
      artist: it.artist,
      title: it.title,
      files: it.files.map((f) => f.split('/').map(encodeURIComponent).join('/')),
      shift: SHIFT(RELATIVE_MAJOR(it.key.tonic, it.key.mode), target),
    })),
  };
  fs.mkdirSync(dir, { recursive: true });
  writeIfChanged(path.join(dir, 'bank.json'), JSON.stringify(bank, null, 1) + '\n');
  return { ambient: bank.items.length };
}

const DATA_SCRIPTS = ['siteSettings.js', 'musicData.js', 'notificationsData.js', 'galleryData.js'];
function stampIndex() {
  const file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, 'utf8');
  for (const name of DATA_SCRIPTS) {
    const abs = path.join(OUT, name);
    if (!fs.existsSync(abs)) continue;
    const v = require('crypto').createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
    const re = new RegExp(`(src="assets/js/${name.replace('.', '\\.')})(\\?v=[^"]*)?"`, 'g');
    html = html.replace(re, `$1?v=${v}"`);
  }
  writeIfChanged(file, html);
}

function buildAll() {
  const settings = loadSettings();
  buildSettings(settings);
  const music = buildMusic();
  const pop = buildNotifications();
  const gal = buildGallery(settings);
  const amb = buildAmbient(settings);
  stampIndex();
  return { ...amb, ...music, ...pop, ...gal };
}

module.exports = {
  buildAll, buildMusic, buildNotifications, buildGallery, buildSettings,
  loadSettings, loadRoster, readAlbum, orderAlbums, titleFromFile, readJSON,
  visibleTracks, buildAmbient, SOUND_NAMES,
  DEFAULT_SETTINGS, RELEASE_TYPES, DOC_EXT, artistExtras, ROOT, CATALOG, DATA, AUDIO_RE, COVER_RE, PHOTO_RE, IMAGE_EXT, VIDEO_EXT, nfc, same, naturalSort,
};

if (require.main === module) {
  const r = buildAll();
  console.log(`Built: ${r.artists} artists, ${r.albums} albums, ${r.popups} pop-ups, ${r.media} gallery items.`);
}
