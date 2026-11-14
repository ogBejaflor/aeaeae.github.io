// admin/server.js
// The æ site admin. One small Node server that:
//   • serves the site itself at  /        (auto-refreshes while you edit)
//   • serves the admin at        /admin
//   • exposes the editing API at /api
// Every change rebuilds the site's data files straight away. "Publish" pushes to GitHub.
//
// On your computer:   npm start   (or double-click start.command)
// On a host later:    SITE_MODE=hosted ADMIN_PASSWORD=… PORT=… node server.js
//                     → same admin, behind a password; edits are live immediately.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const build = require('../scripts/build.js');
const content = require('./lib/content.js');
const publish = require('./lib/publish.js');
const auth = require('./lib/auth.js');
const ambient = require('./lib/ambient.js');

const MODE = process.env.SITE_MODE === 'hosted' ? 'hosted' : 'local';
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (MODE === 'hosted' ? '0.0.0.0' : '127.0.0.1');
const ROOT = build.ROOT;

if (MODE === 'hosted' && !auth.enabled()) {
  console.error('SITE_MODE=hosted needs ADMIN_PASSWORD set, otherwise anyone could edit the site.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
if (MODE === 'hosted') app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ------------------------------------------------------------------ live reload
// Open pages of the site and the admin listen here and refresh after a change.
const listeners = new Set();
let reloadTimer = null;
function announceChange() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of listeners) res.write(`event: change\ndata: ${Date.now()}\n\n`);
  }, 150);
}
app.get('/api/live', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); listeners.delete(res); });
});

// ------------------------------------------------------------------ auth
app.get('/api/me', (req, res) => res.json({ authed: auth.isAuthed(req), loginRequired: auth.enabled(), mode: MODE }));
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.use('/api', auth.requireAuth);

// Changes must come from the admin page itself (blocks other websites from posting here).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.get('X-AE-Admin') === '1') return next();
  res.status(403).json({ error: 'Forbidden.' });
});

// ------------------------------------------------------------------ uploads
fs.mkdirSync(content.TMP, { recursive: true });
const upload = multer({
  dest: content.TMP,
  limits: { fileSize: 1024 * 1024 * 1024, files: 200 },
});
// Browsers send UTF-8 file names but busboy reads them as latin1 — fix "PerdÃ£o" → "Perdão".
function fixNames(req, res, next) {
  const fix = (f) => {
    const utf = Buffer.from(f.originalname, 'latin1').toString('utf8');
    if (!utf.includes('�')) f.originalname = utf;
  };
  if (req.file) fix(req.file);
  for (const f of [].concat(req.files || [])) fix(f);
  next();
}
const cleanupUploads = (req) => {
  for (const f of [].concat(req.file || [], req.files || [])) fs.rm(f.path, { force: true }, () => {});
};

// ------------------------------------------------------------------ API helpers
// Run a change, rebuild the site data, tell open pages to refresh, return fresh state.
const change = (fn) => async (req, res) => {
  try {
    const extra = (await fn(req)) || {};
    build.buildAll();
    announceChange();
    res.json({ ok: true, ...extra, state: { ...content.state(), ambient: ambient.state(await ffmpegPath()) } });
  } catch (e) {
    cleanupUploads(req);
    sendError(res, e);
  }
};

function sendError(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error(e);
  res.status(status).json({ error: status >= 500 && !e.status ? `Something went wrong: ${e.message}` : e.message });
}

const needFile = (req) => {
  if (!req.file) throw new content.UserError('No file received.');
  return req.file;
};
const needFiles = (req) => {
  if (!req.files || !req.files.length) throw new content.UserError('No files received.');
  return req.files;
};

// ------------------------------------------------------------------ state
app.get('/api/state', async (req, res) => {
  try {
    const ff = await ffmpegPath();
    res.json({ ...content.state(), ambient: ambient.state(ff), env: { mode: MODE, ffmpeg: !!ff } });
  } catch (e) { sendError(res, e); }
});

// ------------------------------------------------------------------ artists
app.post('/api/artists', change((req) => content.createArtist(req.body)));
app.put('/api/artists-order', change((req) => content.orderArtists(req.body.names)));
app.patch('/api/artists/:artist', change((req) => content.updateArtist(req.params.artist, req.body)));
app.delete('/api/artists/:artist', change((req) => content.deleteArtist(req.params.artist)));
app.post('/api/artists/:artist/photo', upload.single('file'), fixNames,
  change((req) => content.setArtistPhoto(req.params.artist, needFile(req))));
app.delete('/api/artists/:artist/photo', change((req) => content.removeArtistPhoto(req.params.artist)));
// pictures (?kind=image, from the Gallery) and documents (?kind=doc, e.g. bio PDFs) in the artist's folder
app.post('/api/artists/:artist/files', upload.array('files'), fixNames,
  change((req) => ({ added: content.addArtistFiles(req.params.artist, needFiles(req), req.query.kind) })));
app.delete('/api/artists/:artist/files/:file', change((req) => content.deleteArtistFile(req.params.artist, req.params.file)));

// ------------------------------------------------------------------ albums
app.post('/api/artists/:artist/albums', change((req) => ({ folder: content.createAlbum(req.params.artist, req.body) })));
app.put('/api/artists/:artist/albums-order', change((req) => content.orderAlbums(req.params.artist, req.body.folders)));
app.patch('/api/artists/:artist/albums/:album', change((req) => content.updateAlbum(req.params.artist, req.params.album, req.body)));
app.delete('/api/artists/:artist/albums/:album', change((req) => content.deleteAlbum(req.params.artist, req.params.album)));
app.post('/api/artists/:artist/albums/:album/cover', upload.single('file'), fixNames,
  change((req) => content.setAlbumCover(req.params.artist, req.params.album, needFile(req))));
app.post('/api/artists/:artist/albums/:album/tracks', upload.array('files'), fixNames,
  change((req) => ({ added: content.addTracks(req.params.artist, req.params.album, needFiles(req)) })));
app.put('/api/artists/:artist/albums/:album/tracks', change((req) => content.saveTracks(req.params.artist, req.params.album, req.body.tracks)));
app.delete('/api/artists/:artist/albums/:album/tracks/:file', change((req) => content.deleteTrack(req.params.artist, req.params.album, req.params.file)));
app.post('/api/artists/:artist/albums/:album/mp3', change((req) => makeMp3s(req.params.artist, req.params.album)));

// ------------------------------------------------------------------ desktop, pop-ups, uploads
app.put('/api/settings', change((req) => content.saveSettings(req.body.settings || {})));
app.put('/api/popups', change((req) => content.savePopups(req.body.popups)));
app.post('/api/uploads/:kind', upload.single('file'), fixNames,
  change((req) => ({ path: content.saveUpload(req.params.kind, needFile(req)) })));
app.delete('/api/uploads', change((req) => content.deleteUpload(req.query.path)));

// ------------------------------------------------------------------ gallery
app.post('/api/gallery', upload.array('files'), fixNames,
  change((req) => content.addGalleryFiles(req.body.folder || '', needFiles(req))));
app.post('/api/gallery/folders', change((req) => content.createGalleryFolder(req.body.name)));
app.delete('/api/gallery', change((req) => content.deleteGalleryItem(req.query.path)));

// ------------------------------------------------------------------ startup sound cloud
// Prepared songs (excerpts analysed in the admin page) and the startup sound effects.
const ambientChange = (fn) => async (req, res) => {
  try {
    const extra = (await fn(req)) || {};
    build.buildAll();
    announceChange();
    const ff = await ffmpegPath();
    res.json({ ok: true, ...extra, state: { ...content.state(), ambient: ambient.state(ff) } });
  } catch (e) {
    cleanupUploads(req);
    sendError(res, e);
  }
};
app.post('/api/ambient/items', upload.array('files', 6), fixNames, ambientChange(async (req) => {
  let meta;
  try { meta = JSON.parse(req.body.meta || '{}'); } catch { throw new content.UserError('Bad song details.'); }
  await ambient.saveItem(meta, needFiles(req), await ffmpegPath());
}));
app.patch('/api/ambient/items/:id', ambientChange((req) => ambient.updateItem(req.params.id, req.body)));
app.post('/api/ambient/sounds/:name', upload.single('file'), fixNames, ambientChange((req) => ambient.saveSound(req.params.name, needFile(req))));
app.delete('/api/ambient/sounds/:name', ambientChange((req) => ambient.deleteSound(req.params.name)));

// ------------------------------------------------------------------ boot animation (editor)
// ae-boot/site-options.js holds the animation settings the site uses.
const BOOT_OPTIONS = path.join(ROOT, 'ae-boot', 'site-options.js');
const BOOT_HEADER = `// Settings for the startup screen on the live site.
// Edited in the admin: Startup → Edit the boot animation (Save to site).
// You can also paste the "options" part of an exported preset here.
`;
function readBootOptions() {
  try {
    const src = fs.readFileSync(BOOT_OPTIONS, 'utf8');
    // the real statement starts a line; everything after "=" up to the final ";" is JSON
    const m = src.match(/^export const options\s*=\s*([\s\S]*)$/m);
    return m ? JSON.parse(m[1].trim().replace(/;\s*$/, '')) : {};
  } catch { return {}; }
}
app.get('/api/boot-options', async (req, res) => res.json({ options: readBootOptions(), ffmpeg: !!(await ffmpegPath()) }));
app.put('/api/boot-options', (req, res) => {
  try {
    const input = req.body && req.body.options;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new content.UserError('No settings received.');
    // keep only plain values with sensible keys (the runtime validates ranges itself)
    const clean = {};
    for (const [k, v] of Object.entries(input)) {
      if (!/^[a-zA-Z]{2,40}$/.test(k) || k === 'loop' || k === 'endBehavior') continue;
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      else if (typeof v === 'boolean' || (typeof v === 'string' && v.length < 40)) clean[k] = v;
    }
    fs.writeFileSync(BOOT_OPTIONS, `${BOOT_HEADER}export const options = ${JSON.stringify(clean, null, 2)};\n`, 'utf8');
    announceChange();
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});
// Frame-exact video: the editor renders each 1/60 s frame and sends it here as a JPEG;
// ffmpeg then joins them into an MP4. Timing is exact however fast the computer is.
const videoJobs = new Map(); // id → { dir, frames, created }
function cleanVideoJobs() {
  for (const [id, job] of videoJobs) {
    if (Date.now() - job.created > 30 * 60 * 1000) { fs.rm(job.dir, { recursive: true, force: true }, () => {}); videoJobs.delete(id); }
  }
}
app.post('/api/boot-video/start', async (req, res) => {
  if (!(await ffmpegPath())) return res.status(501).json({ error: 'Frame-exact video needs ffmpeg (brew install ffmpeg).' });
  cleanVideoJobs();
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(content.TMP, `video-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  videoJobs.set(id, { dir, frames: 0, created: Date.now() });
  res.json({ id });
});
app.post('/api/boot-video/:id/frame/:n', express.raw({ type: 'image/jpeg', limit: '25mb' }), (req, res) => {
  const job = videoJobs.get(req.params.id);
  const n = Number(req.params.n);
  if (!job || !Number.isInteger(n) || n < 0 || n > 60 * 120) return res.status(404).json({ error: 'Unknown video.' });
  if (!Buffer.isBuffer(req.body) || req.body[0] !== 0xff || req.body[1] !== 0xd8) return res.status(400).json({ error: 'Expected a JPEG frame.' });
  fs.writeFileSync(path.join(job.dir, `f${String(n).padStart(5, '0')}.jpg`), req.body);
  job.frames = Math.max(job.frames, n + 1);
  res.json({ ok: true });
});
app.post('/api/boot-video/:id/finish', async (req, res) => {
  const job = videoJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown video.' });
  videoJobs.delete(req.params.id);
  const bin = await ffmpegPath();
  const out = path.join(job.dir, 'boot.mp4');
  execFile(bin, ['-y', '-loglevel', 'error', '-framerate', '60', '-i', path.join(job.dir, 'f%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', '60', '-movflags', '+faststart', out],
  { timeout: 15 * 60 * 1000 }, (err, _o, stderr) => {
    const done = () => fs.rm(job.dir, { recursive: true, force: true }, () => {});
    if (err) { done(); return res.status(500).json({ error: `Making the video failed: ${stderr || err.message}` }); }
    res.type('video/mp4').sendFile(out, { dotfiles: 'allow' }, (sendErr) => {
      done();
      if (sendErr && !res.headersSent) res.status(500).json({ error: 'Couldn\u2019t send the video.' });
    });
  });
});

// A WebM recording from the editor → MP4 (constant 60 fps, for video/DAW timelines).
app.post('/api/boot-video', upload.single('file'), async (req, res) => {
  const bin = await ffmpegPath();
  if (!req.file) return res.status(400).json({ error: 'No video received.' });
  if (!bin) { cleanupUploads(req); return res.status(501).json({ error: 'MP4 conversion needs ffmpeg (brew install ffmpeg).' }); }
  const out = `${req.file.path}.mp4`;
  execFile(bin, ['-y', '-loglevel', 'error', '-i', req.file.path, '-r', '60', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out],
    { timeout: 10 * 60 * 1000 }, (err, _o, stderr) => {
      fs.rm(req.file.path, { force: true }, () => {});
      if (err) { fs.rm(out, { force: true }, () => {}); return res.status(500).json({ error: `Converting failed: ${stderr || err.message}` }); }
      // (the temp folder's name starts with a dot, which sendFile refuses unless allowed)
      res.type('video/mp4').sendFile(out, { dotfiles: 'allow' }, (sendErr) => {
        fs.rm(out, { force: true }, () => {});
        if (sendErr && !res.headersSent) res.status(500).json({ error: 'Couldn\u2019t send the video.' });
      });
    });
});

// ------------------------------------------------------------------ trash
app.post('/api/trash/:id/restore', change((req) => content.restoreTrash(req.params.id)));
app.delete('/api/trash/:id', change((req) => content.emptyTrash(req.params.id)));
app.delete('/api/trash', change(() => content.emptyTrash()));

// ------------------------------------------------------------------ publish
app.get('/api/publish', async (req, res) => {
  if (MODE === 'hosted') return res.json({ available: false, hosted: true, changes: [] });
  try { res.json(await publish.status()); } catch (e) { sendError(res, e); }
});
app.post('/api/publish', async (req, res) => {
  if (MODE === 'hosted') return res.status(400).json({ error: 'On the hosted site, changes are already live.' });
  try {
    build.buildAll();
    res.json(await publish.publish(req.body.message));
  } catch (e) { sendError(res, e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

// ------------------------------------------------------------------ MP3 copies (needs ffmpeg)
let ffmpegCache;
function ffmpegPath() {
  if (ffmpegCache !== undefined) return Promise.resolve(ffmpegCache);
  const candidates = [process.env.FFMPEG, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean);
  return candidates.reduce((p, bin) => p.then((found) => found || new Promise((ok) => {
    execFile(bin, ['-version'], (err) => ok(err ? null : bin));
  })), Promise.resolve(null)).then((found) => (ffmpegCache = found));
}

async function makeMp3s(artist, album) {
  const bin = await ffmpegPath();
  if (!bin) throw new content.UserError('MP3 conversion needs ffmpeg. On a Mac: install Homebrew, then run “brew install ffmpeg”.');
  const { dir } = content.albumDir(artist, album);
  const files = fs.readdirSync(dir);
  const hasMp3 = new Set(files.filter((f) => /\.mp3$/i.test(f)).map((f) => f.replace(/\.mp3$/i, '').toLowerCase()));
  const todo = files.filter((f) => /\.(wav|flac|aiff?)$/i.test(f) && !hasMp3.has(f.replace(/\.\w+$/, '').toLowerCase()));
  for (const f of todo) {
    const out = path.join(dir, f.replace(/\.\w+$/, '.mp3'));
    await new Promise((ok, fail) => execFile(bin,
      ['-y', '-loglevel', 'error', '-i', path.join(dir, f), '-map', '0:a', '-codec:a', 'libmp3lame', '-b:a', '256k', '-map_metadata', '0', '-id3v2_version', '3', out],
      { timeout: 10 * 60 * 1000 },
      (err, _o, stderr) => (err ? fail(new Error(`Converting “${f}” failed: ${stderr || err.message}`)) : ok())));
  }
  return { converted: todo.length };
}

// ------------------------------------------------------------------ admin UI + the site
const noStore = (res) => res.set('Cache-Control', 'no-store');
app.use('/admin', express.static(path.join(__dirname, 'public'), { setHeaders: noStore }));
app.use('/admin', (req, res) => res.status(404).send('Not found'));

// The site's index.html gets a tiny script that refreshes it when content changes.
const LIVE = `<script>(function(){try{var es=new EventSource('/api/live');es.addEventListener('change',function(){try{sessionStorage.setItem('ae-skip-boot','1');}catch(e){}location.reload();});}catch(e){}})();</script>`;
app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  noStore(res);
  res.type('html').send(html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${LIVE}</body>`));
});
app.use((req, res, next) => (/^\/(node_modules|\.)/.test(req.path) ? res.status(404).end() : next()));
app.use(express.static(ROOT, { index: false, dotfiles: 'ignore', setHeaders: MODE === 'local' ? noStore : undefined }));

// ------------------------------------------------------------------ start
const result = build.buildAll();
app.listen(PORT, HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  æ admin   ${base}/admin`);
  console.log(`  æ site    ${base}/`);
  console.log(`  ${result.artists} artists · ${result.albums} albums · ${result.popups} pop-ups · ${result.media} gallery items`);
  console.log(MODE === 'local' ? '\n  Leave this window open while you edit. Ctrl+C to stop.\n' : '\n  Hosted mode: password required, edits go live immediately.\n');
  if (process.argv.includes('--open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [`${base}/admin`], () => {});
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the admin is probably already running.\n  Opening http://localhost:${PORT}/admin …\n`);
    if (process.argv.includes('--open')) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      execFile(opener, [`http://localhost:${PORT}/admin`], () => process.exit(1));
      return;
    }
    process.exit(1);
  }
  throw e;
});
