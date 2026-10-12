// assets/js/audioPlayer.js
// æ player
//   1. Artists on a merry-go-round; the front artist's releases sit small along the bottom.
//   2. Pick an artist and their albums pop up as 3D jewel cases you slide between.
//   3. Click the centred case: it spins, the lid flies open and the tracklist slides in.
// Loaded as an ES module (three.js comes from the import map in index.html).

import { ArtistRing } from './artistRing.js';

const catalog = window.musicCatalog || [];
const albumById = new Map(catalog.map(a => [a.id, a]));

// Artists come from the catalog build (data/roster.json + Catalogo folders).
// Older builds only have albums, so fall back to deriving artists from those.
const artists = (window.musicArtists && window.musicArtists.length
  ? window.musicArtists
  : [...new Set(catalog.map(a => a.artist))].map((name, i) => ({
      id: `ar_${i + 1}`, name, photo: null, albums: catalog.filter(a => a.artist === name).map(a => a.id),
    }))
).map(a => ({ ...a, albumList: (a.albums || []).map(id => albumById.get(id)).filter(Boolean) }));

const $ = id => document.getElementById(id);
const els = {
  root: $('ae-player'),
  back: $('aep-back'), crumb: $('aep-crumb'), count: $('aep-count'),
  ringWrap: $('aep-ring-wrap'), ring: $('aep-ring'),
  artistName: $('aep-artist-name'), artistMeta: $('aep-artist-meta'), strip: $('aep-strip'),
  stage: $('aep-stage'), capTitle: $('aep-cap-title'), capMeta: $('aep-cap-meta'),
  arrowPrev: $('aep-arrow-prev'), arrowNext: $('aep-arrow-next'), hint: $('aep-hint'),
  panel: $('aep-panel'), panelClose: $('aep-panel-close'),
  catno: $('aep-catno'), album: $('aep-album'), artist: $('aep-artist'), stats: $('aep-stats'), tracks: $('aep-tracks'),
  nowTitle: $('aep-now-title'), nowSub: $('aep-now-sub'),
  tCur: $('aep-t-cur'), tTot: $('aep-t-tot'), progress: $('aep-progress'), progressFill: $('aep-progress-fill'),
  play: $('aep-play'), prev: $('aep-prev'), next: $('aep-next'), vol: $('aep-vol'), volFill: $('aep-vol-fill'),
  mini: $('aep-mini'), miniInfo: $('aep-mini-info'), miniDisc: $('aep-mini-disc'), miniTitle: $('aep-mini-title'),
  miniSub: $('aep-mini-sub'), miniPlay: $('aep-mini-play'), miniNext: $('aep-mini-next'), miniFill: $('aep-mini-fill'),
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

const pad = (n, w = 2) => String(n).padStart(w, '0');
const catNo = album => `æ${pad(catalog.indexOf(album) + 1, 3)}`;
const photoFor = artist => artist.photo || (artist.albumList[0] && artist.albumList[0].coverArt) || null;
const releasesLabel = n => (n ? `${n} release${n === 1 ? '' : 's'}` : 'No releases yet');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const audio = new Audio();
audio.preload = 'metadata';

const state = {
  view: 'artists',      // 'artists' | 'albums'
  artistIdx: 0,         // artist at the front of the ring / whose albums are shown
  albumIdx: 0,          // centred case
  openAlbum: null,      // album whose tracklist is showing
  playingAlbum: null,
  index: -1,            // track index within playingAlbum
  volume: 0.7,
};

const durationCache = new Map(); // track.file -> seconds
let ring = null;
let stage = null;
let stagePromise = null;

// ---------------------------------------------------------------------------
// View 1 — artists
// ---------------------------------------------------------------------------
function initRing() {
  ring = new ArtistRing(els.ringWrap, els.ring, artists, { photoFor });
  els.ringWrap.artistRing = ring; // handy from the console
  ring.addEventListener('focus', e => showArtistInfo(e.detail.index));
  ring.addEventListener('select', e => enterArtist(e.detail.index));
  showArtistInfo(0);
}

function showArtistInfo(i) {
  if (state.view === 'artists') state.artistIdx = i;
  const a = artists[i];
  if (!a) return;
  els.artistName.textContent = a.name;
  els.artistMeta.textContent = releasesLabel(a.albumList.length);
  els.count.textContent = `${pad(i + 1)} / ${pad(artists.length)}`;
  renderStrip(a, i);
}

function renderStrip(artist, artistIdx) {
  els.strip.innerHTML = '';
  if (!artist.albumList.length) {
    const p = document.createElement('p');
    p.className = 'aep-strip-empty';
    p.textContent = 'New music soon';
    els.strip.appendChild(p);
    return;
  }
  artist.albumList.forEach((album, j) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aep-mini-case';
    b.setAttribute('aria-label', `Open ${album.albumTitle}`);
    b.innerHTML = '<span class="aep-mini-case-art"></span><span class="aep-mini-case-title"></span>';
    b.firstChild.style.backgroundImage = `url("${album.coverArt}")`;
    b.lastChild.textContent = album.albumTitle;
    b.style.setProperty('--d', `${j * 50}ms`);
    b.addEventListener('click', () => enterArtist(artistIdx, j));
    els.strip.appendChild(b);
  });
}

// ---------------------------------------------------------------------------
// View 2 — the artist's albums as cases
// ---------------------------------------------------------------------------
function ensureStage() {
  if (stage) return Promise.resolve(stage);
  if (!stagePromise) {
    stagePromise = import('./cdCase.js').then(({ CDStage }) => {
      stage = new CDStage(els.stage);
      els.stage.cdStage = stage; // handy from the console: $('#aep-stage').cdStage
      stage.addEventListener('focuschange', e => { state.albumIdx = e.detail.index; showCaption(); });
      stage.addEventListener('openchange', e => {
        const album = artists[state.artistIdx].albumList[e.detail.index];
        if (e.detail.open) openPanel(album); else if (state.openAlbum === album) closePanel();
      });
      stage.addEventListener('disctap', e => {
        const album = artists[state.artistIdx].albumList[e.detail.index];
        if (state.playingAlbum === album && state.index >= 0) togglePlay();
        else playAlbum(album, 0);
      });
      syncSpin();
      return stage;
    }).catch(err => {
      console.warn('[æ player] 3D view unavailable.', err);
      els.root.classList.add('aep-no3d');
      return null;
    });
  }
  return stagePromise;
}

async function enterArtist(i, albumIdx = 0) {
  const artist = artists[i];
  if (!artist) return;
  if (!artist.albumList.length) {
    ring.nudge();
    els.artistMeta.textContent = 'No releases yet — new music soon';
    return;
  }
  state.view = 'albums';
  state.artistIdx = i;
  state.albumIdx = albumIdx;
  els.root.dataset.view = 'albums';
  els.back.hidden = false;
  els.crumb.innerHTML = '';
  els.crumb.append('æ ', Object.assign(document.createElement('span'), { className: 'aep-crumb-sep', textContent: '/' }), ` ${artist.name}`);
  showCaption();
  const st = await ensureStage();
  if (!st) {
    // no WebGL: go straight to the tracklist
    openPanel(artist.albumList[albumIdx]);
    return;
  }
  if (state.view !== 'albums' || state.artistIdx !== i) return;
  await st.setAlbums(artist.albumList, albumIdx);
  st.canvas.focus({ preventScroll: true });
}

function backToArtists() {
  if (state.view === 'artists') return;
  if (stage && stage.isOpen) stage.close();
  closePanel();
  state.view = 'artists';
  els.root.dataset.view = 'artists';
  els.back.hidden = true;
  els.crumb.innerHTML = 'æ <span class="aep-crumb-sep">/</span> Artists';
  if (stage) stage.clear();
  ring.focusTo(state.artistIdx);
  showArtistInfo(state.artistIdx);
  els.ring.focus({ preventScroll: true });
}

function showCaption() {
  const artist = artists[state.artistIdx];
  const album = artist && artist.albumList[state.albumIdx];
  if (!album) return;
  els.capTitle.textContent = album.albumTitle;
  els.capMeta.textContent = `${catNo(album)} · ${album.tracks.length} track${album.tracks.length === 1 ? '' : 's'}`;
  els.count.textContent = `${pad(state.albumIdx + 1)} / ${pad(artist.albumList.length)}`;
  const many = artist.albumList.length > 1;
  els.arrowPrev.hidden = !many || state.albumIdx === 0;
  els.arrowNext.hidden = !many || state.albumIdx === artist.albumList.length - 1;
  updateHint();
}

function updateHint() {
  const artist = artists[state.artistIdx];
  const album = artist && artist.albumList[state.albumIdx];
  const playingHere = album && state.playingAlbum === album && !audio.paused;
  let text = '';
  if (state.openAlbum) text = playingHere ? 'Playing · Click the disc to pause' : 'Click the disc to play · Drag to turn';
  else if (artist && artist.albumList.length > 1) text = 'Click the case to open · Drag or scroll to browse';
  else text = 'Click the case to open';
  els.hint.textContent = text;
}

// ---------------------------------------------------------------------------
// View 3 — the opened album's tracklist
// ---------------------------------------------------------------------------
function panelSide() {
  return els.root.clientWidth < 700 ? 'bottom' : 'right';
}

function openPanel(album) {
  if (!album) return;
  state.openAlbum = album;
  els.catno.textContent = `${catNo(album)} / CD`;
  els.album.textContent = album.albumTitle;
  els.artist.textContent = album.artist;
  renderTracks();
  loadDurations(album);
  els.root.classList.add('is-open');
  els.panel.setAttribute('aria-hidden', 'false');
  els.panel.inert = false;
  if (stage) {
    const side = panelSide();
    stage.setPanelInset(side === 'right' ? els.panel.offsetWidth : els.panel.offsetHeight, side);
  }
  updateHint();
  updateMini();
}

function closePanel() {
  if (!state.openAlbum) return;
  state.openAlbum = null;
  els.root.classList.remove('is-open');
  els.panel.setAttribute('aria-hidden', 'true');
  els.panel.inert = true;
  if (stage) stage.setPanelInset(0);
  updateHint();
  updateMini();
}

function renderTracks() {
  const album = state.openAlbum;
  els.tracks.innerHTML = '';
  if (!album) return;
  album.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'aep-track';
    li.dataset.index = String(i);
    li.style.setProperty('--d', `${80 + i * 28}ms`);
    li.innerHTML = `
      <button type="button" class="aep-track-btn">
        <span class="aep-track-num"><span class="n">${pad(i + 1)}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
        <span class="aep-track-title"></span>
        <span class="aep-track-dur"></span>
      </button>`;
    li.querySelector('.aep-track-title').textContent = cleanTitle(track.title);
    if (durationCache.has(track.file)) li.querySelector('.aep-track-dur').textContent = formatTime(durationCache.get(track.file));
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
  const here = state.openAlbum && state.playingAlbum === state.openAlbum;
  els.tracks.querySelectorAll('.aep-track').forEach(li => {
    const cur = here && Number(li.dataset.index) === state.index;
    li.classList.toggle('is-current', cur);
    li.classList.toggle('is-paused', cur && audio.paused);
    if (cur) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
  });
}

function updateStats() {
  const album = state.openAlbum;
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
        if (state.openAlbum === album) {
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
  els.miniFill.style.width = '0%';
  els.tCur.textContent = '0:00';
  els.tTot.textContent = durationCache.has(track.file) ? formatTime(durationCache.get(track.file)) : '0:00';
  markCurrentTrack();
  updateMini();
  setMediaSession(album, track);
}

function togglePlay() {
  if (state.index < 0) {
    const album = state.openAlbum;
    if (album) playAlbum(album, 0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
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

function syncSpin() {
  if (stage) stage.setSpinningAlbum(!audio.paused && state.playingAlbum ? state.playingAlbum.id : null);
}

function onPlayState() {
  els.root.classList.toggle('is-playing', !audio.paused);
  const label = audio.paused ? 'Play' : 'Pause';
  els.play.setAttribute('aria-label', label);
  els.miniPlay.setAttribute('aria-label', label);
  markCurrentTrack();
  syncSpin();
  updateHint();
  updateMini();
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
// Mini now-playing bar (while browsing)
// ---------------------------------------------------------------------------
function updateMini() {
  const album = state.playingAlbum;
  const show = !!album && state.index >= 0 && state.openAlbum !== album;
  els.mini.hidden = !show;
  if (!album || state.index < 0) return;
  els.miniTitle.textContent = cleanTitle(album.tracks[state.index].title);
  els.miniSub.textContent = album.artist;
  els.miniDisc.style.backgroundImage = `url("${album.coverArt}")`;
}

async function goToPlaying() {
  const album = state.playingAlbum;
  if (!album) return;
  const ai = artists.findIndex(a => a.albumList.includes(album));
  if (ai < 0) return;
  const j = artists[ai].albumList.indexOf(album);
  if (state.view === 'albums' && state.artistIdx === ai && stage) {
    stage.focusTo(j);
    setTimeout(() => stage.open(), 350);
    return;
  }
  ring.focusTo(ai, { instant: true });
  showArtistInfo(ai);
  await enterArtist(ai, j);
  if (stage) setTimeout(() => stage.open(), 650);
}

// ---------------------------------------------------------------------------
// Sliders (seek + volume), pointer + keyboard
// ---------------------------------------------------------------------------
let seeking = false;

audio.addEventListener('timeupdate', () => {
  if (!isFinite(audio.duration)) return;
  const p = audio.currentTime / audio.duration;
  els.miniFill.style.width = `${p * 100}%`;
  if (seeking) return;
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
    e.stopPropagation();
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
      e.stopPropagation();
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

slider(els.vol, { onMove: setVolume, onKey: dir => setVolume(state.volume + dir * 0.05) });

// ---------------------------------------------------------------------------
// Buttons + keys
// ---------------------------------------------------------------------------
els.play.addEventListener('click', togglePlay);
els.next.addEventListener('click', playNext);
els.prev.addEventListener('click', playPrev);
els.miniPlay.addEventListener('click', togglePlay);
els.miniNext.addEventListener('click', playNext);
els.miniInfo.addEventListener('click', goToPlaying);
els.back.addEventListener('click', backToArtists);
els.panelClose.addEventListener('click', () => (stage ? stage.close() : closePanel()));
els.arrowPrev.addEventListener('click', () => stage && stage.prev());
els.arrowNext.addEventListener('click', () => stage && stage.next());

els.root.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.openAlbum) { e.preventDefault(); stage ? stage.close() : closePanel(); }
    else if (state.view === 'albums') { e.preventDefault(); backToArtists(); }
  }
});

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  if (e.code === 'Space' && (state.index >= 0 || els.root.contains(t))) {
    if (t.closest && t.closest('.aep-ring')) return; // the ring uses Space to pick an artist
    e.preventDefault();
    togglePlay();
  }
});

// Interacting inside the player shouldn't start a window drag or desktop selection
['pointerdown', 'mousedown'].forEach(type => els.root.addEventListener(type, e => e.stopPropagation()));

// keep the open case clear of the panel when the window is resized
new ResizeObserver(() => {
  if (state.openAlbum && stage) {
    const side = panelSide();
    stage.setPanelInset(side === 'right' ? els.panel.offsetWidth : els.panel.offsetHeight, side);
  }
}).observe(els.root);

// ---------------------------------------------------------------------------
// Boot — nothing heavy loads until the player window is first opened
// ---------------------------------------------------------------------------
function whenFirstShown(el, cb) {
  const ro = new ResizeObserver(entries => {
    if (entries.some(e => e.contentRect.width > 0 && e.contentRect.height > 0)) {
      ro.disconnect();
      cb();
    }
  });
  ro.observe(el);
}

(function boot() {
  let v = 0.7;
  try { const saved = parseFloat(localStorage.getItem('ae_volume')); if (isFinite(saved)) v = saved; } catch (e) {}
  setVolume(v);
  els.panel.inert = true;
  whenFirstShown(els.root, () => {
    initRing();
    // warm up three.js in the background so the first artist opens instantly
    const idle = window.requestIdleCallback || (cb => setTimeout(cb, 600));
    idle(() => ensureStage());
  });
})();
