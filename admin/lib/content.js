// admin/lib/content.js
// Every change the admin makes to the site's content goes through this file.
// Content lives in plain files inside the repo (data/*.json, Catalogo/, Archive/,
// assets/uploads/), so the static site keeps working anywhere. If the site later moves
// to a host with a database or cloud storage, this is the one file to swap out.

const fs = require('fs');
const path = require('path');
const build = require('../../scripts/build.js');

const { ROOT, CATALOG, DATA, AUDIO_RE, COVER_RE, PHOTO_RE, IMAGE_EXT, VIDEO_EXT, nfc, same, naturalSort } = build;
const ARCHIVE = path.join(ROOT, 'Archive');
const UPLOADS = path.join(ROOT, 'assets', 'uploads');
const TRASH = path.join(__dirname, '..', '.trash');
const TMP = path.join(__dirname, '..', '.tmp');

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- names & paths
// Folder/file names typed in the admin. Keeps Unicode (Nicø, PÉROLA) but removes
// characters that break paths or URLs on some systems.
function cleanName(raw, what = 'Name') {
  const name = nfc(String(raw || ''))
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/:*?"<>|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  if (!name) throw new UserError(`${what} can't be empty.`);
  return name;
}

// Uploaded file names keep their characters except path separators.
function cleanFileName(raw) {
  const name = nfc(String(raw || 'file'))
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  return name || 'file';
}

// Resolve a path and refuse anything that escapes `base`.
function inside(base, ...parts) {
  const p = path.resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + path.sep)) throw new UserError('Invalid path.');
  return p;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const webPath = (abs) => rel(abs).split('/').map(encodeURIComponent).join('/');

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${name} ${i}${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

const readJSON = (f, fb) => build.readJSON(f, fb);
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// ---------------------------------------------------------------- roster
const ROSTER = path.join(DATA, 'roster.json');

// Roster entries with their folder resolved (new Catalogo folders are appended).
function roster() {
  return build.loadRoster();
}

function saveRoster(list) {
  writeJSON(ROSTER, list.map((r) => {
    const o = { name: r.name };
    if (r.folder && !same(r.folder, r.name)) o.folder = r.folder;
    if (r.bio) o.bio = r.bio;
    if (r.hidden) o.hidden = true;
    if (r.albums && r.albums.length) o.albums = r.albums;
    return o;
  }));
}

function findArtist(name) {
  const list = roster();
  const i = list.findIndex((r) => same(r.name, name));
  if (i < 0) throw new UserError(`Artist “${name}” not found.`, 404);
  return { list, i, artist: list[i] };
}

// Make sure the artist has a folder on disk (roster-only artists get one on first upload).
function artistDir(artist) {
  if (!artist.folder) {
    artist.folder = cleanName(artist.name, 'Artist name');
    fs.mkdirSync(inside(CATALOG, artist.folder), { recursive: true });
  }
  return inside(CATALOG, artist.folder);
}

// ---------------------------------------------------------------- state (what the admin shows)
function albumState(artistFolder, albumFolder) {
  const a = build.readAlbum(artistFolder, albumFolder);
  const dir = inside(CATALOG, artistFolder, albumFolder);
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  const stem = (f) => f.replace(AUDIO_RE, '').toLowerCase();
  return {
    folder: albumFolder,
    title: a.title,
    year: a.year,
    hidden: a.hidden,
    cover: a.cover,
    tracks: a.tracks.map((t) => {
      const file = decodeURIComponent(t.file.split('/').pop());
      const versions = files.filter((f) => AUDIO_RE.test(f) && stem(f) === stem(file));
      return {
        file,
        title: t.title,
        url: t.file,
        formats: versions.map((v) => path.extname(v).slice(1).toLowerCase()),
        size: versions.reduce((n, v) => n + sizeOf(path.join(dir, v)), 0),
        playedSize: sizeOf(path.join(dir, file)),
      };
    }),
  };
}

function artistsState() {
  return roster().map((r) => {
    let photo = null;
    let albums = [];
    if (r.folder) {
      const dir = inside(CATALOG, r.folder);
      const p = fs.readdirSync(dir).find((f) => PHOTO_RE.test(f));
      if (p) photo = webPath(path.join(dir, p));
      const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
      albums = build.orderAlbums(folders, r.albums).map((f) => albumState(r.folder, f));
    }
    return { name: r.name, folder: r.folder, bio: r.bio || '', hidden: !!r.hidden, photo, albums };
  });
}

// ---------------------------------------------------------------- artists
function createArtist({ name }) {
  const display = nfc(String(name || '').trim());
  if (!display) throw new UserError("Artist name can't be empty.");
  const list = roster();
  if (list.some((r) => same(r.name, display))) throw new UserError(`“${display}” already exists.`);
  const folder = cleanName(display, 'Artist name');
  fs.mkdirSync(inside(CATALOG, folder), { recursive: true });
  list.push({ name: display, folder });
  saveRoster(list);
}

function updateArtist(name, { newName, bio, hidden }) {
  const { list, i, artist } = findArtist(name);
  if (newName !== undefined && !same(newName, artist.name)) {
    const display = nfc(String(newName).trim());
    if (!display) throw new UserError("Artist name can't be empty.");
    if (list.some((r, j) => j !== i && same(r.name, display))) throw new UserError(`“${display}” already exists.`);
    if (artist.folder) {
      const folder = cleanName(display, 'Artist name');
      if (!same(folder, artist.folder)) {
        const to = inside(CATALOG, folder);
        if (fs.existsSync(to)) throw new UserError(`A folder called “${folder}” already exists in Catalogo.`);
        fs.renameSync(inside(CATALOG, artist.folder), to);
        artist.folder = folder;
      }
    }
    artist.name = display;
  }
  if (bio !== undefined) artist.bio = String(bio).trim();
  if (hidden !== undefined) artist.hidden = !!hidden;
  saveRoster(list);
}

function deleteArtist(name) {
  const { list, i, artist } = findArtist(name);
  const items = artist.folder ? [inside(CATALOG, artist.folder)] : [];
  toTrash(items, { label: `Artist “${artist.name}”`, kind: 'artist', roster: { ...artist, index: i } });
  list.splice(i, 1);
  saveRoster(list);
}

function orderArtists(names) {
  const list = roster();
  const out = [];
  for (const n of names || []) {
    const r = list.find((x) => same(x.name, n));
    if (r && !out.includes(r)) out.push(r);
  }
  for (const r of list) if (!out.includes(r)) out.push(r);
  saveRoster(out);
}

function setArtistPhoto(name, file) {
  const { list, artist } = findArtist(name);
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new UserError('Artist photo must be a JPG, PNG or WebP.');
  const dir = artistDir(artist);
  for (const f of fs.readdirSync(dir).filter((f) => PHOTO_RE.test(f))) fs.rmSync(path.join(dir, f));
  moveFile(file.path, path.join(dir, `photo${ext === '.jpeg' ? '.jpg' : ext}`));
  saveRoster(list);
}

function removeArtistPhoto(name) {
  const { artist } = findArtist(name);
  if (!artist.folder) return;
  const dir = inside(CATALOG, artist.folder);
  const files = fs.readdirSync(dir).filter((f) => PHOTO_RE.test(f)).map((f) => path.join(dir, f));
  if (files.length) toTrash(files, { label: `Photo of “${artist.name}”` });
}

// ---------------------------------------------------------------- albums
function albumDir(artistName, albumFolder) {
  const { artist } = findArtist(artistName);
  if (!artist.folder) throw new UserError('Album not found.', 404);
  const dir = inside(CATALOG, artist.folder, albumFolder);
  if (!fs.existsSync(dir)) throw new UserError('Album not found.', 404);
  return { artist, dir };
}

const albumMetaFile = (dir) => path.join(dir, 'album.json');
function readMeta(dir) { return readJSON(albumMetaFile(dir), {}); }
function writeMeta(dir, meta) {
  const clean = {};
  if (meta.title) clean.title = meta.title;
  if (meta.year) clean.year = meta.year;
  if (meta.hidden) clean.hidden = true;
  if (meta.tracks && meta.tracks.length) clean.tracks = meta.tracks;
  if (Object.keys(clean).length) writeJSON(albumMetaFile(dir), clean);
  else fs.rmSync(albumMetaFile(dir), { force: true });
}

function createAlbum(artistName, { title }) {
  const { list, artist } = findArtist(artistName);
  const display = nfc(String(title || '').trim());
  if (!display) throw new UserError("Album title can't be empty.");
  const base = artistDir(artist);
  const folder = cleanName(display, 'Album title');
  const dir = inside(base, folder);
  if (fs.existsSync(dir)) throw new UserError(`“${artist.name}” already has an album called “${folder}”.`);
  fs.mkdirSync(dir, { recursive: true });
  if (folder !== display) writeMeta(dir, { title: display });
  saveRoster(list);
  return folder;
}

function updateAlbum(artistName, albumFolder, { title, year, hidden }) {
  const { list, i, artist } = findArtist(artistName);
  let { dir } = albumDir(artistName, albumFolder);
  const meta = readMeta(dir);
  if (title !== undefined) {
    const display = nfc(String(title).trim());
    if (!display) throw new UserError("Album title can't be empty.");
    const folder = cleanName(display, 'Album title');
    if (!same(folder, albumFolder)) {
      const to = inside(CATALOG, artist.folder, folder);
      if (fs.existsSync(to)) throw new UserError(`“${artist.name}” already has an album called “${folder}”.`);
      fs.renameSync(dir, to);
      dir = to;
      if (artist.albums) artist.albums = artist.albums.map((a) => (same(a, albumFolder) ? folder : a));
      list[i] = artist;
      saveRoster(list);
    }
    meta.title = folder === display ? undefined : display;
  }
  if (year !== undefined) {
    const y = String(year).trim();
    if (y && !/^\d{4}$/.test(y)) throw new UserError('Year should look like 2026.');
    meta.year = y ? Number(y) : undefined;
  }
  if (hidden !== undefined) meta.hidden = !!hidden;
  writeMeta(dir, meta);
}

function deleteAlbum(artistName, albumFolder) {
  const { artist, dir } = albumDir(artistName, albumFolder);
  toTrash([dir], { label: `Album “${albumFolder}” by ${artist.name}` });
}

function orderAlbums(artistName, folders) {
  const { list, i } = findArtist(artistName);
  list[i].albums = (folders || []).map((f) => nfc(f));
  saveRoster(list);
}

function setAlbumCover(artistName, albumFolder, file) {
  const { dir } = albumDir(artistName, albumFolder);
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new UserError('Cover must be a JPG, PNG or WebP.');
  for (const f of fs.readdirSync(dir).filter((f) => COVER_RE.test(f))) fs.rmSync(path.join(dir, f));
  moveFile(file.path, path.join(dir, `cover${ext === '.jpeg' ? '.jpg' : ext}`));
}

function addTracks(artistName, albumFolder, files) {
  const { dir } = albumDir(artistName, albumFolder);
  const added = [];
  for (const f of files) {
    if (!AUDIO_RE.test(f.originalname)) {
      fs.rmSync(f.path, { force: true });
      throw new UserError(`“${f.originalname}” isn't an audio file (MP3, WAV, M4A, OGG or FLAC).`);
    }
    const to = uniquePath(path.join(dir, cleanFileName(f.originalname)));
    moveFile(f.path, to);
    added.push(path.basename(to));
  }
  return added;
}

// tracks: [{ file, title }] in the wanted order
function saveTracks(artistName, albumFolder, tracks) {
  const { dir } = albumDir(artistName, albumFolder);
  const meta = readMeta(dir);
  meta.tracks = (tracks || []).map((t) => {
    const o = { file: cleanFileName(t.file) };
    const title = String(t.title || '').trim();
    if (title && title !== build.titleFromFile(o.file)) o.title = title;
    return o;
  });
  writeMeta(dir, meta);
}

function deleteTrack(artistName, albumFolder, file) {
  const { artist, dir } = albumDir(artistName, albumFolder);
  const stem = String(file).replace(AUDIO_RE, '').toLowerCase();
  const matches = fs.readdirSync(dir).filter((f) => AUDIO_RE.test(f) && f.replace(AUDIO_RE, '').toLowerCase() === stem);
  if (!matches.length) throw new UserError('Track not found.', 404);
  toTrash(matches.map((f) => path.join(dir, f)), { label: `Track “${build.titleFromFile(file)}” (${artist.name})` });
  const meta = readMeta(dir);
  if (meta.tracks) {
    meta.tracks = meta.tracks.filter((t) => String(t.file).replace(AUDIO_RE, '').toLowerCase() !== stem);
    writeMeta(dir, meta);
  }
}

// ---------------------------------------------------------------- settings & pop-ups
const SETTINGS = path.join(DATA, 'settings.json');
const POPUPS = path.join(DATA, 'notifications.json');

function getSettings() { return build.loadSettings(); }

function saveSettings(next) {
  const cur = getSettings();
  const s = { ...cur, ...next };
  s.background = { ...cur.background, ...(next.background || {}) };
  s.popups = { ...cur.popups, ...(next.popups || {}) };
  s.popups.welcome = { ...cur.popups.welcome, ...((next.popups || {}).welcome || {}) };
  s.gallery = { ...cur.gallery, ...(next.gallery || {}) };
  const min = Number(s.popups.minDelay);
  const max = Number(s.popups.maxDelay);
  if (!(min >= 1) || !(max >= min)) throw new UserError('Pop-up timing: “from” must be at least 1 second and not more than “to”.');
  if (!['cover', 'contain', 'tile'].includes(s.background.fit)) s.background.fit = 'cover';
  writeJSON(SETTINGS, s);
}

function getPopups() { return readJSON(POPUPS, []); }

function savePopups(list) {
  if (!Array.isArray(list)) throw new UserError('Expected a list of pop-ups.');
  writeJSON(POPUPS, list.map((p) => {
    const o = { title: String(p.title || '').trim(), body: String(p.body || '').trim() };
    if (p.icon) o.icon = String(p.icon);
    if (p.hidden) o.hidden = true;
    return o;
  }));
}

// Images used by settings (backgrounds, pop-up icons) live in assets/uploads/<kind>/.
const UPLOAD_KINDS = { backgrounds: 'Background', icons: 'Pop-up icon' };

function saveUpload(kind, file) {
  if (!UPLOAD_KINDS[kind]) throw new UserError('Unknown upload type.');
  const ext = path.extname(file.originalname).toLowerCase();
  if (!IMAGE_EXT.has(ext)) {
    fs.rmSync(file.path, { force: true });
    throw new UserError('Please choose an image (JPG, PNG, GIF or WebP).');
  }
  const to = uniquePath(path.join(UPLOADS, kind, cleanFileName(file.originalname)));
  moveFile(file.path, to);
  return rel(to);
}

function listUploads(kind) {
  const dir = path.join(UPLOADS, kind);
  const out = [];
  if (kind === 'backgrounds') {
    const def = path.join(ROOT, 'assets', 'images', 'desktop-background.jpg');
    if (fs.existsSync(def)) out.push({ path: rel(def), url: webPath(def), builtIn: true });
  }
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort(naturalSort)) {
      if (IMAGE_EXT.has(path.extname(f).toLowerCase())) out.push({ path: rel(path.join(dir, f)), url: webPath(path.join(dir, f)) });
    }
  }
  return out;
}

function deleteUpload(relPath) {
  const abs = inside(UPLOADS, path.relative('assets/uploads', String(relPath)));
  if (!fs.existsSync(abs)) throw new UserError('File not found.', 404);
  const s = getSettings();
  if (s.background.image === relPath) throw new UserError("That's the current background — pick another one first.");
  if (getPopups().some((p) => p.icon === relPath)) throw new UserError('A pop-up still uses that icon.');
  toTrash([abs], { label: `Image “${path.basename(abs)}”` });
}

// ---------------------------------------------------------------- gallery (Archive/)
function galleryState() {
  const items = [];
  const folders = [''];
  const walk = (abs) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).sort((a, b) => naturalSort(a.name, b.name))) {
      const full = path.join(abs, e.name);
      if (e.isDirectory()) { folders.push(path.relative(ARCHIVE, full).split(path.sep).join('/')); walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
      if (!type) continue;
      items.push({
        path: rel(full),
        url: webPath(full),
        name: e.name,
        folder: path.relative(ARCHIVE, abs).split(path.sep).join('/'),
        type,
        size: sizeOf(full),
      });
    }
  };
  walk(ARCHIVE);
  return { items, folders };
}

function addGalleryFiles(folder, files) {
  const dir = inside(ARCHIVE, folder ? cleanFolderPath(folder) : '');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) {
      fs.rmSync(f.path, { force: true });
      throw new UserError(`“${f.originalname}” isn't a picture or video the gallery can show.`);
    }
    moveFile(f.path, uniquePath(path.join(dir, cleanFileName(f.originalname))));
  }
}

function cleanFolderPath(p) {
  return String(p).split('/').filter(Boolean).map((s) => cleanName(s, 'Folder name')).join('/');
}

function createGalleryFolder(name) {
  const dir = inside(ARCHIVE, cleanFolderPath(name));
  if (fs.existsSync(dir)) throw new UserError('That folder already exists.');
  fs.mkdirSync(dir, { recursive: true });
  // keep empty folders in git
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
}

function deleteGalleryItem(relPath) {
  const abs = inside(ARCHIVE, path.relative('Archive', String(relPath)));
  if (abs === ARCHIVE || !fs.existsSync(abs)) throw new UserError('Not found.', 404);
  toTrash([abs], { label: `${fs.statSync(abs).isDirectory() ? 'Folder' : 'Picture'} “${path.basename(abs)}”` });
}

// ---------------------------------------------------------------- trash
// Deleted things are moved to admin/.trash (never published) so they can be restored.
function toTrash(absPaths, meta = {}) {
  if (!absPaths.length && !meta.roster) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = path.join(TRASH, id);
  fs.mkdirSync(dir, { recursive: true });
  const items = absPaths.map((abs, n) => {
    const stored = `${n}-${path.basename(abs)}`;
    moveFile(abs, path.join(dir, stored));
    return { stored, original: rel(abs) };
  });
  writeJSON(path.join(dir, 'meta.json'), { ...meta, items, deletedAt: new Date().toISOString() });
}

function trashState() {
  if (!fs.existsSync(TRASH)) return [];
  return fs.readdirSync(TRASH)
    .filter((id) => fs.existsSync(path.join(TRASH, id, 'meta.json')))
    .map((id) => {
      const m = readJSON(path.join(TRASH, id, 'meta.json'), {});
      return { id, label: m.label || id, deletedAt: m.deletedAt };
    })
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

function restoreTrash(id) {
  const dir = inside(TRASH, id);
  const m = readJSON(path.join(dir, 'meta.json'), null);
  if (!m) throw new UserError('Not found in trash.', 404);
  for (const it of m.items || []) {
    const to = uniquePath(inside(ROOT, it.original));
    moveFile(path.join(dir, it.stored), to);
  }
  if (m.roster) {
    const list = roster().filter((r) => !same(r.name, m.roster.name));
    const { index, ...entry } = m.roster;
    list.splice(Math.min(index ?? list.length, list.length), 0, entry);
    saveRoster(list);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function emptyTrash(id) {
  const target = id ? inside(TRASH, id) : TRASH;
  fs.rmSync(target, { recursive: true, force: true });
}

// ---------------------------------------------------------------- everything
function state() {
  return {
    artists: artistsState(),
    settings: getSettings(),
    popups: getPopups(),
    backgrounds: listUploads('backgrounds'),
    icons: listUploads('icons'),
    gallery: galleryState(),
    trash: trashState(),
  };
}

module.exports = {
  UserError, TMP, state,
  createArtist, updateArtist, deleteArtist, orderArtists, setArtistPhoto, removeArtistPhoto,
  createAlbum, updateAlbum, deleteAlbum, orderAlbums, setAlbumCover, addTracks, saveTracks, deleteTrack, albumDir,
  getSettings, saveSettings, getPopups, savePopups, saveUpload, deleteUpload,
  addGalleryFiles, createGalleryFolder, deleteGalleryItem,
  restoreTrash, emptyTrash, cleanFileName,
};
