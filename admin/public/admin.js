// æ admin — plain JavaScript, no build step.
// Talks to the server in admin/server.js through /api. Every edit saves straight away.
(() => {
  'use strict';

  // ------------------------------------------------------------ state
  let S = null;                 // content from the server (/api/state)
  let PUB = null;               // publish status (/api/publish)
  const ui = {
    page: (location.hash.slice(1) || 'artists'),
    artist: null,               // selected artist name
    open: new Set(),            // open album keys "artist/folder"
    folder: '*',                // gallery folder filter ('*' = all)
    uploads: {},                // key → percent
    bust: Date.now(),           // changes after uploads so replaced images reload
  };
  const PAGES = [
    ['artists', 'Artists'],
    ['popups', 'Pop-ups'],
    ['desktop', 'Desktop'],
    ['gallery', 'Gallery'],
    ['deleted', 'Deleted'],
  ];

  // ------------------------------------------------------------ helpers
  const $app = document.getElementById('app');
  const enc = encodeURIComponent;
  const site = (p) => '/' + p;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const mb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const same = (a, b) => String(a).normalize('NFC') === String(b).normalize('NFC');

  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString();
  }

  function toast(msg, kind = '') {
    const t = h('div', { class: `toast ${kind}` }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 2600);
  }

  // ------------------------------------------------------------ server
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'X-AE-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.login) { showLogin(); throw new Error('Please log in.'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  }

  // Run a change; on success take the fresh state and redraw.
  async function act(method, url, body, done) {
    try {
      const r = await api(method, url, body);
      if (r.state) S = { ...S, ...r.state };
      if (done) done(r);
      render();
      refreshPublish();
      return r;
    } catch (e) {
      toast(e.message, 'error');
      render();
      return null;
    }
  }

  // Upload files with a progress bar (uses XHR for upload progress).
  function upload(url, files, fields, key, done) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
    const list = [...files];
    const field = url.endsWith('/tracks') || url.endsWith('/gallery') ? 'files' : 'file';
    for (const f of field === 'files' ? list : list.slice(0, 1)) fd.append(field, f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-AE-Admin', '1');
    ui.uploads[key] = 0;
    render();
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      ui.uploads[key] = Math.round((e.loaded / e.total) * 100);
      const bar = document.querySelector(`[data-progress="${CSS.escape(key)}"] i`);
      if (bar) bar.style.width = ui.uploads[key] + '%';
    };
    xhr.onload = () => {
      delete ui.uploads[key];
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        ui.bust = Date.now();
        if (data.state) S = { ...S, ...data.state };
        if (done) done(data);
        refreshPublish();
      } else if (xhr.status === 401) {
        showLogin();
        return;
      } else {
        toast(data.error || `Upload failed (${xhr.status}).`, 'error');
      }
      render();
    };
    xhr.onerror = () => { delete ui.uploads[key]; toast('Upload failed — is the admin still running?', 'error'); render(); };
    xhr.send(fd);
  }

  async function refreshPublish() {
    try { PUB = await api('GET', '/api/publish'); } catch { PUB = null; }
    renderSide();
  }

  // ------------------------------------------------------------ shared pieces
  // A file drop target. `accept` like "image/*"; onFiles(FileList)
  function dropZone({ accept, multiple, onFiles, label, sub, image, key, cls = '' }) {
    const pct = key in ui.uploads ? ui.uploads[key] : null;
    const input = h('input', { type: 'file', accept, multiple, 'aria-label': label, onchange: (e) => e.target.files.length && onFiles(e.target.files) });
    const zone = h('label', { class: `drop ${image ? 'image' : ''} ${cls}` },
      image ? h('img', { src: image, alt: '' }) : null,
      image ? h('span', { class: 'swap' }, pct !== null ? `Uploading… ${pct}%` : label) : [
        h('strong', {}, pct !== null ? `Uploading… ${pct}%` : label),
        sub ? h('span', {}, sub) : null,
        pct !== null ? h('div', { class: 'progress', 'data-progress': key, style: { width: '100%' } }, h('i', { style: { width: pct + '%' } })) : null,
      ],
      input,
    );
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
    return zone;
  }

  function toggle(label, checked, onChange, k) {
    return h('label', { class: 'switch' },
      h('input', { type: 'checkbox', role: 'switch', checked, 'data-k': k, onchange: (e) => onChange(e.target.checked) }),
      h('span', {}, label));
  }

  // Drag-to-reorder for a list of sibling rows. getKeys() returns the current order.
  function sortable(container, itemSel, onOrder) {
    let dragged = null;
    container.querySelectorAll(itemSel).forEach((row) => {
      const grip = row.querySelector('.grip');
      if (grip) {
        grip.addEventListener('mousedown', () => { row.draggable = true; });
        grip.addEventListener('touchstart', () => { row.draggable = true; }, { passive: true });
      }
      row.addEventListener('dragstart', (e) => {
        if (!row.draggable) return;
        dragged = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.key);
      });
      row.addEventListener('dragend', () => {
        row.draggable = false;
        row.classList.remove('dragging');
        container.querySelectorAll('.drop-before').forEach((r) => r.classList.remove('drop-before'));
        dragged = null;
      });
      row.addEventListener('dragover', (e) => {
        if (!dragged || dragged === row) return;
        e.preventDefault();
        container.querySelectorAll('.drop-before').forEach((r) => r.classList.remove('drop-before'));
        row.classList.add('drop-before');
      });
      row.addEventListener('drop', (e) => {
        if (!dragged || dragged === row) return;
        e.preventDefault();
        row.before(dragged);
        onOrder([...container.querySelectorAll(itemSel)].map((r) => r.dataset.key));
      });
    });
  }

  // Keep keyboard focus across redraws (fields have data-k).
  function withFocus(fn) {
    const a = document.activeElement;
    const k = a && a.dataset ? a.dataset.k : null;
    const sel = k && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    const scroll = window.scrollY;
    fn();
    window.scrollTo(0, scroll);
    if (k) {
      const n = document.querySelector(`[data-k="${CSS.escape(k)}"]`);
      if (n) {
        n.focus({ preventScroll: true });
        if (sel && n.setSelectionRange) try { n.setSelectionRange(...sel); } catch { /* not a text field */ }
      }
    }
  }

  // ------------------------------------------------------------ layout
  function render() {
    if (!S) return;
    withFocus(() => {
      $app.replaceChildren(h('nav', { class: 'side', id: 'side' }), h('main', { class: 'main', id: 'main' }, page()));
      renderSide();
    });
  }

  function counts() {
    return {
      artists: S.artists.length,
      popups: S.popups.length,
      gallery: S.gallery.items.length,
      deleted: S.trash.length || null,
    };
  }

  function renderSide() {
    const side = document.getElementById('side');
    if (!side) return;
    const c = counts();
    const hosted = S.env && S.env.mode === 'hosted';
    const n = PUB && PUB.changes ? PUB.changes.length + (PUB.ahead ? 1 : 0) : 0;

    let note = '';
    if (hosted) note = 'Changes go live as soon as you make them.';
    else if (!PUB) note = 'Checking for unpublished changes…';
    else if (!PUB.available) note = PUB.reason;
    else if (n) note = `${plural(PUB.changes.length, 'file')} changed since the last publish.`;
    else note = 'The live site is up to date.';

    side.replaceChildren(
      h('div', { class: 'brand' }, h('b', {}, 'æ'), h('span', {}, 'admin')),
      ...PAGES.map(([id, label]) => h('button', {
        class: 'nav-item', 'aria-current': ui.page === id ? 'page' : null,
        onclick: () => go(id),
      }, h('span', {}, label), c[id] ? h('span', { class: 'n' }, c[id]) : null)),
      h('div', { class: 'side-foot' },
        h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Preview site ↗'),
        liveUrl() ? h('a', { href: liveUrl(), target: '_blank', rel: 'noopener' }, 'Live site ↗') : null,
        h('p', { class: `pub-note ${n ? 'dirty' : ''}` }, note),
        hosted ? null : h('button', {
          class: `btn ${n ? 'primary' : ''}`, disabled: !PUB || !PUB.available || !n, onclick: openPublish,
        }, 'Publish'),
        S.loginRequired ? h('button', { class: 'btn quiet small', onclick: logout }, 'Log out') : null,
      ),
    );
  }

  function liveUrl() {
    const m = PUB && PUB.remote && PUB.remote.match(/github\.com[/:]([^/]+)\/([^/.]+(?:\.github\.io)?)/i);
    if (!m) return null;
    const [, owner, repo] = m;
    return repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`;
  }

  function go(id) {
    ui.page = id;
    history.replaceState(null, '', '#' + id);
    window.scrollTo(0, 0);
    render();
  }

  function page() {
    switch (ui.page) {
      case 'popups': return popupsPage();
      case 'desktop': return desktopPage();
      case 'gallery': return galleryPage();
      case 'deleted': return deletedPage();
      default: return artistsPage();
    }
  }

  function head(title, text, ...actions) {
    return h('header', { class: 'page-head' },
      h('h1', {}, title),
      actions.length ? h('div', { class: 'actions' }, actions) : null,
      text ? h('p', {}, text) : null);
  }

  // ------------------------------------------------------------ artists
  function artistsPage() {
    const list = S.artists;
    if (!ui.artist || !list.some((a) => same(a.name, ui.artist))) ui.artist = list[0] ? list[0].name : null;
    const current = list.find((a) => same(a.name, ui.artist));

    const roster = h('div', { class: 'panel roster', role: 'listbox', 'aria-label': 'Artists' },
      list.map((a) => h('div', {
        class: `roster-item ${a.hidden ? 'is-hidden' : ''}`, role: 'option', tabindex: 0,
        'aria-selected': current && same(a.name, current.name) ? 'true' : 'false', 'data-key': a.name,
        onclick: () => { ui.artist = a.name; render(); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.artist = a.name; render(); } },
      },
      h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮'),
      a.photo ? h('img', { class: 'avatar', src: site(a.photo), alt: '' }) : h('span', { class: 'avatar' }, initials(a.name)),
      h('span', { class: 'who' },
        h('b', {}, a.name),
        h('span', {}, a.hidden ? 'Hidden' : a.albums.length ? plural(a.albums.length, 'release') : 'No releases yet')),
      )),
      list.length ? h('p', { class: 'roster-hint' }, 'Drag to change the order on the merry-go-round.') : h('p', { class: 'roster-hint' }, 'No artists yet.'),
    );
    sortable(roster, '.roster-item', (names) => act('PUT', '/api/artists-order', { names }));

    return h('div', {},
      head('Artists', null, h('button', { class: 'btn primary', onclick: addArtist }, 'Add artist')),
      h('div', { class: 'artists' }, roster, current ? artistDetail(current) : h('div', { class: 'panel empty' }, h('b', {}, 'No artists yet'), 'Add the first one to start the roster.')));
  }

  async function addArtist() {
    const name = prompt('Artist name');
    if (!name || !name.trim()) return;
    await act('POST', '/api/artists', { name }, () => { ui.artist = name.trim().normalize('NFC'); toast(`Added ${name.trim()}.`); });
  }

  function artistDetail(a) {
    const A = `/api/artists/${enc(a.name)}`;
    const k = (s) => `${a.name}:${s}`;
    return h('section', {},
      h('div', { class: 'panel panel-pad' },
        h('div', { class: 'artist-head' },
          h('div', {},
            dropZone({
              key: k('photo'), accept: 'image/jpeg,image/png,image/webp', label: a.photo ? 'Replace photo' : 'Add a photo',
              sub: 'Drop a JPG or PNG', image: a.photo ? site(a.photo) + '?v=' + ui.bust : null,
              onFiles: (f) => upload(`${A}/photo`, f, null, k('photo'), () => toast('Photo updated.')),
            }),
            a.photo ? h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '6px' } },
              h('button', { class: 'btn quiet small', onclick: () => act('DELETE', `${A}/photo`, null, () => toast('Photo removed. You can restore it from Deleted.')) }, 'Remove photo')) : null,
          ),
          h('div', { class: 'artist-fields' },
            h('label', { class: 'field' }, h('span', {}, 'Name'),
              h('input', {
                class: 'input title', value: a.name, 'data-k': k('name'),
                onchange: (e) => {
                  const newName = e.target.value.trim();
                  act('PATCH', A, { newName }, () => { ui.artist = newName.normalize('NFC'); toast('Name saved.'); });
                },
              })),
            h('label', { class: 'field' }, h('span', {}, 'Bio'),
              h('textarea', {
                class: 'textarea', 'data-k': k('bio'), placeholder: 'A few lines about the artist. Shown in their folder on the desktop.',
                onchange: (e) => act('PATCH', A, { bio: e.target.value }, () => toast('Bio saved.')),
              }, a.bio)),
            h('div', { class: 'split' },
              toggle('Show on the site', !a.hidden, (on) => act('PATCH', A, { hidden: !on }, () => toast(on ? `${a.name} is visible.` : `${a.name} is hidden from the site.`)), k('hidden')),
              h('button', { class: 'btn danger small', onclick: () => {
                if (confirm(`Remove ${a.name} and all their releases?\n\nYou can restore them from Deleted.`)) act('DELETE', A, null, () => toast(`${a.name} removed.`));
              } }, 'Remove artist'),
            ),
          ),
        ),
      ),
      h('div', { class: 'section-title' },
        h('h2', {}, 'Releases'),
        h('button', { class: 'btn small', onclick: () => addAlbum(a) }, 'Add release')),
      a.albums.length
        ? a.albums.map((al, i) => albumCard(a, al, i))
        : h('div', { class: 'panel empty' }, h('b', {}, 'No releases yet'), 'Add a release, then drop its cover and audio files in.'),
    );
  }

  async function addAlbum(a) {
    const title = prompt(`New release by ${a.name} — title`);
    if (!title || !title.trim()) return;
    await act('POST', `/api/artists/${enc(a.name)}/albums`, { title }, (r) => { ui.open.add(`${a.name}/${r.folder}`); });
  }

  function albumCard(a, al, index) {
    const key = `${a.name}/${al.folder}`;
    const open = ui.open.has(key);
    const B = `/api/artists/${enc(a.name)}/albums/${enc(al.folder)}`;
    const k = (s) => `${key}:${s}`;
    const total = al.tracks.reduce((n, t) => n + t.playedSize, 0);
    const needsMp3 = al.tracks.filter((t) => !t.formats.includes('mp3') && t.formats.some((f) => ['wav', 'flac', 'aif', 'aiff'].includes(f))).length;

    const moveAlbum = (dir) => {
      const folders = a.albums.map((x) => x.folder);
      const j = index + dir;
      if (j < 0 || j >= folders.length) return;
      [folders[index], folders[j]] = [folders[j], folders[index]];
      act('PUT', `/api/artists/${enc(a.name)}/albums-order`, { folders });
    };

    const status = [
      al.year,
      plural(al.tracks.length, 'track'),
      total ? mb(total) : null,
      al.hidden ? 'hidden' : null,
      !al.tracks.length ? 'not on the site until it has audio' : null,
    ].filter(Boolean).join(', ');

    const bar = h('div', {
      class: 'album-bar', role: 'button', tabindex: 0, 'aria-expanded': open ? 'true' : 'false', 'data-k': k('bar'),
      onclick: (e) => { if (e.target.closest('button')) return; open ? ui.open.delete(key) : ui.open.add(key); render(); },
      onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open ? ui.open.delete(key) : ui.open.add(key); render(); } },
    },
    al.cover ? h('img', { src: site(al.cover), alt: '' }) : h('span', { class: 'nocover' }),
    h('span', { class: 't' }, h('b', {}, al.title), h('span', {}, status)),
    a.albums.length > 1 ? [
      h('button', { class: 'btn quiet icon', 'aria-label': 'Move up', disabled: index === 0, onclick: () => moveAlbum(-1) }, '↑'),
      h('button', { class: 'btn quiet icon', 'aria-label': 'Move down', disabled: index === a.albums.length - 1, onclick: () => moveAlbum(1) }, '↓'),
    ] : null,
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));

    if (!open) return h('div', { class: 'panel album' }, bar);

    // track list
    const saveOrder = (files) => {
      const titles = Object.fromEntries(al.tracks.map((t) => [t.file, t.title]));
      act('PUT', `${B}/tracks`, { tracks: files.map((file) => ({ file, title: titles[file] })) });
    };
    const rows = h('div', {},
      al.tracks.map((t, i) => h('div', { class: 'track', 'data-key': t.file },
        h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮'),
        h('span', { class: 'no' }, i + 1),
        h('input', {
          class: 'input bare', value: t.title, 'aria-label': `Title of track ${i + 1}`, 'data-k': k('t:' + t.file),
          onchange: (e) => act('PUT', `${B}/tracks`, {
            tracks: al.tracks.map((x) => ({ file: x.file, title: x.file === t.file ? e.target.value : x.title })),
          }, () => toast('Track title saved.')),
        }),
        h('span', { class: 'file mono', title: t.file }, t.file),
        h('span', { class: 'fmt' },
          h('button', { class: 'track-play', 'aria-label': `Play ${t.title}`, onclick: () => preview(t.url) },
            h('span', { html: '<svg viewBox="0 0 10 10"><path d="M2 1v8l7-4z"/></svg>' })),
          t.formats.map((f) => h('span', { class: `tag ${f !== 'mp3' && !t.formats.includes('mp3') && t.size > 40e6 ? 'warn' : ''}` }, f.toUpperCase()))),
        h('button', {
          class: 'btn quiet icon', 'aria-label': `Delete ${t.title}`, title: 'Delete track',
          onclick: () => { if (confirm(`Delete “${t.title}”?`)) act('DELETE', `${B}/tracks/${enc(t.file)}`, null, () => toast('Track deleted. You can restore it from Deleted.')); },
        }, '✕'),
      )));
    sortable(rows, '.track', saveOrder);

    return h('div', { class: 'panel album open' }, bar,
      h('div', { class: 'album-body' },
        dropZone({
          key: k('cover'), accept: 'image/jpeg,image/png,image/webp', label: al.cover ? 'Replace cover' : 'Add cover', sub: 'Square JPG or PNG',
          image: al.cover ? site(al.cover) + '?v=' + ui.bust : null,
          onFiles: (f) => upload(`${B}/cover`, f, null, k('cover'), () => toast('Cover updated.')),
        }),
        h('div', { class: 'album-meta' },
          h('label', { class: 'field' }, h('span', {}, 'Title'),
            h('input', { class: 'input', value: al.title, 'data-k': k('title'), onchange: (e) => {
              const title = e.target.value.trim();
              act('PATCH', B, { title }, () => {
                // the folder is renamed with the title — keep the renamed album open
                const artist = S.artists.find((x) => same(x.name, a.name));
                const now = artist && artist.albums.find((x) => same(x.title, title));
                ui.open.delete(key);
                if (now) ui.open.add(`${a.name}/${now.folder}`);
                toast('Title saved.');
              });
            } })),
          h('label', { class: 'field' }, h('span', {}, 'Year'),
            h('input', { class: 'input', value: al.year || '', inputmode: 'numeric', placeholder: 'e.g. 2026', 'data-k': k('year'),
              onchange: (e) => act('PATCH', B, { year: e.target.value }, () => toast('Year saved.')) })),
          h('div', { class: 'full split' },
            toggle('Show on the site', !al.hidden, (on) => act('PATCH', B, { hidden: !on }), k('hidden')),
            h('button', { class: 'btn danger small', onclick: () => {
              if (confirm(`Delete “${al.title}” and its audio?\n\nYou can restore it from Deleted.`)) act('DELETE', B, null, () => toast('Release deleted.'));
            } }, 'Delete release')),
          needsMp3 ? h('div', { class: 'full panel', style: { padding: '10px 12px', background: 'var(--sunken)' } },
            h('div', { class: 'split' },
              h('span', { class: 'muted' }, `${plural(needsMp3, 'track')} only as WAV — slow to load and heavy to publish. MP3 copies play the same on the site at a fraction of the size.`),
              S.env.ffmpeg
                ? h('button', { class: 'btn small', 'data-k': k('mp3'), onclick: (e) => {
                  e.target.disabled = true; e.target.textContent = 'Making MP3s…';
                  act('POST', `${B}/mp3`, null, (r) => toast(`Made ${plural(r.converted, 'MP3')}.`));
                } }, 'Make MP3s')
                : h('span', { class: 'muted' }, 'Install ffmpeg to convert here (brew install ffmpeg).'))) : null,
        ),
        h('div', { class: 'tracks' },
          al.tracks.length ? rows : null,
          dropZone({
            key: k('tracks'), accept: 'audio/*,.mp3,.wav,.m4a,.flac,.ogg', multiple: true,
            label: al.tracks.length ? 'Add more tracks' : 'Add tracks', sub: 'Drop MP3 or WAV files — they go to the end of the list',
            onFiles: (f) => upload(`${B}/tracks`, f, null, k('tracks'), (r) => toast(`Added ${plural((r.added || []).length, 'track')}.`)),
          })),
      ));
  }

  let player = null;
  function preview(url) {
    const src = site(url);
    if (player && player.dataset.src === src && !player.paused) { player.pause(); return; }
    if (player) player.pause();
    player = new Audio(src);
    player.dataset.src = src;
    player.play().catch(() => toast("Can't play that file in the browser.", 'error'));
  }

  // ------------------------------------------------------------ pop-ups
  function popupsPage() {
    const P = S.settings.popups;
    const list = S.popups;
    const save = (next, msg) => act('PUT', '/api/popups', { popups: next }, () => msg && toast(msg));
    const setP = (patch, msg) => act('PUT', '/api/settings', { settings: { popups: patch } }, () => msg && toast(msg));
    const edit = (i, patch, msg) => save(list.map((p, j) => (j === i ? { ...p, ...patch } : p)), msg);
    const move = (i, d) => {
      const next = list.slice();
      [next[i], next[i + d]] = [next[i + d], next[i]];
      save(next);
    };

    const cards = list.map((p, i) => h('div', { class: `panel popup ${p.hidden ? 'is-off' : ''}` },
      h('button', { class: 'ico', 'aria-label': 'Change icon', title: 'Change icon', onclick: () => pickIcon(p.icon, (icon) => edit(i, { icon }, 'Icon saved.')) },
        p.icon ? h('img', { src: site(p.icon), alt: '' }) : 'Icon'),
      h('div', { class: 'fields' },
        h('input', { class: 'input', value: p.title, placeholder: 'Title', 'aria-label': 'Title', 'data-k': `pop${i}t`, onchange: (e) => edit(i, { title: e.target.value }, 'Saved.') }),
        h('textarea', { class: 'textarea', style: { minHeight: '56px' }, placeholder: 'Message', 'aria-label': 'Message', 'data-k': `pop${i}b`, onchange: (e) => edit(i, { body: e.target.value }, 'Saved.') }, p.body),
        toggle('Show this one', !p.hidden, (on) => edit(i, { hidden: !on }), `pop${i}h`)),
      h('div', { class: 'tools' },
        h('button', { class: 'btn quiet icon', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'btn quiet icon', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', { class: 'btn quiet icon', 'aria-label': 'Delete pop-up', onclick: () => { if (confirm(`Delete “${p.title || 'this pop-up'}”?`)) save(list.filter((_, j) => j !== i), 'Pop-up deleted.'); } }, '✕')),
    ));

    const W = P.welcome;
    return h('div', {},
      head('Pop-ups', 'The notifications that slide in on the desktop. Each one shows once per visit.',
        h('button', { class: 'btn primary', onclick: () => save([...list, { title: 'New pop-up', body: '' }], 'Pop-up added.') }, 'Add pop-up')),
      h('div', { class: 'two' },
        h('div', {}, cards.length ? cards : h('div', { class: 'panel empty' }, h('b', {}, 'No pop-ups'), 'Add one to greet visitors with news.')),
        h('div', { style: { display: 'grid', gap: '16px' } },
          h('div', { class: 'panel panel-pad timing' },
            toggle('Show pop-ups on the site', P.enabled, (on) => setP({ enabled: on }, on ? 'Pop-ups on.' : 'Pop-ups off.'), 'p-on'),
            h('div', { class: 'field' }, h('span', {}, 'Time between pop-ups')),
            h('div', { class: 'pair', style: { marginTop: '-8px' } },
              h('label', { class: 'field' }, h('span', { class: 'sr' }, 'From'),
                h('input', { class: 'input', type: 'number', min: 1, value: P.minDelay, 'data-k': 'p-min', onchange: (e) => setP({ minDelay: Number(e.target.value) }, 'Timing saved.') }),
                h('small', {}, 'seconds, at least')),
              h('label', { class: 'field' }, h('span', { class: 'sr' }, 'To'),
                h('input', { class: 'input', type: 'number', min: 1, value: P.maxDelay, 'data-k': 'p-max', onchange: (e) => setP({ maxDelay: Number(e.target.value) }, 'Timing saved.') }),
                h('small', {}, 'seconds, at most'))),
            toggle('Random order', P.shuffle, (on) => setP({ shuffle: on }), 'p-shuf')),
          h('div', { class: 'panel panel-pad timing' },
            toggle('Welcome message', W.enabled, (on) => setP({ welcome: { enabled: on } }), 'w-on'),
            h('label', { class: 'field' }, h('span', {}, 'Title'),
              h('input', { class: 'input', value: W.title, 'data-k': 'w-t', onchange: (e) => setP({ welcome: { title: e.target.value } }, 'Saved.') })),
            h('label', { class: 'field' }, h('span', {}, 'Message'),
              h('textarea', { class: 'textarea', 'data-k': 'w-b', onchange: (e) => setP({ welcome: { body: e.target.value } }, 'Saved.') }, W.body)),
            h('div', { class: 'ae-card mascot', style: { width: 'auto', opacity: W.enabled ? 1 : 0.5 } },
              h('img', { src: site('assets/images/Clippy.png'), alt: '' }),
              h('div', {}, h('b', {}, W.title), h('p', {}, W.body)))),
        )));
  }

  // Icon chooser dialog: existing icons, upload a new one, or none.
  function pickIcon(current, onPick) {
    const choices = [{ path: 'assets/images/Clippy.png' }, ...S.icons.filter((i) => i.path !== 'assets/images/Clippy.png')];
    const dlg = h('dialog', {});
    const close = () => { dlg.close(); dlg.remove(); };
    const choose = (p) => { close(); onPick(p); };
    dlg.append(h('div', { class: 'dlg' },
      h('h2', {}, 'Pop-up icon'),
      h('div', { class: 'bg-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' } },
        choices.map((c) => h('button', { class: 'bg-tile', style: { aspectRatio: '1' }, 'aria-pressed': c.path === current ? 'true' : 'false', onclick: () => choose(c.path) },
          h('img', { src: site(c.path), alt: c.path.split('/').pop(), style: { objectFit: 'contain' } }))),
        dropZone({ key: 'icon-up', accept: 'image/*', label: 'Upload', onFiles: (f) => { close(); upload('/api/uploads/icons', f, null, 'icon-up', (r) => onPick(r.path)); } })),
      h('div', { class: 'row end' },
        h('button', { class: 'btn quiet', onclick: () => choose('') }, 'No icon'),
        h('button', { class: 'btn', onclick: close }, 'Cancel'))));
    document.body.append(dlg);
    dlg.showModal();
  }

  // ------------------------------------------------------------ desktop
  function desktopPage() {
    const set = S.settings;
    const bg = set.background;
    const save = (patch, msg) => act('PUT', '/api/settings', { settings: patch }, () => msg && toast(msg));
    const sample = S.popups.find((p) => !p.hidden) || { title: 'New Release', body: 'Your pop-ups appear up here.' };

    const preview = h('div', { class: 'desk-preview', id: 'desk-preview' },
      h('div', { class: 'bar' }, h('span', {}, '🔋 100%'), h('span', {}, '🔊 50%'), h('span', {}, new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'folders' }, ['Artists', 'Resources', 'Archive'].map((n) => h('span', {}, h('img', { src: site('assets/icons/folder-icon.png'), alt: '' }), n))),
      set.popups.enabled ? h('div', { class: 'ae-card' }, sample.icon ? h('img', { src: site(sample.icon), alt: '' }) : h('span'), h('div', {}, h('b', {}, sample.title), h('p', {}, sample.body))) : null,
      h('div', { class: 'dock' }, ['terminal-icon.png', 'dock-audio.png', 'gallery-image.jpg', 'trash-icon.png'].map((f) => h('img', { src: site('assets/icons/' + f), alt: '' }))));
    paintPreview(preview, bg);

    return h('div', {},
      head('Desktop', 'The background behind everything, and the name in the browser tab.'),
      h('div', { class: 'desk' },
        preview,
        h('div', { style: { display: 'grid', gap: '22px' } },
          h('div', { class: 'field' }, h('span', {}, 'Background'),
            h('div', { class: 'bg-grid' },
              S.backgrounds.map((b) => h('div', { class: 'bg-tile', role: 'button', tabindex: 0, 'aria-pressed': b.path === bg.image ? 'true' : 'false', 'aria-label': b.path.split('/').pop(),
                onclick: (e) => { if (!e.target.closest('.x')) save({ background: { image: b.path } }, 'Background changed.'); },
                onkeydown: (e) => { if (e.key === 'Enter') save({ background: { image: b.path } }, 'Background changed.'); } },
              h('img', { src: site(b.url), alt: '' }),
              b.builtIn ? null : h('button', { class: 'x', 'aria-label': 'Delete this background', onclick: () => act('DELETE', `/api/uploads?path=${enc(b.path)}`, null, () => toast('Background deleted.')) }, '✕'))),
              h('button', { class: 'bg-tile', 'aria-pressed': !bg.image ? 'true' : 'false', style: { background: bg.color }, onclick: () => save({ background: { image: '' } }, 'Using a plain colour.') },
                h('span', { style: { color: '#fff', fontSize: '12px', mixBlendMode: 'difference' } }, 'Plain colour')),
              dropZone({ key: 'bg-up', accept: 'image/*', label: 'Upload',
                onFiles: (f) => upload('/api/uploads/backgrounds', f, null, 'bg-up', (r) => save({ background: { image: r.path } }, 'Background changed.')) }))),
          h('div', { class: 'field' }, h('span', {}, 'Fit'),
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Fit' },
              [['cover', 'Fill screen'], ['contain', 'Show whole image'], ['tile', 'Tile']].map(([v, l]) =>
                h('button', { 'aria-pressed': bg.fit === v ? 'true' : 'false', onclick: () => save({ background: { fit: v } }) }, l)))),
          h('label', { class: 'field' }, h('span', {}, 'Colour behind the image'),
            h('div', { class: 'row' },
              h('input', { type: 'color', class: 'color', value: bg.color || '#000000',
                oninput: (e) => paintPreview(document.getElementById('desk-preview'), { ...bg, color: e.target.value }),
                onchange: (e) => save({ background: { color: e.target.value } }) }),
              h('span', { class: 'muted' }, 'Shows around a fitted image, or on its own.'))),
          h('label', { class: 'field' }, h('span', {}, 'Browser tab title'),
            h('input', { class: 'input', value: set.siteTitle, 'data-k': 'title', onchange: (e) => save({ siteTitle: e.target.value }, 'Title saved.') })),
        )));
  }

  function paintPreview(el, bg) {
    if (!el) return;
    el.style.backgroundColor = bg.color || '#000';
    el.style.backgroundImage = bg.image ? `url("${site(encodeURI(bg.image))}")` : 'none';
    el.style.backgroundSize = bg.fit === 'tile' ? 'auto' : bg.fit;
    el.style.backgroundRepeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat';
  }

  // ------------------------------------------------------------ gallery
  function galleryPage() {
    const { items, folders } = S.gallery;
    if (ui.folder !== '*' && !folders.includes(ui.folder)) ui.folder = '*';
    const shown = ui.folder === '*' ? items : items.filter((i) => i.folder === ui.folder);
    const uploadTo = ui.folder === '*' ? '' : ui.folder;
    const count = (f) => items.filter((i) => i.folder === f).length;

    return h('div', {},
      head('Gallery', 'Pictures and videos in the Gallery app. They live in the Archive folder.',
        h('button', { class: 'btn', onclick: async () => {
          const name = prompt('New folder name');
          if (name && name.trim()) act('POST', '/api/gallery/folders', { name }, () => { ui.folder = name.trim(); toast('Folder created.'); });
        } }, 'New folder')),
      h('div', { class: 'folders-bar' },
        h('button', { class: 'chip', 'aria-pressed': ui.folder === '*' ? 'true' : 'false', onclick: () => { ui.folder = '*'; render(); } }, 'Everything', h('span', { class: 'n' }, items.length)),
        folders.map((f) => h('button', { class: 'chip', 'aria-pressed': ui.folder === f ? 'true' : 'false', onclick: () => { ui.folder = f; render(); } },
          f || 'Archive', h('span', { class: 'n' }, count(f)))),
        ui.folder !== '*' && ui.folder !== '' ? h('button', { class: 'btn quiet small', onclick: () => {
          if (confirm(`Delete the folder “${ui.folder}” and everything in it?`)) act('DELETE', `/api/gallery?path=${enc('Archive/' + ui.folder)}`, null, () => toast('Folder deleted.'));
        } }, 'Delete folder') : null),
      h('div', { class: 'media-grid' },
        dropZone({ key: 'gal', accept: 'image/*,video/mp4,video/webm,video/quicktime', multiple: true,
          label: 'Add pictures', sub: uploadTo ? `to ${uploadTo}` : 'JPG, PNG, GIF, MP4…',
          onFiles: (f) => upload('/api/gallery', f, { folder: uploadTo }, 'gal', () => toast(`Added ${plural(f.length, 'file')}.`)) }),
        shown.map((m) => h('figure', { class: 'media', style: { margin: 0 } },
          h('div', { class: 'thumb' }, m.type === 'image'
            ? h('img', { src: site(m.url), alt: m.name, loading: 'lazy' })
            : h('video', { src: site(m.url), muted: true, preload: 'metadata' })),
          h('figcaption', { class: 'cap' }, h('span', { title: m.name }, m.name), h('span', { class: 'muted' }, mb(m.size))),
          h('button', { class: 'btn small del', onclick: () => act('DELETE', `/api/gallery?path=${enc(m.path)}`, null, () => toast('Removed from the gallery.')) }, 'Delete')))),
      h('div', { style: { marginTop: '22px' } },
        toggle('Also show album covers and artist photos in the gallery', S.settings.gallery.includeCatalog,
          (on) => act('PUT', '/api/settings', { settings: { gallery: { includeCatalog: on } } }), 'g-cat')));
  }

  // ------------------------------------------------------------ deleted
  function deletedPage() {
    const list = S.trash;
    return h('div', {},
      head('Deleted', 'Everything you delete waits here so you can bring it back. Nothing here is published.',
        list.length ? h('button', { class: 'btn danger', onclick: () => {
          if (confirm(`Permanently delete ${plural(list.length, 'item')}? This can't be undone.`)) act('DELETE', '/api/trash', null, () => toast('Deleted for good.'));
        } }, 'Empty') : null),
      list.length
        ? h('div', { class: 'panel' }, list.map((t) => h('div', { class: 'trash-row' },
          h('div', { class: 'what' }, h('b', {}, t.label), h('span', {}, ago(t.deletedAt))),
          h('button', { class: 'btn small', onclick: () => act('POST', `/api/trash/${enc(t.id)}/restore`, null, () => toast('Restored.')) }, 'Restore'),
          h('button', { class: 'btn quiet small', onclick: () => { if (confirm('Delete permanently?')) act('DELETE', `/api/trash/${enc(t.id)}`); } }, 'Delete forever'))))
        : h('div', { class: 'panel empty' }, h('b', {}, 'Nothing deleted'), 'Deleted artists, releases, tracks and pictures show up here.'));
  }

  // ------------------------------------------------------------ publish
  async function openPublish() {
    await refreshPublish();
    if (!PUB || !PUB.available) return;
    const dlg = h('dialog', {});
    const close = () => { dlg.close(); dlg.remove(); };
    const msg = h('input', { class: 'input', placeholder: 'What changed? (optional)', 'aria-label': 'Note for this update' });
    const go = h('button', { class: 'btn primary' }, 'Publish');
    const body = h('div', { class: 'dlg' },
      h('h2', {}, 'Publish to the live site'),
      h('p', {}, PUB.branch !== PUB.liveBranch
        ? `You're on the “${PUB.branch}” branch. The live site is built from “${PUB.liveBranch}”, so this won't show up there until it's merged.`
        : 'Sends these changes to GitHub. The live site updates a minute or two later.'),
      PUB.changes.length ? h('ul', { class: 'changes' }, PUB.changes.slice(0, 300).map((c) => h('li', {}, h('em', {}, c.change), h('span', { class: 'mono' }, c.file))),
        PUB.changes.length > 300 ? h('li', {}, `…and ${PUB.changes.length - 300} more`) : null) : h('p', {}, 'Saved changes are waiting to be sent.'),
      msg,
      h('div', { class: 'row end' }, h('button', { class: 'btn quiet', onclick: close }, 'Cancel'), go));
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Publishing…';
      msg.disabled = true;
      body.querySelector('p').textContent = 'Uploading to GitHub. Big audio files can take a few minutes — keep this window open.';
      try {
        const r = await api('POST', '/api/publish', { message: msg.value });
        close();
        toast(r.nothing ? 'Nothing new to publish.' : 'Published. The live site updates in a minute or two.');
      } catch (e) {
        body.replaceChildren(h('h2', {}, "Couldn't publish"), h('pre', { class: 'log' }, e.message), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Close')));
      }
      refreshPublish();
    });
    dlg.append(body);
    document.body.append(dlg);
    dlg.showModal();
  }

  // ------------------------------------------------------------ login (hosted mode)
  function showLogin() {
    S = null;
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'current-password' });
    const err = h('p', { class: 'muted', style: { margin: 0 } });
    $app.replaceChildren(h('div', { class: 'login' }, h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/login', { password: pw.value }); boot(); } catch (x) { err.textContent = x.message; }
      },
    }, h('b', {}, 'æ'), pw, err, h('button', { class: 'btn primary', type: 'submit' }, 'Log in'))));
    pw.focus();
  }

  async function logout() {
    await api('POST', '/api/logout').catch(() => {});
    showLogin();
  }

  // ------------------------------------------------------------ start
  async function boot() {
    try {
      const me = await (await fetch('/api/me')).json();
      if (!me.authed) return showLogin();
      S = await api('GET', '/api/state');
      S.loginRequired = me.loginRequired;
      render();
      refreshPublish();
    } catch (e) {
      $app.replaceChildren(h('div', { class: 'empty' }, h('b', {}, "Can't reach the admin server"), 'Start it again (double-click start.command), then reload this page.'));
    }
  }

  window.addEventListener('hashchange', () => { ui.page = location.hash.slice(1) || 'artists'; render(); });
  // pick up edits made in another tab or on disk
  window.addEventListener('focus', async () => {
    if (!S || document.querySelector('dialog[open]') || Object.keys(ui.uploads).length) return;
    try { const fresh = await api('GET', '/api/state'); S = { ...fresh, loginRequired: S.loginRequired }; render(); refreshPublish(); } catch { /* ignore */ }
  });
  boot();
})();
