// assets/js/siteContent.js
// Applies the editable site settings (data/settings.json → siteSettings.js) and builds
// the artist folders + artist windows from the catalog (musicData.js).
// Runs before the desktop scripts so they find these elements when they bind events.
(function () {
  const settings = window.aeSiteSettings || {};
  const artists = window.musicArtists || [];

  const esc = (s = '') => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ---------- title ----------
  if (settings.siteTitle) document.title = settings.siteTitle;

  // ---------- background ----------
  const bg = settings.background || {};
  const body = document.body;
  if (bg.color) body.style.backgroundColor = bg.color;
  if (bg.image !== undefined) body.style.backgroundImage = bg.image ? `url("${encodeURI(decodeURI(bg.image))}")` : 'none';
  if (bg.fit === 'tile') {
    body.style.backgroundSize = 'auto';
    body.style.backgroundRepeat = 'repeat';
    body.style.backgroundPosition = 'top left';
  } else if (bg.fit === 'contain' || bg.fit === 'cover') {
    body.style.backgroundSize = bg.fit;
    body.style.backgroundRepeat = 'no-repeat';
    body.style.backgroundPosition = 'center';
  }

  // ---------- artist folders + windows ----------
  // "Nicø" → "nico", "PÉROLA" → "perola"
  const slug = (name) => String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').replace(/æ/gi, 'ae')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artist';

  const list = document.querySelector('#artists-window .window-content');
  const anchor = document.getElementById('terminal-window');
  if (!list || !anchor) return;

  const used = new Set();
  const sorted = artists.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  for (const artist of sorted) {
    let id = `${slug(artist.name)}-window`;
    for (let n = 2; used.has(id) || document.getElementById(id); n++) id = `${slug(artist.name)}-${n}-window`;
    used.add(id);
    const name = esc(artist.name);

    list.insertAdjacentHTML('beforeend', `
      <div class="folder window-opener" data-window="${id}" tabindex="0">
        <img src="assets/icons/folder-icon.png" alt="${name}" />
        <span class="folder-label">${name}</span>
      </div>`);

    const about = artist.photo || artist.bio
      ? `<div class="ae-artist-about" style="display:flex;gap:16px;align-items:flex-start;padding:16px;line-height:1.5;">
           ${artist.photo ? `<img src="${esc(artist.photo)}" alt="" style="width:140px;height:140px;object-fit:cover;border-radius:6px;flex:none;" />` : ''}
           ${artist.bio ? `<p style="white-space:pre-line;margin:0;">${esc(artist.bio)}</p>` : ''}
         </div>`
      : '';

    anchor.insertAdjacentHTML('beforebegin', `
  <div id="${id}" class="window" style="display:none;">
    <div class="window-header">
      <div class="window-controls">
        <button class="close-button" aria-label="Close ${name} window"></button>
        <button class="minimize-button" aria-label="Minimize ${name} window"></button>
        <button class="fullscreen-button" aria-label="Maximize ${name} window"></button>
      </div>
      <span class="window-title">${name}</span>
    </div>
    <div class="window-content">${about}</div>
  </div>
`);
  }
})();
