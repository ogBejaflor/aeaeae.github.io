// assets/js/folderSelection.js

/* ---------------- State ---------------- */
let isSelecting = false;
let isDraggingFolder = false;

let startX, startY, offsetX, offsetY;
let draggedFolder, parentRect;

let selectionScopeEl = null;
let startLocalX = 0, startLocalY = 0;

let dragStarted = false;
let dragStartX = 0, dragStartY = 0;

const desktopEl = document.getElementById('desktop');

/* ---------------- Selection Box (reparented to scope) ---------------- */
const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
selectionBoxDiv.style.position = 'absolute';
selectionBoxDiv.style.pointerEvents = 'none';
selectionBoxDiv.style.zIndex = '9999';

/* =========================
   Marquee Selection
========================= */
function beginSelection(event, scopeEl) {
  if (event.target.closest('.folder')) return; // drag handles folder mousedown

  isSelecting = true;
  selectionScopeEl = scopeEl;
  selectionScopeEl.classList.add('no-text-select');

  const cs = getComputedStyle(selectionScopeEl);
  if (cs.position === 'static') selectionScopeEl.style.position = 'relative';

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
window.attachWindowContentSelectionHandlers = attachWindowContentSelectionHandlers;

/* End selection / dragging globally */
document.addEventListener('mouseup', function (e) {
  if (isSelecting) endSelection();
  if (isDraggingFolder) stopDragFolder(e);
});

/* =========================
   Freeze Layout Helpers
========================= */
// Desktop: snapshot current positions so siblings don’t shift
function freezeDesktopLayout() {
  const scopeEl = desktopEl;
  const cs = getComputedStyle(scopeEl);
  if (cs.position === 'static') scopeEl.style.position = 'relative';

  const sr = scopeEl.getBoundingClientRect();
  const sLeft = scopeEl.scrollLeft || 0;
  const sTop  = scopeEl.scrollTop  || 0;

  const nodes = Array.from(scopeEl.querySelectorAll('.folder'))
    .filter(n => n.parentElement === scopeEl);

  const shots = nodes.map(node => {
    const r = node.getBoundingClientRect();
    return {
      node,
      left: r.left - sr.left + sLeft,
      top:  r.top  - sr.top  + sTop,
      w: node.offsetWidth,
      abs: getComputedStyle(node).position === 'absolute'
    };
  });

  shots.forEach(s => {
    if (!s.abs) {
      s.node.style.position = 'absolute';
      s.node.style.left = `${s.left}px`;
      s.node.style.top  = `${s.top}px`;
      s.node.style.width = `${s.w}px`;
    }
  });
}

// Window content: convert current grid positions to absolute ONCE
function freezeWindowContentLayout(contentEl) {
  if (!contentEl || contentEl.dataset.layoutFrozen === '1') return;

  const cs = getComputedStyle(contentEl);
  if (cs.position === 'static') contentEl.style.position = 'relative';

  const cr = contentEl.getBoundingClientRect();
  const sLeft = contentEl.scrollLeft || 0;
  const sTop  = contentEl.scrollTop  || 0;

  const nodes = Array.from(contentEl.querySelectorAll('.folder'))
    .filter(n => n.parentElement === contentEl);

  const shots = nodes.map(node => {
    const r = node.getBoundingClientRect();
    return {
      node,
      left: r.left - cr.left + sLeft,
      top:  r.top  - cr.top  + sTop,
      w: node.offsetWidth,
      abs: getComputedStyle(node).position === 'absolute'
    };
  });

  shots.forEach(s => {
    if (!s.abs) {
      s.node.style.position = 'absolute';
      s.node.style.left = `${s.left}px`;
      s.node.style.top  = `${s.top}px`;
      s.node.style.width = `${s.w}px`;
    }
  });

  contentEl.dataset.layoutFrozen = '1';
}

/* =========================
   Click & Double-click
========================= */
// Single click selects (ignore if it was a drag)
document.addEventListener('click', (e) => {
  const f = e.target.closest('.folder');
  if (!f) return;
  if (dragStarted) return; // a drag just happened; don't treat as click

  // Clear other selections globally (Finder-like single select)
  document.querySelectorAll('.folder.selected').forEach(el => {
    if (el !== f) el.classList.remove('selected');
  });
  f.classList.add('selected');
});

// Double-click opens (use existing windowControls openFolder if present)
document.addEventListener('dblclick', (e) => {
  const f = e.target.closest('.folder');
  if (!f) return;
  if (typeof window.openFolder === 'function') {
    window.openFolder(f);
  }
});

/* =========================
   Dragging
========================= */
function startFolderDrag(folder, event) {
  isDraggingFolder = true;
  dragStarted = false;
  draggedFolder = folder;
  window.draggedFolder = folder; // used by trash window drop logic

  const win = folder.closest('.window');
  const scopeEl = win ? win.querySelector('.window-content') : desktopEl;

  parentRect = scopeEl.getBoundingClientRect();

  const rect = folder.getBoundingClientRect();
  offsetX = event.clientX - rect.left;
  offsetY = event.clientY - rect.top;

  dragStartX = event.clientX;
  dragStartY = event.clientY;

  document.addEventListener('mousemove', onDragFolder);
}

function onDragFolder(event) {
  if (!(isDraggingFolder && draggedFolder)) return;

  // threshold so simple clicks don't reposition
  if (!dragStarted) {
    const dx = Math.abs(event.clientX - dragStartX);
    const dy = Math.abs(event.clientY - dragStartY);
    if (dx < 5 && dy < 5) return;

    dragStarted = true;

    // Freeze origin container now
    const originWin = draggedFolder.closest('.window');
    if (!originWin) {
      freezeDesktopLayout();
      parentRect = desktopEl.getBoundingClientRect();
    } else {
      const content = originWin.querySelector('.window-content');
      freezeWindowContentLayout(content);
      parentRect = content.getBoundingClientRect();
    }

    // Lock the dragged item’s current visual position
    const rectNow = draggedFolder.getBoundingClientRect();
    draggedFolder.style.position = 'absolute';
    draggedFolder.style.left = (rectNow.left - parentRect.left) + 'px';
    draggedFolder.style.top  = (rectNow.top  - parentRect.top)  + 'px';
    draggedFolder.style.zIndex = '1000';
    draggedFolder.style.pointerEvents = 'none'; // pass-through while dragging
  }

  // ------------------------------------------------------------
  // Position relative to the CURRENT container, respecting scroll
  // ------------------------------------------------------------
  let x, y;

  const parentIsContent =
    draggedFolder.parentElement &&
    draggedFolder.parentElement.classList.contains('window-content');

  if (parentIsContent) {
    const content = draggedFolder.parentElement;
    const cr = content.getBoundingClientRect();
    const sL = content.scrollLeft;
    const sT = content.scrollTop;

    const localX = event.clientX - cr.left - offsetX + sL;
    const localY = event.clientY - cr.top  - offsetY + sT;

    const fw = draggedFolder.offsetWidth;
    const fh = draggedFolder.offsetHeight;

    const minX = sL;
    const maxX = sL + content.clientWidth  - fw;
    const minY = sT;
    const maxY = sT + content.clientHeight - fh;

    x = Math.max(minX, Math.min(localX, maxX));
    y = Math.max(minY, Math.min(localY, maxY));

    parentRect = cr;
  } else {
    const dr = desktopEl.getBoundingClientRect();
    const fw = draggedFolder.offsetWidth;
    const fh = draggedFolder.offsetHeight;

    const localX = event.clientX - dr.left - offsetX;
    const localY = event.clientY - dr.top  - offsetY;

    const minX = 0;
    const maxX = dr.width  - fw;
    const minY = 0;
    const maxY = dr.height - fh;

    x = Math.max(minX, Math.min(localX, maxX));
    y = Math.max(minY, Math.min(localY, maxY));

    parentRect = dr;
  }

  draggedFolder.style.left = `${x}px`;
  draggedFolder.style.top  = `${y}px`;

  // -------------------------------
  // Reparent into the TOPMOST window
  // -------------------------------
  let movedToWindow = false;
  let hoveringOwnWindow = false;

  // Only consider the top window under the pointer
  const elUnder = document.elementFromPoint(event.clientX, event.clientY);
  const topWin = elUnder ? elUnder.closest('.window') : null;

  if (topWin) {
    const content = topWin.querySelector('.window-content');
    const cr = content.getBoundingClientRect();

    const insideContent =
      event.clientX > cr.left && event.clientX < cr.right &&
      event.clientY > cr.top  && event.clientY < cr.bottom;

    if (insideContent) {
      // prevent reparenting into the folder's own window (optional safety)
      const targetWinId = topWin.id || '';
      const folderWinId = draggedFolder.getAttribute('data-window') || '';
      if (targetWinId && folderWinId && targetWinId === folderWinId) {
        hoveringOwnWindow = true;
      } else {
        if (draggedFolder.parentElement !== content) {
          freezeWindowContentLayout(content); // freeze destination so no reflow
          content.appendChild(draggedFolder);
        }
        parentRect = cr;
        movedToWindow = true;
      }
    }
  }

  document.body.style.cursor = hoveringOwnWindow ? 'not-allowed' : '';

  // Reparent to desktop only if truly over desktop and not over a window
  if (!movedToWindow && !hoveringOwnWindow) {
    const dr = desktopEl.getBoundingClientRect();
    const overWindow = !!(elUnder && elUnder.closest('.window'));
    const overDesktop =
      event.clientX > dr.left && event.clientX < dr.right &&
      event.clientY > dr.top  && event.clientY < dr.bottom;

    if (overDesktop && !overWindow) {
      freezeDesktopLayout();
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
    checkTrashProximity(event);
  }
}

function stopDragFolder(e) {
  if (!isDraggingFolder) return;

  isDraggingFolder = false;
  document.body.style.cursor = '';

  if (draggedFolder) {
    draggedFolder.style.pointerEvents = ''; // restore

    const targetFolder = document.querySelector('.folder-target');

    if (targetFolder) {
      targetFolder.classList.remove('folder-target');
      const windowId = targetFolder.getAttribute('data-window');
      const targetWindow = document.getElementById(windowId);

      if (targetWindow) {
        // Ensure window shown (so sizes/rects are valid)
        if (targetWindow.style.display === 'none' && typeof openFolder === 'function') {
          openFolder(targetFolder);
        }

        const targetContent = targetWindow.querySelector('.window-content');
        freezeWindowContentLayout(targetContent);

        if (draggedFolder.parentElement !== targetContent) {
          targetContent.appendChild(draggedFolder);
        }

        // Place inside the visible viewport near pointer
        (function placeInVisibleViewport(content, folder, mouseEvt) {
          const cr = content.getBoundingClientRect();
          const sL = content.scrollLeft, sT = content.scrollTop;
          const fw = folder.offsetWidth,  fh = folder.offsetHeight;

          const desiredX = (mouseEvt.clientX - cr.left - offsetX) + sL;
          const desiredY = (mouseEvt.clientY - cr.top  - offsetY) + sT;

          const minX = sL + 8, maxX = sL + content.clientWidth  - fw - 8;
          const minY = sT + 8, maxY = sT + content.clientHeight - fh - 8;

          const x = Math.max(minX, Math.min(desiredX, maxX));
          const y = Math.max(minY, Math.min(desiredY, maxY));

          folder.style.position = 'absolute';
          folder.style.left = `${x}px`;
          folder.style.top  = `${y}px`;
          folder.style.zIndex = '';
        })(targetContent, draggedFolder, e);

        draggedFolder.style.pointerEvents = '';
      }
    } else {
      // Pointer-based trash hit-test (icon)
      const t = window.trash;
      if (t && e) {
        const r = t.getBoundingClientRect();
        const PAD = 60;
        const overTrash =
          e.clientX > (r.left - PAD) && e.clientX < (r.right + PAD) &&
          e.clientY > (r.top  - PAD) && e.clientY < (r.bottom + PAD);

        if (overTrash) {
          if (typeof addToTrash === 'function') addToTrash(draggedFolder);
          cleanupDragListeners();
          draggedFolder = null;
          window.draggedFolder = null;
          return;
        }
      }

      // If dropped inside a window-content keep absolute; desktop also keeps abs
      draggedFolder.style.zIndex = '';
    }
  }

  cleanupDragListeners();
  draggedFolder = null;
  window.draggedFolder = null;
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onDragFolder);
}

/* Bind per-folder drag start (static nodes at load; add similarly when injecting new ones) */
function bindFolderHandlers(root = document) {
  root.querySelectorAll('.folder').forEach(folder => {
    folder.addEventListener('dragstart', e => e.preventDefault()); // disable native ghost

    folder.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      startFolderDrag(folder, event);
    });
  });
}
bindFolderHandlers();

/* If you dynamically add folders later, call:
   bindFolderHandlers(containerEl);
   attachWindowContentSelectionHandlers();
*/
