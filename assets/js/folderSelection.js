// assets/js/folderSelection.js

let isSelecting = false;
let isDraggingFolder = false;

let startX, startY, offsetX, offsetY;
let draggedFolder, parentRect;

// Selection scope: #desktop or a specific .window-content
let selectionScopeEl = null;
let startLocalX = 0, startLocalY = 0;

// Selection box (reparented into the active scope)
const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
selectionBoxDiv.style.position = 'absolute';
selectionBoxDiv.style.pointerEvents = 'none';
selectionBoxDiv.style.zIndex = '9999';

const desktopEl = document.getElementById('desktop');

/* ---------------- Marquee Selection (Desktop + Window Content) ---------------- */

function beginSelection(event, scopeEl) {
  if (event.target.closest('.folder')) return; // let drag handle it

  isSelecting = true;
  selectionScopeEl = scopeEl;
  selectionScopeEl.classList.add('no-text-select');

  // Ensure scope can contain abs children (CSS should already do this for .window-content)
  const cs = getComputedStyle(selectionScopeEl);
  if (cs.position === 'static') selectionScopeEl.style.position = 'relative';

  // Render selection box inside/on top of scope
  if (selectionBoxDiv.parentElement !== selectionScopeEl) {
    selectionScopeEl.appendChild(selectionBoxDiv);
  }

  const sr = selectionScopeEl.getBoundingClientRect();
  const sLeft = selectionScopeEl.scrollLeft || 0;
  const sTop  = selectionScopeEl.scrollTop  || 0;

  startX = event.clientX;
  startY = event.clientY;
  startLocalX = startX - sr.left + sLeft;
  startLocalY = startY - sr.top  + sTop;

  Object.assign(selectionBoxDiv.style, {
    left: `${startLocalX}px`,
    top: `${startLocalY}px`,
    width: '0px',
    height: '0px',
    display: 'block'
  });

  scopeEl.querySelectorAll('.folder').forEach(f => f.classList.remove('selected'));
  event.preventDefault();
}

function updateSelection(event) {
  if (!selectionScopeEl) return;

  const sr = selectionScopeEl.getBoundingClientRect();
  const sLeft = selectionScopeEl.scrollLeft || 0;
  const sTop  = selectionScopeEl.scrollTop  || 0;

  const curLocalX = event.clientX - sr.left + sLeft;
  const curLocalY = event.clientY - sr.top  + sTop;

  const left   = Math.min(startLocalX, curLocalX);
  const top    = Math.min(startLocalY, curLocalY);
  const width  = Math.abs(curLocalX - startLocalX);
  const height = Math.abs(curLocalY - startLocalY);

  selectionBoxDiv.style.left   = `${left}px`;
  selectionBoxDiv.style.top    = `${top}px`;
  selectionBoxDiv.style.width  = `${width}px`;
  selectionBoxDiv.style.height = `${height}px`;

  // Hit-test using page-space rects
  const selectionRect = selectionBoxDiv.getBoundingClientRect();
  selectionScopeEl.querySelectorAll('.folder').forEach(folder => {
    const r = folder.getBoundingClientRect();
    const overlap =
      selectionRect.left < r.right &&
      selectionRect.right > r.left &&
      selectionRect.top < r.bottom &&
      selectionRect.bottom > r.top;
    folder.classList.toggle('selected', overlap);
  });
}

function endSelection() {
  isSelecting = false;
  selectionBoxDiv.style.display = 'none';
  if (selectionScopeEl) {
    selectionScopeEl.classList.remove('no-text-select');
    selectionScopeEl = null;
  }
}

/* Desktop marquee (ignore if over a window) */
desktopEl.addEventListener('mousedown', function (event) {
  if (isDraggingFolder || event.button !== 0) return;
  if (event.target.closest('.window')) return;
  beginSelection(event, desktopEl);
});
desktopEl.addEventListener('mousemove', function (event) {
  if (isSelecting && selectionScopeEl === desktopEl && !isDraggingFolder) {
    updateSelection(event);
  }
});

/* Windows marquee (inside .window-content) */
function attachWindowContentSelectionHandlers() {
  document.querySelectorAll('.window .window-content').forEach(content => {
    content.addEventListener('mousedown', function (event) {
      if (isDraggingFolder || event.button !== 0) return;
      beginSelection(event, content);
    }, true);

    content.addEventListener('mousemove', function (event) {
      if (isSelecting && selectionScopeEl === content && !isDraggingFolder) {
        updateSelection(event);
      }
    });
  });
}
attachWindowContentSelectionHandlers();

/* Global mouseup → end selection & dragging (pass event to drop logic) */
document.addEventListener('mouseup', function (e) {
  if (isSelecting) endSelection();
  if (isDraggingFolder) stopDragFolder(e);
});

/* ---------------- Folder Dragging ---------------- */

const folders = document.querySelectorAll('.folder');
folders.forEach(folder => {
  folder.addEventListener('dragstart', e => e.preventDefault());

  folder.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;

    isDraggingFolder = true;
    draggedFolder = folder;

    const rect = folder.getBoundingClientRect();

    // Parent bounds: use .window-content when inside a window; else desktop
    const win = folder.closest('.window');
    if (win) {
      const content = win.querySelector('.window-content');
      parentRect = content.getBoundingClientRect();
    } else {
      parentRect = desktopEl.getBoundingClientRect();
    }

    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    folder.style.position = 'absolute';
    folder.style.zIndex = '1000';

    document.addEventListener('mousemove', onDragFolder);
    // NOTE: no per-mousedown mouseup listener — we rely on the global one above
  });
});

// Prevent reparenting into a folder's own target window
function isOwnWindow(winEl, folderEl) {
  const targetWinId = winEl?.id || '';
  const folderWindowId = folderEl?.getAttribute('data-window') || '';
  return targetWinId && folderWindowId && targetWinId === folderWindowId;
}

function onDragFolder(event) {
  if (!(isDraggingFolder && draggedFolder)) return;

  // Position relative to current parentRect
  let x = event.clientX - parentRect.left - offsetX;
  let y = event.clientY - parentRect.top  - offsetY;

  // Clamp within parent bounds
  const maxX = Math.max(0, parentRect.width  - draggedFolder.offsetWidth);
  const maxY = Math.max(0, parentRect.height - draggedFolder.offsetHeight);
  x = Math.min(Math.max(0, x), maxX);
  y = Math.min(Math.max(0, y), maxY);

  draggedFolder.style.left = `${x}px`;
  draggedFolder.style.top  = `${y}px`;

  // Move into hovered window CONTENT (not header/border)
  const windows = document.querySelectorAll('.window');
  let movedToWindow = false;
  let hoveringOwnWindow = false;

  windows.forEach(win => {
    const content = win.querySelector('.window-content');
    const cr = content.getBoundingClientRect();

    if (event.clientX > cr.left && event.clientX < cr.right &&
        event.clientY > cr.top  && event.clientY < cr.bottom) {
      if (isOwnWindow(win, draggedFolder)) {
        hoveringOwnWindow = true; // block own window
        return;
      }
      if (draggedFolder.parentElement !== content) {
        content.appendChild(draggedFolder);
      }
      parentRect = cr;
      movedToWindow = true;
    }
  });

  document.body.style.cursor = hoveringOwnWindow ? 'not-allowed' : '';

  // Only reparent to desktop if truly over desktop and not over any window
  if (!movedToWindow && !hoveringOwnWindow) {
    const dr = desktopEl.getBoundingClientRect();
    const elUnder = document.elementFromPoint(event.clientX, event.clientY);
    const overWindow = !!elUnder && !!elUnder.closest('.window');
    const overDesktop =
      event.clientX > dr.left && event.clientX < dr.right &&
      event.clientY > dr.top  && event.clientY < dr.bottom;

    if (overDesktop && !overWindow) {
      if (draggedFolder.parentElement !== desktopEl) {
        desktopEl.appendChild(draggedFolder);
      }
      parentRect = dr;
    }
  }

  // Hover target highlight over other folder icons (not trashed)
  document.querySelectorAll('.folder:not(.in-trash)').forEach(icon => {
    const r = icon.getBoundingClientRect();
    const hit =
      event.clientX > r.left && event.clientX < r.right &&
      event.clientY > r.top  && event.clientY < r.bottom &&
      icon !== draggedFolder;
    icon.classList.toggle('folder-target', hit);
  });

  // Trash proximity (pointer-aware)
  if (typeof checkTrashProximity === 'function') {
    checkTrashProximity(event); // use pointer location for nicer UX
  }
}

// Stop dragging and cleanup
function stopDragFolder(e) {
  if (!isDraggingFolder) return;

  isDraggingFolder = false;
  document.body.style.cursor = ''; // reset any not-allowed cursor

  if (draggedFolder) {
    const targetFolder = document.querySelector('.folder-target');

    if (targetFolder) {
      targetFolder.classList.remove('folder-target');
      const windowId = targetFolder.getAttribute('data-window');
      const targetWindow = document.getElementById(windowId);

      if (targetWindow) {
        const targetContent = targetWindow.querySelector('.window-content');
        targetContent.appendChild(draggedFolder);

        draggedFolder.style.left = '10px';
        draggedFolder.style.top  = '10px';
        draggedFolder.style.zIndex = '';

        if (typeof openFolder === 'function') openFolder(targetFolder);
      }
    } else {
      // Pointer-based hit-test over the trash dock icon (with padding)
      const t = window.trash;
      if (t && e) {
        const r = t.getBoundingClientRect();
        const PAD = 60; // tolerance around the icon
        const overTrash =
          e.clientX > (r.left - PAD) && e.clientX < (r.right + PAD) &&
          e.clientY > (r.top  - PAD) && e.clientY < (r.bottom + PAD);

        if (overTrash) {
          if (typeof addToTrash === 'function') addToTrash(draggedFolder);
          draggedFolder = null;
          document.removeEventListener('mousemove', onDragFolder);
          return;
        }
      }
      // not over trash — just clean up
      draggedFolder.style.zIndex = '';
    }
  }

  draggedFolder = null;
  document.removeEventListener('mousemove', onDragFolder);
}
