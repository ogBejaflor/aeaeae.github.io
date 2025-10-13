// assets/js/folderSelection.js

let isSelecting = false;
let isDraggingFolder = false;

let startX, startY, offsetX, offsetY;
let draggedFolder, parentRect;

// Selection scope: #desktop or a specific .window-content
let selectionScopeEl = null;
let startLocalX = 0, startLocalY = 0;

// Drag threshold
let dragStarted = false;
let dragStartX = 0, dragStartY = 0;

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
  if (event.target.closest('.folder')) return;

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

/* Global mouseup → end selection & dragging (pass event to drop logic) */
document.addEventListener('mouseup', function (e) {
  if (isSelecting) endSelection();
  if (isDraggingFolder) stopDragFolder(e);
});

/* ---------------- Freeze layout helpers ---------------- */

// Desktop: freeze to absolute so siblings don’t shift
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

// NEW: Window content freeze — converts current grid positions to absolute ONCE
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

  // mark as frozen so we don’t repeat
  contentEl.dataset.layoutFrozen = '1';
}

/* ---------------- Folder Dragging ---------------- */

const folders = document.querySelectorAll('.folder');
folders.forEach(folder => {
  folder.addEventListener('dragstart', e => e.preventDefault()); // no native ghost

  folder.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;

    isDraggingFolder = true;
    dragStarted = false;
    draggedFolder = folder;
    window.draggedFolder = folder; // expose for trash window drop logic

    const win = folder.closest('.window');
    const scopeEl = win ? win.querySelector('.window-content') : desktopEl;

    parentRect = scopeEl.getBoundingClientRect();

    const rect = folder.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    dragStartX = event.clientX;
    dragStartY = event.clientY;

    document.addEventListener('mousemove', onDragFolder);
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

  // Start actual dragging after a tiny threshold
  if (!dragStarted) {
    const dx = Math.abs(event.clientX - dragStartX);
    const dy = Math.abs(event.clientY - dragStartY);
    if (dx < 5 && dy < 5) return;

    dragStarted = true;

    // Freeze origin container:
    const originWin = draggedFolder.closest('.window');
    if (!originWin) {
      // Desktop freezes like before
      freezeDesktopLayout();
      parentRect = desktopEl.getBoundingClientRect();
    } else {
      // Freeze THIS window’s grid so items won’t jump
      const content = originWin.querySelector('.window-content');
      freezeWindowContentLayout(content);
      parentRect = content.getBoundingClientRect();
    }

    // Lock the dragged item’s visual position
    const rectNow = draggedFolder.getBoundingClientRect();
    draggedFolder.style.position = 'absolute';
    draggedFolder.style.left = (rectNow.left - parentRect.left) + 'px';
    draggedFolder.style.top  = (rectNow.top  - parentRect.top)  + 'px';
    draggedFolder.style.zIndex = '1000';
    draggedFolder.style.pointerEvents = 'none';
  }

  // Position relative to current parentRect
  let x = event.clientX - parentRect.left - offsetX;
  let y = event.clientY - parentRect.top  - offsetY;

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
        hoveringOwnWindow = true;
        return;
      }
      if (draggedFolder.parentElement !== content) {
        // Freeze destination grid BEFORE appending so it won’t reflow
        freezeWindowContentLayout(content);
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
        const targetContent = targetWindow.querySelector('.window-content');

        // Freeze destination window (if not already) then drop
        freezeWindowContentLayout(targetContent);
        targetContent.appendChild(draggedFolder);

        // IMPORTANT: keep absolute positioning inside windows
        // so nothing reflows after the drop
        draggedFolder.style.zIndex = '';
        if (typeof openFolder === 'function') openFolder(targetFolder);
      }
    } else {
      // Pointer-based trash hit-test
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

      // If dropped inside a window-content, keep absolute.
      const parentIsContent = draggedFolder.parentElement &&
        draggedFolder.parentElement.classList.contains('window-content');

      if (parentIsContent) {
        // keep left/top; just clear z-index
        draggedFolder.style.zIndex = '';
      } else {
        // On desktop keep absolute placement; just clear z-index
        draggedFolder.style.zIndex = '';
      }
    }
  }

  cleanupDragListeners();
  draggedFolder = null;
  window.draggedFolder = null;
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onDragFolder);
}
