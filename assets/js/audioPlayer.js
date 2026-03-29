// assets/js/audioPlayer.js

(function() {
  const catalog = window.musicCatalog || [];
  
  // UI Elements
  const gridEl = document.getElementById('audio-grid');
  const tracklistEl = document.getElementById('audio-tracklist');
  const viewTitle = document.getElementById('audio-view-title');
  const navItems = document.querySelectorAll('.audio-nav li');
  
  // Player UI
  const btnPlay = document.getElementById('btn-play');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const npArt = document.getElementById('np-art');
  const npTitle = document.getElementById('np-title');
  const npArtist = document.getElementById('np-artist');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const volContainer = document.getElementById('vol-container');
  const volFill = document.getElementById('vol-fill');
  
  // State
  let audio = new Audio();
  let queue = [];
  let currentIndex = -1;
  let isPlaying = false;
  
  // 1. Navigation & Views
  function getRecentAlbums() {
    let recentIds = [];
    try { recentIds = JSON.parse(localStorage.getItem('ae_recent_albums')) || []; } catch(e){}
    let recent = recentIds.map(id => catalog.find(a => a.id === id)).filter(Boolean);
    let others = catalog.filter(a => !recentIds.includes(a.id));
    return [...recent, ...others];
  }

  function markAlbumRecent(albumId) {
    let recentIds = [];
    try { recentIds = JSON.parse(localStorage.getItem('ae_recent_albums')) || []; } catch(e){}
    recentIds = recentIds.filter(id => id !== albumId);
    recentIds.unshift(albumId);
    if (recentIds.length > 20) recentIds.pop();
    localStorage.setItem('ae_recent_albums', JSON.stringify(recentIds));
  }

  function renderGrid(albums) {
    gridEl.style.display = 'grid';
    gridEl.classList.remove('artist-list');
    tracklistEl.style.display = 'none';
    gridEl.innerHTML = '';
    
    albums.forEach(album => {
      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <img src="${album.coverArt}" class="album-cover" alt="Cover" onerror="this.src='assets/images/default-album-art.png'">
        <div class="album-title">${album.albumTitle}</div>
        <div class="album-artist">${album.artist}</div>
      `;
      card.addEventListener('click', () => renderTracklist(album));
      gridEl.appendChild(card);
    });
  }

  function renderListenNowView() {
    viewTitle.textContent = 'Listen Now';
    renderGrid(getRecentAlbums());
  }

  function renderAlbumsView(filterArtist = null) {
    viewTitle.textContent = filterArtist ? `${filterArtist} Albums` : 'Albums';
    const source = filterArtist ? catalog.filter(a => a.artist === filterArtist) : catalog;
    const sorted = [...source].sort((a,b) => a.albumTitle.localeCompare(b.albumTitle));
    renderGrid(sorted);
  }

  function renderArtistsView() {
    viewTitle.textContent = 'Artists';
    gridEl.style.display = 'block';
    gridEl.classList.add('artist-list');
    tracklistEl.style.display = 'none';
    gridEl.innerHTML = '';

    const artists = [...new Set(catalog.map(a => a.artist))].sort();
    
    artists.forEach(artist => {
      const item = document.createElement('div');
      item.className = 'artist-list-item';
      item.innerHTML = `
        <div class="artist-name">${artist}</div>
        <div class="artist-arrow">›</div>
      `;
      // When clicking an artist, show their albums
      item.addEventListener('click', () => {
        // Un-highlight nav slightly or keep "Artists" active, 
        // but render the filtered albums.
        renderAlbumsView(artist);
      });
      gridEl.appendChild(item);
    });
  }
  
  function renderTracklist(album) {
    gridEl.style.display = 'none';
    tracklistEl.style.display = 'block';
    viewTitle.textContent = album.albumTitle;
    
    let html = `
      <div class="tracklist-header">
        <img src="${album.coverArt}" class="tracklist-cover" onerror="this.src='assets/images/default-album-art.png'">
        <div class="tracklist-info">
          <h1>${album.albumTitle}</h1>
          <h3>${album.artist}</h3>
          <button class="track-play-btn" id="tl-play">Play Album</button>
        </div>
      </div>
      <div class="tracklist-tracks">
    `;
    
    album.tracks.forEach((track, idx) => {
      // Check if this track is currently playing
      const isCurrent = (queue[currentIndex] && queue[currentIndex].id === track.id);
      
      html += `
        <div class="track-item ${isCurrent ? 'playing' : ''}" data-index="${idx}">
          <div class="track-num">${idx + 1}</div>
          <div class="track-name">${track.title}</div>
          <div class="track-duration">${track.duration || '--'}</div>
        </div>
      `;
    });
    html += `</div>`;
    tracklistEl.innerHTML = html;
    
    document.getElementById('tl-play').addEventListener('click', () => {
      playQueue(album, 0);
    });
    
    // Track clicks
    tracklistEl.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        playQueue(album, idx);
      });
    });
  }
  
  navItems.forEach(nav => {
    nav.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      nav.classList.add('active');
      const view = nav.getAttribute('data-view');
      if (view === 'listen-now') renderListenNowView();
      else if (view === 'artists') renderArtistsView();
      else if (view === 'albums') renderAlbumsView();
    });
  });

  // 2. Playback Logic
  function playQueue(album, index) {
    queue = album.tracks.map(t => ({...t, albumArtist: album.artist, cover: album.coverArt}));
    markAlbumRecent(album.id);
    loadTrack(index);
    audio.play();
  }
  
  function loadTrack(index) {
    if (index < 0 || index >= queue.length) return;
    currentIndex = index;
    const track = queue[currentIndex];
    
    audio.src = track.file;
    audio.load();
    
    // Update UI
    npTitle.textContent = track.title;
    npArtist.textContent = track.albumArtist;
    npArt.src = track.cover;
    
    updateActiveTrackStyle();
  }
  
  function updateActiveTrackStyle() {
    document.querySelectorAll('.track-item').forEach(el => el.classList.remove('playing'));
    if (!queue[currentIndex]) return;
    const currentId = queue[currentIndex].id;
    
    // If we are currently viewing the tracklist logic, the IDs or index might match
    // To be precise we could store track ids in the DOM, but for now we rely on matching text/durations.
    // Or simpler: re-render the tracklist if it's open and matches the album
    // Since we don't hold state of "current open album", it's a minor detail.
  }
  
  function togglePlay() {
    if (queue.length === 0) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }
  
  function playNext() {
    if (currentIndex < queue.length - 1) {
      loadTrack(currentIndex + 1);
      audio.play();
    }
  }
  
  function playPrev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (currentIndex > 0) {
      loadTrack(currentIndex - 1);
      audio.play();
    }
  }
  
  // 3. Audio Events & Controls
  audio.addEventListener('play', () => {
    isPlaying = true;
    btnPlay.src = 'assets/images/btn-pause.png'; 
    // Fallback if image doesn't exist
    btnPlay.alt = "Pause";
  });
  
  audio.addEventListener('pause', () => {
    isPlaying = false;
    btnPlay.src = 'assets/images/btn-play.png';
    btnPlay.alt = "Play";
  });
  
  audio.addEventListener('ended', () => {
    playNext();
  });
  
  let isDraggingProgress = false;
  let isDraggingVolume = false;

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const current = audio.currentTime;
    const total = audio.duration;
    
    if (!isDraggingProgress) {
      progressFill.style.width = `${(current / total) * 100}%`;
      timeCurrent.textContent = formatTime(current);
    }
    timeTotal.textContent = formatTime(total);
  });
  
  function formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
  
  // 4. Scrubbing & Volume (Drag Support)
  function updateProgressDrag(e) {
    if (!audio.duration) return;
    const rect = progressContainer.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    progressFill.style.width = `${pos * 100}%`;
    timeCurrent.textContent = formatTime(pos * audio.duration);
  }

  progressContainer.addEventListener('mousedown', (e) => {
    isDraggingProgress = true;
    updateProgressDrag(e);
  });
  
  function updateVolumeDrag(e) {
    const rect = volContainer.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    audio.volume = pos;
    volFill.style.width = `${pos * 100}%`;
  }

  volContainer.addEventListener('mousedown', (e) => {
    isDraggingVolume = true;
    updateVolumeDrag(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) updateProgressDrag(e);
    if (isDraggingVolume) updateVolumeDrag(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (isDraggingProgress) {
      if (audio.duration) {
        const rect = progressContainer.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));
        audio.currentTime = pos * audio.duration;
      }
      isDraggingProgress = false;
    }
    if (isDraggingVolume) {
      isDraggingVolume = false;
    }
  });
  
  // Attach buttons
  btnPlay.addEventListener('click', togglePlay);
  btnNext.addEventListener('click', playNext);
  btnPrev.addEventListener('click', playPrev);
  
  // Set initial volume
  audio.volume = 0.5;
  volFill.style.width = '50%';
  
  // Spacebar Play/Pause
  window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    
    if (e.code === 'Space') {
      e.preventDefault(); // Prevent scrolling down
      if (queue.length > 0) {
        togglePlay();
      }
    }
  });

  // Boot
  renderListenNowView();
})();
