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
//   Catalogo/<Artist>/<Album>/album.json     optional: { year, hidden, tracks: [{ file, title }] }
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
};

// ---------- helpers ----------
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
    if (r.folder) {
      const artistDir = path.join(CATALOG, r.folder);
      const p = listFiles(artistDir).find((f) => PHOTO_RE.test(f));
      if (p) photo = url('Catalogo', r.folder, p);

      for (const albumFolder of orderAlbums(listDirs(artistDir), r.albums)) {
        const a = readAlbum(r.folder, albumFolder);
        if (a.hidden || !a.tracks.length) continue;
        const id = `a_${albumId++}`;
        albumIds.push(id);
        catalog.push({
          id,
          artist: r.name,
          albumTitle: a.title,
          year: a.year,
          coverArt: a.cover || 'assets/images/default-album-art.png',
          tracks: a.tracks.map((t) => ({ id: `t_${trackId++}`, title: t.title, file: t.file, duration: '--' })),
        });
      }
    }
    artists.push({ id: `ar_${i + 1}`, name: r.name, photo, bio: r.bio || '', albums: albumIds });
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

function buildAll() {
  const settings = loadSettings();
  buildSettings(settings);
  const music = buildMusic();
  const pop = buildNotifications();
  const gal = buildGallery(settings);
  return { ...music, ...pop, ...gal };
}

module.exports = {
  buildAll, buildMusic, buildNotifications, buildGallery, buildSettings,
  loadSettings, loadRoster, readAlbum, orderAlbums, titleFromFile, readJSON,
  DEFAULT_SETTINGS, ROOT, CATALOG, DATA, AUDIO_RE, COVER_RE, PHOTO_RE, IMAGE_EXT, VIDEO_EXT, nfc, same, naturalSort,
};

if (require.main === module) {
  const r = buildAll();
  console.log(`Built: ${r.artists} artists, ${r.albums} albums, ${r.popups} pop-ups, ${r.media} gallery items.`);
}
