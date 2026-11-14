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
    ['startup', 'Startup'],
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
    const field = /\/(tracks|gallery|files)(\?|$)/.test(url) ? 'files' : 'file';
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
      startup: prep.running && prep.total ? `${prep.index}/${prep.total}` : null,
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
      case 'startup': return startupPage();
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
      artistDocs(a),
      h('div', { class: 'section-title' },
        h('h2', {}, 'Releases'),
        h('button', { class: 'btn small', onclick: () => addAlbum(a) }, 'Add release')),
      a.albums.length
        ? a.albums.map((al, i) => albumCard(a, al, i))
        : h('div', { class: 'panel empty' }, h('b', {}, 'No releases yet'), 'Add a release, then drop its cover and audio files in.'),
    );
  }

  // Documents in the artist's folder (bio PDFs, press kits…). Shown as files in their desktop folder.
  function artistDocs(a) {
    const docs = (a.files || []).filter((f) => f.kind === 'doc');
    const pics = (a.files || []).filter((f) => f.kind !== 'doc').length;
    const key = `${a.name}:docs`;
    return h('div', {},
      h('div', { class: 'section-title' },
        h('h2', {}, 'Documents'),
        h('span', { class: 'muted' }, 'Bio PDFs, press kits, riders — they appear as files in the artist’s folder on the site.')),
      h('div', { class: 'panel docs' },
        docs.map((d) => h('div', { class: 'doc-row' },
          h('span', { class: 'doc-ext' }, d.ext.toUpperCase()),
          h('a', { href: site(d.url), target: '_blank', rel: 'noopener', class: 'doc-name', title: 'Open' }, d.name),
          h('span', { class: 'muted' }, mb(d.size)),
          h('button', { class: 'btn quiet icon', 'aria-label': `Delete ${d.name}`, title: 'Delete', onclick: () => {
            if (confirm(`Delete “${d.name}”?`)) act('DELETE', `/api/artists/${enc(a.name)}/files/${enc(d.name)}`, null, () => toast('Document deleted. You can restore it from Deleted.'));
          } }, '✕'))),
        dropZone({ key, accept: '.pdf,.txt,.md,.rtf,.doc,.docx,.odt,.pages', multiple: true, cls: 'docs-drop',
          label: docs.length ? 'Add another document' : 'Add a document', sub: 'PDF, Word, TXT…',
          onFiles: (f) => upload(`/api/artists/${enc(a.name)}/files?kind=doc`, f, null, key, (r) => toast(`Added ${plural((r.added || []).length, 'document')}.`)) }),
        pics ? h('p', { class: 'muted docs-note' }, `${plural(pics, 'picture')} added in `, h('a', { href: '#gallery', onclick: (e) => { e.preventDefault(); ui.folder = `artist:${a.name}`; go('gallery'); } }, 'Gallery'), '.') : null));
  }

  const TYPES = [['album', 'Album'], ['ep', 'EP'], ['single', 'Single']];
  const typeName = (t) => (TYPES.find(([v]) => v === t) || TYPES[0])[1];

  // New release: title + type in one small dialog.
  function addAlbum(a) {
    let type = 'album';
    const dlg = h('dialog', {});
    const close = () => { dlg.close(); dlg.remove(); };
    const title = h('input', { class: 'input', placeholder: 'Title', 'aria-label': 'Title', required: true });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Type' },
      TYPES.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': v === type ? 'true' : 'false', onclick: (e) => {
        type = v;
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'));
      } }, l)));
    dlg.append(h('form', { class: 'dlg', onsubmit: async (e) => {
      e.preventDefault();
      if (!title.value.trim()) return;
      close();
      await act('POST', `/api/artists/${enc(a.name)}/albums`, { title: title.value, type }, (r) => { ui.open.add(`${a.name}/${r.folder}`); toast(`${typeName(type)} added.`); });
    } },
    h('h2', {}, `New release by ${a.name}`),
    h('label', { class: 'field' }, h('span', {}, 'Title'), title),
    h('div', { class: 'field' }, h('span', {}, 'Type'), seg),
    h('div', { class: 'row end' }, h('button', { class: 'btn quiet', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add release'))));
    document.body.append(dlg);
    dlg.showModal();
    title.focus();
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
      typeName(al.type),
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
          h('div', { class: 'field full' }, h('span', {}, 'Type'),
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Type' },
              TYPES.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': (al.type || 'album') === v ? 'true' : 'false',
                onclick: () => act('PATCH', B, { type: v }, () => toast(`Now shown as ${l === 'EP' ? 'an EP' : `a${l === 'Album' ? 'n' : ''} ${l.toLowerCase()}`}.`)) }, l)))),
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
  // Folders: '*' = everything, an Archive folder path ('' = Archive itself), or 'artist:<name>'.
  function galleryPage() {
    const { items, folders } = S.gallery;
    const artists = S.gallery.artists || [];
    const isArtist = ui.folder.startsWith('artist:');
    const artist = isArtist ? artists.find((x) => same(x.name, ui.folder.slice(7))) : null;
    if ((isArtist && !artist) || (!isArtist && ui.folder !== '*' && !folders.includes(ui.folder))) ui.folder = '*';
    const count = (f) => items.filter((i) => i.folder === f).length;
    const chip = (key, label, n) => h('button', { class: 'chip', 'aria-pressed': ui.folder === key ? 'true' : 'false', onclick: () => { ui.folder = key; render(); } },
      label, h('span', { class: 'n' }, n));

    const archiveTile = (m) => h('figure', { class: 'media', style: { margin: 0 } },
      thumb(m),
      h('figcaption', { class: 'cap' }, h('span', { title: m.name }, m.name), h('span', { class: 'muted' }, mb(m.size))),
      h('button', { class: 'btn small del', onclick: () => act('DELETE', `/api/gallery?path=${enc(m.path)}`, null, () => toast('Removed from the gallery.')) }, 'Delete'));

    const artistTile = (a, m) => h('figure', { class: 'media', style: { margin: 0 } },
      thumb(m),
      h('figcaption', { class: 'cap' },
        h('span', { title: m.role === 'cover' ? `Cover of ${m.release}` : m.name }, m.role === 'cover' ? m.release : m.role === 'photo' ? 'Artist photo' : m.name),
        h('span', { class: 'muted' }, m.role === 'cover' ? 'cover' : m.role === 'photo' ? 'photo' : mb(m.size))),
      m.role === 'extra'
        ? h('button', { class: 'btn small del', onclick: () => act('DELETE', `/api/artists/${enc(a.name)}/files/${enc(m.name)}`, null, () => toast('Removed. You can restore it from Deleted.')) }, 'Delete')
        : h('button', { class: 'btn small del', title: 'Change covers and the photo on the Artists page', onclick: () => { ui.artist = a.name; if (m.role === 'cover') ui.open.add(`${a.name}/${m.path.split('/').slice(-2, -1)[0]}`); go('artists'); } }, 'Change'));

    let grid;
    let text;
    if (artist) {
      text = `${artist.name}'s folder. Covers and the photo come from the Artists page; pictures you add here also show in their folder on the desktop.`;
      grid = [
        dropZone({ key: 'gal-a', accept: 'image/*,video/mp4,video/webm,video/quicktime', multiple: true, label: 'Add pictures', sub: `to ${artist.name}`,
          onFiles: (f) => upload(`/api/artists/${enc(artist.name)}/files?kind=image`, f, null, 'gal-a', () => toast(`Added ${plural(f.length, 'picture')} to ${artist.name}.`)) }),
        artist.items.map((m) => artistTile(artist, m)),
      ];
    } else {
      const uploadTo = ui.folder === '*' ? '' : ui.folder;
      const shown = ui.folder === '*' ? items : items.filter((i) => i.folder === ui.folder);
      text = 'Pictures and videos in the Gallery app. Archive folders are for anything not tied to one artist.';
      grid = [
        dropZone({ key: 'gal', accept: 'image/*,video/mp4,video/webm,video/quicktime', multiple: true,
          label: 'Add pictures', sub: uploadTo ? `to ${uploadTo}` : 'to Archive',
          onFiles: (f) => upload('/api/gallery', f, { folder: uploadTo }, 'gal', () => toast(`Added ${plural(f.length, 'file')}.`)) }),
        shown.map(archiveTile),
      ];
    }

    return h('div', {},
      head('Gallery', text,
        h('button', { class: 'btn', onclick: async () => {
          const name = prompt('New Archive folder name');
          if (name && name.trim()) act('POST', '/api/gallery/folders', { name }, () => { ui.folder = name.trim(); toast('Folder created.'); });
        } }, 'New folder')),
      h('div', { class: 'folders-bar' },
        h('span', { class: 'bar-label' }, 'Archive'),
        chip('*', 'All', items.length),
        folders.filter((f) => f).map((f) => chip(f, f, count(f))),
        ui.folder !== '*' && ui.folder !== '' && !isArtist ? h('button', { class: 'btn quiet small', onclick: () => {
          if (confirm(`Delete the folder “${ui.folder}” and everything in it?`)) act('DELETE', `/api/gallery?path=${enc('Archive/' + ui.folder)}`, null, () => toast('Folder deleted.'));
        } }, 'Delete folder') : null),
      artists.length ? h('div', { class: 'folders-bar' },
        h('span', { class: 'bar-label' }, 'Artists'),
        artists.map((a) => chip(`artist:${a.name}`, a.name, a.items.length))) : null,
      h('div', { class: 'media-grid' }, grid),
      h('div', { style: { marginTop: '22px' } },
        toggle('Show artist folders (covers, photos and their pictures) in the Gallery app', S.settings.gallery.includeCatalog,
          (on) => act('PUT', '/api/settings', { settings: { gallery: { includeCatalog: on } } }), 'g-cat')));
  }

  function thumb(m) {
    return h('div', { class: 'thumb' }, m.type === 'image'
      ? h('img', { src: site(m.url), alt: m.name, loading: 'lazy' })
      : h('video', { src: site(m.url), muted: true, preload: 'metadata' }));
  }


  // ------------------------------------------------------------ startup screen (sound)
  // Songs are prepared in this page, one at a time, whenever the admin is open:
  // new or changed songs get their key found and 3 excerpts cut for the sound cloud.
  const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const prep = { running: false, current: null, failed: {}, index: 0, total: 0 };

  const needsPrep = (s) => s.status !== 'ready' && !prep.failed[s.id];

  async function runPrepQueue() {
    if (prep.running || !S || !S.ambient) return;
    if (!S.ambient.songs.some(needsPrep)) return;
    prep.running = true;
    try {
      const { prepareSong } = await import('./ambient-prep.js');
      prep.total = S.ambient.songs.filter(needsPrep).length;
      prep.index = 0;
      for (;;) {
        const song = S.ambient.songs.find(needsPrep);
        if (!song) break;
        prep.current = song;
        prep.index++;
        refreshStartup();
        try {
          const r = await prepareSong(site(song.url), S.ambient.format);
          const fd = new FormData();
          fd.append('meta', JSON.stringify({ track: song.track, key: r.key, duration: r.duration, starts: r.starts }));
          r.files.forEach((b, i) => fd.append('files', b, `excerpt-${i + 1}.wav`));
          const res = await fetch('/api/ambient/items', { method: 'POST', headers: { 'X-AE-Admin': '1' }, body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Saving failed (${res.status}).`);
          if (data.state) S = { ...S, ...data.state };
        } catch (e) {
          prep.failed[song.id] = e.message || String(e);
          // the song may have changed on the server meanwhile — stop looping on stale data
          if (!S.ambient.songs.find((x) => x.id === song.id)) break;
        }
      }
    } finally {
      const total = prep.total;
      prep.running = false;
      prep.current = null;
      refreshStartup();
      refreshPublish();
      if (total) toast(`Sound cloud: ${plural(total - Object.keys(prep.failed).length, 'song')} prepared.`);
    }
  }
  setInterval(runPrepQueue, 4000);

  function refreshStartup() {
    if (ui.page === 'startup') render();
    else renderSide();
  }

  // Plays the drop / string exactly as the site does, with the current settings.
  let sfxCtx = null;
  let sfxStop = null;
  async function previewSfx(kind) {
    try {
      const { waterDrop, makeReverb, stringStandIn } = await import('/ae-boot/sfx.js');
      sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
      await sfxCtx.resume();
      if (sfxStop) { sfxStop(); sfxStop = null; }
      const c = sfxCtx;
      const st = { bubbleReverb: 0.45, bubbleSpace: 3, dropPitch: 1, stringReverb: 0.35, stringSpace: 4, effectsVolume: 0.9, stringVolume: 0.6, ...(S.settings.startup || {}) };
      const out = c.createGain();
      out.gain.value = kind === 'bubble' ? st.effectsVolume : st.stringVolume * 0.4;
      out.connect(c.destination);
      const verb = makeReverb(c, kind === 'bubble' ? { amount: st.bubbleReverb, seconds: st.bubbleSpace } : { amount: st.stringReverb, seconds: st.stringSpace });
      verb.output.connect(out);
      const bus = c.createGain();
      bus.connect(out); bus.connect(verb.input);
      const file = (S.ambient && S.ambient.sounds || {})[kind];
      const t = c.currentTime + 0.03;
      if (file) {
        const buf = await c.decodeAudioData(await (await fetch(site(file.url))).arrayBuffer());
        const src = c.createBufferSource(); src.buffer = buf; src.loop = kind === 'string'; src.connect(bus); src.start(t);
        if (kind === 'string') { bus.gain.setValueAtTime(1, t + 3); bus.gain.linearRampToValueAtTime(0, t + 3.6); src.stop(t + 3.7); }
        sfxStop = () => { try { src.stop(); } catch { /* ended */ } };
      } else if (kind === 'bubble') {
        waterDrop(c, bus, t, { pitch: st.dropPitch });
      } else {
        const node = stringStandIn(c, bus, (S.ambient && S.ambient.targetKey) || 0);
        bus.gain.setValueAtTime(1, t + 3); bus.gain.linearRampToValueAtTime(0, t + 3.6);
        node.stop(t + 3.7);
        sfxStop = () => node.stop();
      }
    } catch (e) {
      toast(`Couldn't play: ${e.message}`, 'error');
    }
  }

  function startupPage() {
    const A = S.ambient || { songs: [], sounds: {} };
    const st = S.settings.startup || {};
    const ready = A.songs.filter((s) => s.status === 'ready').length;
    const saveSet = (patch, msg) => act('PUT', '/api/settings', { settings: { startup: patch } }, () => msg && toast(msg));

    const statusLine = prep.current
      ? h('div', {},
        h('p', { class: 'prep-line' }, `Preparing “${prep.current.title}” — ${prep.index} of ${prep.total}`),
        h('div', { class: 'progress' }, h('i', { style: { width: `${Math.round(((prep.index - 1) / Math.max(1, prep.total)) * 100)}%` } })))
      : h('p', { class: 'prep-line' },
        `${ready} of ${plural(A.songs.length, 'song')} ready`,
        A.targetName ? ` · everything is tuned to ${A.targetName}` : '');

    const keyOptions = (s) => {
      const det = s.key ? `Found: ${s.key.name}` : 'Not analysed yet';
      const opts = [h('option', { value: '' }, det)];
      for (const mode of ['major', 'minor']) for (let t = 0; t < 12; t++) {
        const v = `${t}:${mode}`;
        opts.push(h('option', { value: v, selected: s.keyOverride && s.keyOverride.tonic === t && s.keyOverride.mode === mode ? true : null }, `${KEY_NAMES[t]} ${mode}`));
      }
      return opts;
    };
    const statusTag = (s) => {
      if (prep.current && prep.current.id === s.id) return h('span', { class: 'tag' }, 'preparing…');
      if (prep.failed[s.id]) return h('span', { class: 'tag warn', title: prep.failed[s.id] }, 'failed');
      return { ready: null, missing: h('span', { class: 'tag' }, 'waiting'), stale: h('span', { class: 'tag' }, 'changed — waiting'), upgrade: h('span', { class: 'tag' }, 'to MP3 — waiting') }[s.status];
    };

    const songs = h('div', { class: 'panel' },
      h('div', { class: 'panel-pad', style: { paddingBottom: '8px' } },
        statusLine,
        A.format === 'wav' ? h('p', { class: 'muted', style: { margin: '6px 0 0', fontSize: '13px' } },
          'Without ffmpeg the excerpts are saved as mono WAV (bigger). Install it (brew install ffmpeg) and restart the admin to switch to small MP3s automatically.') : null,
        Object.keys(prep.failed).length && !prep.running ? h('div', { class: 'row', style: { marginTop: '8px' } },
          h('span', { class: 'muted' }, `${plural(Object.keys(prep.failed).length, 'song')} couldn’t be prepared.`),
          h('button', { class: 'btn small', onclick: () => { prep.failed = {}; runPrepQueue(); } }, 'Try again')) : null),
      h('div', { class: 'songs' }, A.songs.map((s) => h('div', { class: `song-row ${s.enabled ? '' : 'is-off'}` },
        h('div', { class: 'who' }, h('b', { title: s.title }, s.title), h('span', { class: 'muted' }, `${s.artist} · ${s.album}`)),
        statusTag(s),
        h('select', { class: 'select key-select', 'aria-label': `Key of ${s.title}`, disabled: !s.key, 'data-k': `key:${s.id}`,
          onchange: (e) => {
            const [t, m] = e.target.value.split(':');
            act('PATCH', `/api/ambient/items/${s.id}`, { keyOverride: e.target.value ? { tonic: +t, mode: m } : null }, () => toast('Key saved.'));
          } }, keyOptions(s)),
        h('label', { class: 'switch', title: 'Use in the sound cloud' },
          h('input', { type: 'checkbox', role: 'switch', checked: s.enabled, disabled: !s.key, 'aria-label': `Use ${s.title}`, 'data-k': `on:${s.id}`,
            onchange: (e) => act('PATCH', `/api/ambient/items/${s.id}`, { enabled: e.target.checked }) }))))));

    const FX_DEF = { bubbleReverb: 0.45, bubbleSpace: 3, dropPitch: 1, stringReverb: 0.35, stringSpace: 4 };
    const slider = (label, k, hint, { min = 0, max = 1, step = 0.05, fmt = (v) => `${Math.round(v * 100)}%`, after } = {}) => {
      const v = st[k] ?? FX_DEF[k] ?? 0.8;
      const out = h('output', { class: 'muted' }, fmt(v));
      return h('label', { class: 'field' },
        h('span', { class: 'split' }, label, out),
        h('input', { type: 'range', class: 'range', min, max, step, value: v, 'data-k': `st:${k}`,
          oninput: (e) => { out.textContent = fmt(Number(e.target.value)); },
          onchange: (e) => { const val = Number(e.target.value); S.settings.startup = { ...st, [k]: val }; saveSet({ [k]: val }); if (after) after(); } }),
        hint ? h('small', {}, hint) : null);
    };
    const secs = (v) => `${v.toFixed(1)} s`;

    const SOUND_INFO = {
      bubble: ['Bubble', 'Plays when the button is clicked.', 'A single water drop (built in) plays until you add a file.'],
      string: ['String', 'Loops while waiting; louder the closer the pointer is to the button.', 'A soft built-in stand-in plays until you add a file.'],
      boot: ['Boot', 'Starts with the animation (after the ripple) and plays in sync with it.', 'A soft built-in stand-in plays until you add a file.'],
    };
    const CONTROLS = {
      bubble: [
        slider('Reverb', 'bubbleReverb', null, { after: () => previewSfx('bubble') }),
        slider('Reverb size', 'bubbleSpace', null, { min: 0.3, max: 10, step: 0.1, fmt: secs, after: () => previewSfx('bubble') }),
        (A.sounds || {}).bubble ? null : slider('Drop pitch', 'dropPitch', null, { min: 0.5, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, after: () => previewSfx('bubble') }),
      ],
      string: [
        slider('Reverb', 'stringReverb', null, { after: () => previewSfx('string') }),
        slider('Reverb size', 'stringSpace', null, { min: 0.3, max: 10, step: 0.1, fmt: secs, after: () => previewSfx('string') }),
      ],
      boot: [
        h('a', { class: 'btn small', href: '/admin/boot-editor/', target: '_blank', rel: 'noopener', style: { justifySelf: 'start' } }, 'Edit the boot animation ↗'),
      ],
    };
    const soundRow = (name) => {
      const [label, info, standIn] = SOUND_INFO[name];
      const f = (A.sounds || {})[name];
      const key = `snd:${name}`;
      return h('div', { class: 'sound-row' },
        h('div', {}, h('b', {}, label), h('span', { class: 'muted' }, f ? `${info} (${mb(f.size)})` : `${info} ${standIn}`)),
        CONTROLS[name],
        h('div', { class: 'row' },
          name === 'boot' ? (f ? h('button', { class: 'btn small', onclick: () => preview(f.url) }, 'Play') : null)
            : h('button', { class: 'btn small', onclick: () => previewSfx(name) }, 'Play'),
          dropZone({ key, accept: 'audio/*,.mp3,.wav,.m4a,.ogg', label: f ? 'Replace' : 'Add file', cls: 'sound-drop',
            onFiles: (files) => upload(`/api/ambient/sounds/${name}`, files, null, key, () => toast(`${label} sound saved.`)) }),
          f ? h('button', { class: 'btn quiet small', onclick: () => { if (confirm(`Remove the ${label.toLowerCase()} sound?`)) act('DELETE', `/api/ambient/sounds/${name}`, null, () => toast('Removed.')); } }, 'Remove') : null));
    };

    return h('div', {},
      head('Startup', 'What visitors hear on the “turn on computer” screen: a sound cloud made from the label’s songs while they wait, a bubble when they click, and the boot sound with the animation.',
        h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'Open preview ↗')),
      h('div', { class: 'two startup' },
        h('div', {}, h('div', { class: 'section-title', style: { marginTop: 0 } }, h('h2', {}, 'Songs in the cloud')), songs),
        h('div', { style: { display: 'grid', gap: '16px', alignContent: 'start' } },
          h('div', { class: 'panel panel-pad timing' },
            toggle('Play the sound cloud while waiting', st.ambient !== false, (on) => saveSet({ ambient: on }, on ? 'Sound cloud on.' : 'Sound cloud off.'), 'st:on'),
            slider('Sound cloud volume', 'volume'),
            slider('String volume', 'stringVolume', 'At its loudest right next to the button.'),
            slider('Bubble + boot volume', 'effectsVolume'),
            h('label', { class: 'field' }, h('span', {}, 'Tune every song to'),
              h('select', { class: 'select', 'data-k': 'st:key', onchange: (e) => saveSet({ targetKey: e.target.value === 'auto' ? 'auto' : Number(e.target.value) }, 'Key saved.') },
                h('option', { value: 'auto', selected: st.targetKey === 'auto' || st.targetKey === undefined ? true : null }, `Automatic${A.targetName && (st.targetKey === 'auto' || st.targetKey === undefined) ? ` (${A.targetName})` : ''}`),
                KEY_NAMES.map((n, i) => h('option', { value: i, selected: st.targetKey === i ? true : null }, `${n} major / ${KEY_NAMES[(i + 9) % 12]} minor`))),
              h('small', {}, 'Automatic picks the key that needs the least retuning.'))),
          h('div', { class: 'panel panel-pad' },
            h('h2', { style: { margin: '0 0 10px', fontSize: '16px' } }, 'Sounds'),
            ['bubble', 'string', 'boot'].map(soundRow)))));
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
