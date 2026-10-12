// assets/js/audioPlayer.js
// æ player — a 3D jewel case you open and spin, plus a tracklist and transport.
// Loaded as an ES module (needs the import map in index.html for three.js).

const catalog = window.musicCatalog || [];

const $ = id => document.getElementById(id);
const els = {
  root: $('ae-player'),
  stage: $('aep-stage'),
  hint: $('aep-hint'),
  picker: $('aep-picker'),
  discNum: $('aep-disc-num'),
  album: $('aep-album'),
  artist: $('aep-artist'),
  stats: $('aep-stats'),
  tracks: $('aep-tracks'),
  nowTitle: $('aep-now-title'),
  nowSub: $('aep-now-sub'),
  tCur: $('aep-t-cur'),
  tTot: $('aep-t-tot'),
  progress: $('aep-progress'),
  progressFill: $('aep-progress-fill'),
  play: $('aep-play'),
  prev: $('aep-prev'),
  next: $('aep-next'),
  vol: $('aep-vol'),
  volFill: $('aep-vol-fill'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Filenames carry studio leftovers ("Do Inicio Master Final : ins&outs") — show the song name.
function cleanTitle(title) {
  const t = String(title || '')
    .replace(/\s+master\s+final\b.*$/i, '')
    .replace(/\s+\(?(final\s+)?master(ed)?\)?\s*$/i, '')
    .trim();
  return t || title;
}

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const audio = new Audio();
audio.preload = 'metadata';

const state = {
  shownAlbum: null,      // album on the stage / in the panel
  playingAlbum: null,    // album the queue came from
  index: -1,             // track index within playingAlbum
  volume: 0.7,
};

const durationCache = new Map(); // track.file -> seconds

// Nothing heavy (three.js, cover textures, track headers) loads until the
// player window is actually opened for the first time.
let activated = false;
function whenFirstShown(el, cb) {
  const ro = new ResizeObserver(entries => {
    if (entries.some(e => e.contentRect.width > 0 && e.contentRect.height > 0)) {
      ro.disconnect();
      cb();
    }
  });
  ro.observe(el);
}

// ---------------------------------------------------------------------------
// 3D stage (falls back to a flat disc if WebGL isn't available)
// ---------------------------------------------------------------------------
let stage = null;

async function initStage() {
  try {
    const { CDStage } = await import('./cdCase.js');
    stage = new CDStage(els.stage);
    els.stage.cdStage = stage; // handy from the console: $('#aep-stage').cdStage
    stage.addEventListener('disctap', () => {
      if (!state.shownAlbum) return;
      if (state.playingAlbum === state.shownAlbum && state.index >= 0) togglePlay();
      else playAlbum(state.shownAlbum, 0);
    });
    stage.addEventListener('openchange', updateHint);
    if (state.shownAlbum) stage.setAlbum(state.shownAlbum);
  } catch (err) {
    console.warn('[æ player] 3D stage unavailable, using flat disc.', err);
    els.root.classList.add('aep-flat');
    renderFlatDisc();
  }
}

function renderFlatDisc() {
  let disc = els.stage.querySelector('.aep-flat-disc');
  if (!disc) {
    disc = document.createElement('button');
    disc.className = 'aep-flat-disc';
    disc.setAttribute('aria-label', 'Play or pause');
    disc.addEventListener('click', () => {
      if (!state.shownAlbum) return;
      if (state.playingAlbum === state.shownAlbum && state.index >= 0) togglePlay();
      else playAlbum(state.shownAlbum, 0);
    });
    els.stage.prepend(disc);
  }
  disc.style.backgroundImage = state.shownAlbum ? `url("${state.shownAlbum.coverArt}")` : '';
}

function syncSpin() {
  const spinning = !audio.paused && state.playingAlbum && state.playingAlbum === state.shownAlbum;
  if (stage) stage.setSpinning(spinning);
  els.root.classList.toggle('is-spinning', !!spinning);
}

function updateHint() {
  let text;
  const playingHere = state.playingAlbum === state.shownAlbum && !audio.paused;
  if (!state.shownAlbum) text = 'no discs in the catalogue yet';
  else if (playingHere) text = 'spinning · tap the disc to pause';
  else if (stage && stage.isOpen) text = 'tap the disc to play · tap the case to close';
  else text = 'tap the case to open · drag to turn it';
  els.hint.textContent = text;
}

// ---------------------------------------------------------------------------
// Picker (one disc per album)
// ---------------------------------------------------------------------------
function renderPicker() {
  els.picker.innerHTML = '';
  catalog.forEach((album, i) => {
    const b = document.createElement('button');
    b.className = 'aep-pick';
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', `${album.albumTitle} — ${album.artist}`);
    b.title = `${album.albumTitle} — ${album.artist}`;
    b.dataset.id = album.id;
    const disc = document.createElement('span');
    disc.className = 'aep-pick-disc';
    disc.style.backgroundImage = `url("${album.coverArt}")`;
    b.appendChild(disc);
    b.addEventListener('click', () => showAlbum(album));
    els.picker.appendChild(b);
  });
  els.picker.hidden = catalog.length < 2;
}

function markPicker() {
  els.picker.querySelectorAll('.aep-pick').forEach(b => {
    const on = state.shownAlbum && b.dataset.id === state.shownAlbum.id;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.classList.toggle('is-playing', !!(state.playingAlbum && b.dataset.id === state.playingAlbum.id && !audio.paused));
  });
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function showAlbum(album) {
  if (!album || album === state.shownAlbum) return;
  state.shownAlbum = album;
  if (stage) stage.setAlbum(album);
  else if (els.root.classList.contains('aep-flat')) renderFlatDisc();
  // (if the 3D stage is still loading, initStage() shows the album once it's ready)

  els.discNum.textContent = String(catalog.indexOf(album) + 1);
  els.album.textContent = album.albumTitle;
  els.artist.textContent = album.artist;
  renderTracks();
  if (activated) loadDurations(album);
  markPicker();
  syncSpin();
  updateHint();
}

function renderTracks() {
  const album = state.shownAlbum;
  els.tracks.innerHTML = '';
  if (!album) return;
  album.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'aep-track';
    li.dataset.index = String(i);
    li.innerHTML = `
      <button type="button" class="aep-track-btn">
        <span class="aep-track-num"><span class="n">${i + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
        <span class="aep-track-title">${escapeHtml(cleanTitle(track.title))}</span>
        <span class="aep-track-dur">${durationCache.has(track.file) ? formatTime(durationCache.get(track.file)) : ''}</span>
      </button>`;
    li.querySelector('button').addEventListener('click', () => {
      if (state.playingAlbum === album && state.index === i) togglePlay();
      else playAlbum(album, i);
    });
    els.tracks.appendChild(li);
  });
  markCurrentTrack();
  updateStats();
}

function markCurrentTrack() {
  const here = state.playingAlbum === state.shownAlbum;
  els.tracks.querySelectorAll('.aep-track').forEach(li => {
    const cur = here && Number(li.dataset.index) === state.index;
    li.classList.toggle('is-current', cur);
    li.classList.toggle('is-paused', cur && audio.paused);
    if (cur) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
  });
}

function updateStats() {
  const album = state.shownAlbum;
  if (!album) return;
  const n = album.tracks.length;
  const known = album.tracks.map(t => durationCache.get(t.file)).filter(v => isFinite(v));
  let txt = `${n} track${n === 1 ? '' : 's'}`;
  if (known.length === n && n) txt += ` · ${Math.round(known.reduce((a, b) => a + b, 0) / 60)} min`;
  els.stats.textContent = txt;
}

// Read each track's length from its header (preload=metadata only fetches the start of the file).
function loadDurations(album) {
  const queue = album.tracks.filter(t => !durationCache.has(t.file));
  let active = 0;
  const pump = () => {
    while (active < 3 && queue.length) {
      const track = queue.shift();
      active++;
      const probe = new Audio();
      probe.preload = 'metadata';
      const done = () => {
        if (isFinite(probe.duration)) durationCache.set(track.file, probe.duration);
        probe.removeAttribute('src');
        probe.load();
        active--;
        if (state.shownAlbum === album) {
          const i = album.tracks.indexOf(track);
          const cell = els.tracks.querySelector(`.aep-track[data-index="${i}"] .aep-track-dur`);
          if (cell && durationCache.has(track.file)) cell.textContent = formatTime(durationCache.get(track.file));
          updateStats();
        }
        pump();
      };
      probe.addEventListener('loadedmetadata', done, { once: true });
      probe.addEventListener('error', done, { once: true });
      probe.src = track.file;
    }
  };
  pump();
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
function playAlbum(album, index) {
  state.playingAlbum = album;
  loadTrack(index);
  if (stage) stage.setOpen(true);
  audio.play().catch(() => {});
}

function loadTrack(index) {
  const album = state.playingAlbum;
  if (!album || index < 0 || index >= album.tracks.length) return;
  state.index = index;
  const track = album.tracks[index];
  audio.src = track.file;
  els.nowTitle.textContent = cleanTitle(track.title);
  els.nowSub.textContent = `${album.artist} — ${album.albumTitle}`;
  els.progressFill.style.width = '0%';
  els.tCur.textContent = '0:00';
  els.tTot.textContent = durationCache.has(track.file) ? formatTime(durationCache.get(track.file)) : '0:00';
  markCurrentTrack();
  setMediaSession(album, track);
}

function togglePlay() {
  if (state.index < 0) {
    if (state.shownAlbum) playAlbum(state.shownAlbum, 0);
    return;
  }
  if (audio.paused) {
    if (stage) stage.setOpen(true);
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function playNext() {
  const album = state.playingAlbum;
  if (!album) return;
  if (state.index < album.tracks.length - 1) {
    loadTrack(state.index + 1);
    audio.play().catch(() => {});
  } else {
    audio.pause();
    audio.currentTime = 0;
  }
}

function playPrev() {
  if (audio.currentTime > 3 || state.index <= 0) {
    audio.currentTime = 0;
    return;
  }
  loadTrack(state.index - 1);
  audio.play().catch(() => {});
}

function setMediaSession(album, track) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cleanTitle(track.title),
      artist: album.artist,
      album: album.albumTitle,
      artwork: [{ src: album.coverArt, sizes: '512x512' }],
    });
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', playPrev);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);
  } catch (e) { /* not supported everywhere */ }
}

function onPlayState() {
  els.root.classList.toggle('is-playing', !audio.paused);
  els.play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  markCurrentTrack();
  markPicker();
  syncSpin();
  updateHint();
}

audio.addEventListener('play', onPlayState);
audio.addEventListener('pause', onPlayState);
audio.addEventListener('ended', playNext);
audio.addEventListener('loadedmetadata', () => {
  const album = state.playingAlbum;
  const track = album && album.tracks[state.index];
  if (track && isFinite(audio.duration)) durationCache.set(track.file, audio.duration);
  els.tTot.textContent = formatTime(audio.duration);
});

// ---------------------------------------------------------------------------
// Sliders (seek + volume), pointer + keyboard
// ---------------------------------------------------------------------------
let seeking = false;

audio.addEventListener('timeupdate', () => {
  if (seeking || !isFinite(audio.duration)) return;
  const p = audio.currentTime / audio.duration;
  els.progressFill.style.width = `${p * 100}%`;
  els.progress.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  els.tCur.textContent = formatTime(audio.currentTime);
});

function slider(el, { onMove, onCommit, onKey }) {
  const posFrom = e => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a window drag
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    onMove(posFrom(e));
    const move = ev => onMove(posFrom(ev));
    const up = ev => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onCommit && onCommit(posFrom(ev));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onKey(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
}

slider(els.progress, {
  onMove: p => {
    if (!isFinite(audio.duration)) return;
    seeking = true;
    els.progressFill.style.width = `${p * 100}%`;
    els.tCur.textContent = formatTime(p * audio.duration);
  },
  onCommit: p => {
    if (isFinite(audio.duration)) audio.currentTime = p * audio.duration;
    seeking = false;
  },
  onKey: dir => {
    if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + dir * 5));
  },
});

function setVolume(v) {
  state.volume = Math.max(0, Math.min(1, v));
  audio.volume = state.volume;
  els.volFill.style.width = `${state.volume * 100}%`;
  els.vol.setAttribute('aria-valuenow', String(Math.round(state.volume * 100)));
  els.root.classList.toggle('is-muted', state.volume === 0);
  try { localStorage.setItem('ae_volume', String(state.volume)); } catch (e) {}
}

slider(els.vol, {
  onMove: setVolume,
  onKey: dir => setVolume(state.volume + dir * 0.05),
});

// ---------------------------------------------------------------------------
// Buttons + keys
// ---------------------------------------------------------------------------
els.play.addEventListener('click', togglePlay);
els.next.addEventListener('click', playNext);
els.prev.addEventListener('click', playPrev);

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  if (e.code === 'Space' && (state.index >= 0 || els.root.contains(t))) {
    e.preventDefault();
    togglePlay();
  }
});

// Clicks inside the player shouldn't start a window drag
els.stage.addEventListener('pointerdown', e => e.stopPropagation());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(function boot() {
  let v = 0.7;
  try { const saved = parseFloat(localStorage.getItem('ae_volume')); if (isFinite(saved)) v = saved; } catch (e) {}
  setVolume(v);
  renderPicker();
  if (catalog.length) showAlbum(catalog[0]);
  else updateHint();
  whenFirstShown(els.root, () => {
    activated = true;
    if (state.shownAlbum) loadDurations(state.shownAlbum);
    initStage();
  });
})();
