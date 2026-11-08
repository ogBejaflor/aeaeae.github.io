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

  const albumsById = new Map((window.musicCatalog || []).map((a) => [a.id, a]));
  const fileName = (src) => { try { return decodeURIComponent(src.split('/').pop()); } catch { return src.split('/').pop(); } };
  const short = (s) => (s.length > 14 ? s.slice(0, 12) + '…' : s);

  // A text document icon (page with a folded corner and lines)
  const TXT_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80"><path d="M6 2h38l18 18v54a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#f4f4f2" stroke="#c9c9c4" stroke-width="2"/>' +
    '<path d="M44 2v14a4 4 0 0 0 4 4h14" fill="#dcdcd6" stroke="#c9c9c4" stroke-width="2"/>' +
    '<g stroke="#9a9a94" stroke-width="3" stroke-linecap="round"><path d="M14 32h36M14 41h36M14 50h36M14 59h24"/></g>' +
    '<text x="32" y="74" font-family="Helvetica,Arial,sans-serif" font-size="9" font-weight="700" fill="#7a7a74" text-anchor="middle">TXT</text></svg>');

  function textFile(label, title, text) {
    return `
      <div class="folder file-item in-grid" tabindex="0" title="${esc(label)}" data-text-title="${esc(title)}" data-text="${esc(text)}">
        <img src="${TXT_ICON}" class="file-thumb is-doc" alt="" draggable="false" />
        <span class="folder-label">${esc(label)}</span>
      </div>`;
  }

  // Document icon: a page with a coloured band naming the format (PDF, DOC, TXT…)
  const docIcon = (ext) => 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80"><path d="M6 2h38l18 18v54a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#f4f4f2" stroke="#c9c9c4" stroke-width="2"/>' +
    '<path d="M44 2v14a4 4 0 0 0 4 4h14" fill="#dcdcd6" stroke="#c9c9c4" stroke-width="2"/>' +
    '<g stroke="#b3b3ad" stroke-width="3" stroke-linecap="round"><path d="M14 30h36M14 38h36M14 46h24"/></g>' +
    `<rect x="8" y="54" width="48" height="16" rx="3" fill="${ext === 'pdf' ? '#d4382c' : /^(doc|docx|odt|pages|rtf)$/.test(ext) ? '#2f63d6' : '#7a7a74'}"/>` +
    `<text x="32" y="66.5" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">${ext.toUpperCase().slice(0, 4)}</text></svg>`);

  function docFile(f) {
    return `
      <div class="folder file-item in-grid" tabindex="0" title="${esc(f.name)}" data-doc-src="${esc(f.src)}" data-doc-ext="${esc(f.ext)}" data-doc-name="${esc(f.name)}">
        <img src="${docIcon(f.ext)}" class="file-thumb is-doc" alt="" draggable="false" />
        <span class="folder-label">${esc(short(f.name))}</span>
      </div>`;
  }

  function imageFile(src, label, type = 'image') {
    const data = { src, type, filename: fileName(src) };
    return `
      <div class="folder file-item in-grid" tabindex="0" title="${esc(label)}" data-media-data="${esc(JSON.stringify(data))}">
        ${type === 'video'
          ? `<video src="${esc(src)}" class="file-thumb" muted preload="metadata"></video>`
          : `<img src="${esc(src)}" class="file-thumb" alt="" loading="lazy" draggable="false" />`}
        <span class="folder-label">${esc(short(label))}</span>
      </div>`;
  }

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

    // Files inside the artist's folder: Bio.txt, documents, their photo, release covers, added pictures.
    const files = [];
    if (artist.bio) files.push(textFile('Bio.txt', `${artist.name} — Bio`, artist.bio));
    const extras = artist.files || [];
    for (const f of extras.filter((x) => x.kind === 'doc')) files.push(docFile(f));
    if (artist.photo) files.push(imageFile(artist.photo, fileName(artist.photo)));
    for (const id of artist.albums || []) {
      const album = albumsById.get(id);
      if (album && album.coverArt && !/default-album-art/.test(album.coverArt)) {
        files.push(imageFile(album.coverArt, album.albumTitle));
      }
    }
    // pictures added to the artist's folder (also in the Gallery)
    for (const f of extras.filter((x) => x.kind !== 'doc')) files.push(imageFile(f.src, f.name, f.kind));
    const about = files.join('');

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
