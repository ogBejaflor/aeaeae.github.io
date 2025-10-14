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
   Topmost-scope helpers
========================= */

// Return the TOPMOST interactive scope under (x,y):
//  - if a .window is topmost, return its .window-content
//  - else return the desktop
function getTopScopeAt(x, y) {
  const stack = document.elementsFromPoint(x, y);
  const topWin = stack.find(el => el.classList && el.classList.contains('window'));
  if (topWin) {
    const content = topWin.querySelector('.window-content');
    if (content) return { scopeEl: content, winEl: topWin, type: 'window' };
  }
  // If no window is on top, treat as desktop if visible in the stack
  if (stack.includes(desktopEl)) {
    return { scopeEl: desktopEl, winEl: null, type: 'desktop' };
  }
  // Fallback
  return { scopeEl: desktopEl, winEl: null, type: 'desktop' };
}

// Folders within a scope (direct children for desktop, all for window-content)
function foldersInScope(scopeEl) {
  if (scopeEl === desktopEl) {
    return Array.from(scopeEl.querySelectorAll(':scope > .folder'));
  }
  return Array.from(scopeEl.querySelectorAll('.folder'));
}

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

  foldersInScope(scopeEl).forEach(f => f.classList.remove('selected'));
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
  foldersInScope(selectionScopeEl).forEach(folder => {
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

/* Desktop marquee (only if desktop is topmost at pointer) */
desktopEl.addEventListener('mousedown', function (event) {
  if (isDraggingFolder || event.button !== 0) return;
  const { scopeEl, type } = getTopScopeAt(event.clientX, event.clientY);
  if (type !== 'desktop' || scopeEl !== desktopEl) return;
  beginSelection(event, desktopEl);
});
desktopEl.addEventListener('mousemove', function (event) {
  if (isSelecting && selectionScopeEl === desktopEl && !isDraggingFolder) {
    updateSelection(event);
  }
});

/* Windows marquee (inside .window-content, only if that window is topmost) */
function attachWindowContentSelectionHandlers() {
  document.querySelectorAll('.window .window-content').forEach(content => {
    content.addEventListener('mousedown', function (event) {
      if (isDraggingFolder || event.button !== 0) return;
      const top = getTopScopeAt(event.clientX, event.clientY);
      if (top.scopeEl !== content) return; // only topmost
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

  const nodes = Array.from(scopeEl.querySelectorAll(':scope > .folder'))
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

  const nodes = Array.from(contentEl.querySelectorAll(':scope > .folder'));

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

  // Determine the *topmost* scope at the pointer
  const { scopeEl: topScope, winEl: topWin, type: scopeType } = getTopScopeAt(event.clientX, event.clientY);

  // Position relative to the CURRENT top scope, respecting its scroll
  let x, y;

  if (scopeType === 'window') {
    const content = topScope;
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

    // Prevent dropping into a window that's the folder's own target
    const targetWinId = topWin?.id || '';
    const folderWinId = draggedFolder.getAttribute('data-window') || '';
    const hoveringOwnWindow = targetWinId && folderWinId && targetWinId === folderWinId;

    document.body.style.cursor = hoveringOwnWindow ? 'not-allowed' : '';

    if (!hoveringOwnWindow && draggedFolder.parentElement !== content) {
      freezeWindowContentLayout(content); // freeze destination so no reflow
      content.appendChild(draggedFolder);
    }

    parentRect = cr;
  } else {
    // Desktop
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

    if (draggedFolder.parentElement !== desktopEl) {
      freezeDesktopLayout();
      desktopEl.appendChild(draggedFolder);
    }

    parentRect = dr;
  }

  draggedFolder.style.left = `${x}px`;
  draggedFolder.style.top  = `${y}px`;

  // Hover highlight ONLY within the topmost scope
  const inScope = foldersInScope(topScope)
    .filter(icon => icon !== draggedFolder && !icon.classList.contains('in-trash'));

  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  const topFolderUnderPointer = stack.find(el =>
    el.classList && el.classList.contains('folder') && inScope.includes(el)
  );

  // Clear all current highlights first
  document.querySelectorAll('.folder.folder-target').forEach(el => el.classList.remove('folder-target'));
  if (topFolderUnderPointer) topFolderUnderPointer.classList.add('folder-target');

  // Trash proximity (pointer-aware)
  if (typeof checkTrashProximity === 'function') {
    checkTrashProximity(event);
  }
}

function stopDragFolder(e) {
  if (!isDraggingFolder) return;

  isDraggingFolder = false;
  document.body.style.cursor = '';

  // Determine topmost scope at drop time
  const { scopeEl: topScope } = getTopScopeAt(e.clientX, e.clientY);

  if (draggedFolder) {
    draggedFolder.style.pointerEvents = ''; // restore

    // Topmost folder under pointer within this scope
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const inScope = foldersInScope(topScope).filter(icon => icon !== draggedFolder);
    const targetFolder = stack.find(el => el.classList && el.classList.contains('folder') && inScope.includes(el));

    // Clear any leftover highlights
    document.querySelectorAll('.folder.folder-target').forEach(f => f.classList.remove('folder-target'));

    if (targetFolder) {
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
