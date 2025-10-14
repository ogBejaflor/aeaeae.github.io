// assets/js/folderSelection.js

/* ----------------------------------
   Globals / State
---------------------------------- */
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

// Expose currently-dragged folder for trashWindow drop logic
window.draggedFolder = null;

// Selection box (reparented into the active scope)
const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
selectionBoxDiv.style.position = 'absolute';
selectionBoxDiv.style.pointerEvents = 'none';
selectionBoxDiv.style.zIndex = '9999';

const desktopEl = document.getElementById('desktop');

/* ----------------------------------
   Marquee Selection (Desktop + Windows)
---------------------------------- */
function beginSelection(event, scopeEl) {
  if (event.target.closest('.folder')) return; // dragging handles folder mousedown

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

/* ----------------------------------
   Freeze layout helpers
---------------------------------- */

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

// Window content: convert *current grid positions* to absolute ONCE
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

/* ----------------------------------
   Drop safety helpers
---------------------------------- */

// Block reparenting into a folder's own target window
function isOwnWindow(winEl, folderEl) {
  const targetWinId = winEl?.id || '';
  const folderWindowId = folderEl?.getAttribute('data-window') || '';
  return targetWinId && folderWindowId && targetWinId === folderWindowId;
}

// Only allow drops into the *topmost* window under the pointer
function isTopmostWindowAt(x, y, candidateWin) {
  const el = document.elementFromPoint(x, y);
  const topWin = el && el.closest ? el.closest('.window') : null;
  return topWin === candidateWin;
}

/* ----------------------------------
   Folder Dragging
---------------------------------- */

// Single-click vs. double-click selection/open
let singleClickTimer = null;

const folders = document.querySelectorAll('.folder');
folders.forEach(folder => {
  // prevent native drag ghost
  folder.addEventListener('dragstart', e => e.preventDefault());

  // DRAG START (mousedown)
  folder.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;

    isDraggingFolder = true;
    dragStarted = false;
    draggedFolder = folder;
    window.draggedFolder = folder;

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

  // --- Single click = select (drag-safe)
  folder.addEventListener('click', (e) => {
    // Ignore click fired right after a drag
    if (folder.__justDragged) {
      folder.__justDragged = false;
      return;
    }
    clearTimeout(singleClickTimer);
    singleClickTimer = setTimeout(() => {
      const scope = folder.closest('.window-content') || desktopEl;
      Array.from(scope.querySelectorAll('.folder')).forEach(f => f.classList.remove('selected'));
      folder.classList.add('selected');
    }, 180);
  });

  // --- Double click = open (your windowControls.js already binds dblclick->openFolder)
  folder.addEventListener('dblclick', () => {
    clearTimeout(singleClickTimer); // avoid select flash
    // If you'd rather handle opening here, call openFolder(folder) and
    // remove the dblclick listener in windowControls.js.
  });
});

function onDragFolder(event) {
  if (!(isDraggingFolder && draggedFolder)) return;

  // Start dragging after threshold
  if (!dragStarted) {
    const dx = Math.abs(event.clientX - dragStartX);
    const dy = Math.abs(event.clientY - dragStartY);
    if (dx < 5 && dy < 5) return;

    dragStarted = true;

    // Freeze origin container:
    const originWin = draggedFolder.closest('.window');
    if (!originWin) {
      // Desktop
      freezeDesktopLayout();
      parentRect = desktopEl.getBoundingClientRect();
    } else {
      // Window grid → freeze once so items won't jump
      const content = originWin.querySelector('.window-content');
      freezeWindowContentLayout(content);
      parentRect = content.getBoundingClientRect();
    }

    // Lock current visual position
    const rectNow = draggedFolder.getBoundingClientRect();
    draggedFolder.style.position = 'absolute';
    draggedFolder.style.left = (rectNow.left - parentRect.left) + 'px';
    draggedFolder.style.top  = (rectNow.top  - parentRect.top)  + 'px';
    draggedFolder.style.zIndex = '1000';
    draggedFolder.style.pointerEvents = 'none';
  }

  // Move within current parent
  let x = event.clientX - parentRect.left - offsetX;
  let y = event.clientY - parentRect.top  - offsetY;

  const maxX = Math.max(0, parentRect.width  - draggedFolder.offsetWidth);
  const maxY = Math.max(0, parentRect.height - draggedFolder.offsetHeight);
  x = Math.min(Math.max(0, x), maxX);
  y = Math.min(Math.max(0, y), maxY);

  draggedFolder.style.left = `${x}px`;
  draggedFolder.style.top  = `${y}px`;

  // Reparent into hovered window CONTENT if it is the TOPMOST under the cursor
  const windows = document.querySelectorAll('.window');
  let movedToWindow = false;
  let hoveringOwnWindow = false;

  windows.forEach(win => {
    const content = win.querySelector('.window-content');
    const cr = content.getBoundingClientRect();

    if (
      event.clientX > cr.left && event.clientX < cr.right &&
      event.clientY > cr.top  && event.clientY < cr.bottom
    ) {
      // only if win is topmost at pointer
      if (!isTopmostWindowAt(event.clientX, event.clientY, win)) return;

      if (isOwnWindow(win, draggedFolder)) {
        hoveringOwnWindow = true;
        return;
      }
      if (draggedFolder.parentElement !== content) {
        // Freeze destination once so it doesn't reflow existing items
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
    draggedFolder.style.pointerEvents = ''; // restore for clicks

    // suppress the synthetic click that fires after a drag
    draggedFolder.__justDragged = true;
    setTimeout(() => { if (draggedFolder) draggedFolder.__justDragged = false; }, 0);

    const targetFolder = document.querySelector('.folder-target');

    if (targetFolder) {
      targetFolder.classList.remove('folder-target');

      const windowId = targetFolder.getAttribute('data-window');
      const targetWindow = document.getElementById(windowId);

      if (targetWindow) {
        // Make sure window is visible BEFORE measuring/freeze
        if (targetWindow.style.display === 'none' && typeof openFolder === 'function') {
          openFolder(targetFolder); // shows & staggers
        }

        const targetContent = targetWindow.querySelector('.window-content');
        // Freeze once so existing items don't jump
        freezeWindowContentLayout(targetContent);

        // Drop the item (keep absolute so grid doesn't shuffle)
        if (draggedFolder.parentElement !== targetContent) {
          targetContent.appendChild(draggedFolder);
        }

        draggedFolder.style.zIndex = '';
        draggedFolder.style.left = draggedFolder.style.left || '12px';
        draggedFolder.style.top  = draggedFolder.style.top  || '12px';
      }
    } else {
      // Trash hit-test with padding
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

      // If dropped inside a window-content, keep absolute; on desktop keep absolute too.
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
