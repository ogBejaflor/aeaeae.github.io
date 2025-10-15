// assets/js/folderSelection.js

/* ---------------- State ---------------- */
let isSelecting = false;
let isDraggingFolder = false;

let startX, startY, offsetX, offsetY;
let draggedFolder, parentRect;

// Group drag state
let draggedGroup = [];                  // array of folder HTMLElements in the drag
let groupOffsets = new Map();           // el -> { dxFromLeader, dyFromLeader, w, h }
let leaderFolder = null;                // the folder that received mousedown
let leaderGrabDX = 0, leaderGrabDY = 0; // pointer offset inside the leader
let groupScopeEl = null;                // current active scope for the group (desktop or a .window-content)
let groupScopeType = 'desktop';         // 'desktop' | 'window'

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
  // 🚫 Don’t start marquee on the 2nd click of a double-click
  if (event.detail > 1) return;

  // If user clicked on a folder, folder mousedown handles behavior
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
   Dragging (multi-select aware)
========================= */
function startFolderDrag(folder, event) {
  isDraggingFolder = true;
  dragStarted = false;
  leaderFolder = folder;
  draggedFolder = folder; // retained for compatibility with other code
  window.draggedFolder = folder; // used by trash window drop logic

  // Build the drag group:
  // - If the clicked folder is selected and there are other selected siblings in the same initial scope,
  //   drag them all together. Otherwise only drag the clicked folder.
  const initialWin = folder.closest('.window');
  const initialScope = initialWin ? initialWin.querySelector('.window-content') : desktopEl;
  const initialScopeType = initialWin ? 'window' : 'desktop';

  groupScopeEl = initialScope;
  groupScopeType = initialScopeType;

  // Freeze the origin container so positions are absolute & stable
  if (initialScopeType === 'desktop') {
    freezeDesktopLayout();
  } else {
    freezeWindowContentLayout(initialScope);
  }

  // Collect selected folders in the SAME scope; fallback to single folder
  const candidates = foldersInScope(initialScope).filter(el => el.style.display !== 'none');
  const selectedInScope = candidates.filter(el => el.classList.contains('selected'));
  draggedGroup = (selectedInScope.length && selectedInScope.includes(folder))
    ? selectedInScope
    : [folder];

  // Ensure all dragged items are direct children of the scope, absolutely positioned
  const sr = initialScope.getBoundingClientRect();
  const sLeft = initialScope.scrollLeft || 0;
  const sTop  = initialScope.scrollTop  || 0;

  // Leader pointer offset (inside the leader’s rect)
  const leaderRect = folder.getBoundingClientRect();
  leaderGrabDX = event.clientX - leaderRect.left;
  leaderGrabDY = event.clientY - leaderRect.top;

  // Snapshot offsets for each item relative to the leader (preserve spacing)
  groupOffsets.clear();
  const leaderLeft = leaderRect.left - sr.left + sLeft;
  const leaderTop  = leaderRect.top  - sr.top  + sTop;

  draggedGroup.forEach(el => {
    const r = el.getBoundingClientRect();
    // Ensure absolute positioning and correct parent
    if (el.parentElement !== initialScope) {
      initialScope.appendChild(el);
    }
    el.style.position = 'absolute';
    el.style.left = (r.left - sr.left + sLeft) + 'px';
    el.style.top  = (r.top  - sr.top  + sTop ) + 'px';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';

    const dxFromLeader = (r.left - sr.left + sLeft) - leaderLeft;
    const dyFromLeader = (r.top  - sr.top  + sTop ) - leaderTop;

    groupOffsets.set(el, {
      dxFromLeader,
      dyFromLeader,
      w: el.offsetWidth || 100,
      h: el.offsetHeight || 120
    });
  });

  dragStartX = event.clientX;
  dragStartY = event.clientY;

  document.addEventListener('mousemove', onDragFolder);
}

function onDragFolder(event) {
  if (!(isDraggingFolder && leaderFolder)) return;

  // Debounce simple clicks
  if (!dragStarted) {
    const dx0 = Math.abs(event.clientX - dragStartX);
    const dy0 = Math.abs(event.clientY - dragStartY);
    if (dx0 < 5 && dy0 < 5) return;

    dragStarted = true;
  }

  // Determine the topmost scope under the pointer (desktop or a window-content)
  const { scopeEl: topScope, winEl: topWin, type: scopeType } = getTopScopeAt(event.clientX, event.clientY);

  // If scope changes during drag, re-parent whole group into new scope and freeze it
  if (topScope && topScope !== groupScopeEl) {
    if (scopeType === 'desktop') {
      freezeDesktopLayout();
    } else {
      freezeWindowContentLayout(topScope);
    }
    draggedGroup.forEach(el => {
      if (el.parentElement !== topScope) topScope.appendChild(el);
    });
    groupScopeEl = topScope;
    groupScopeType = scopeType;
  }

  const scope = groupScopeEl || desktopEl;
  const sr = scope.getBoundingClientRect();
  const sLeft = scope.scrollLeft || 0;
  const sTop  = scope.scrollTop  || 0;

  // Desired leader position in scope-local coordinates (account for pointer offset inside leader)
  let leaderX = (event.clientX - sr.left + sLeft) - leaderGrabDX;
  let leaderY = (event.clientY - sr.top  + sTop ) - leaderGrabDY;

  // Clamp leader so that ALL group members remain in-bounds
  const padding = 0;
  const W = scope.clientWidth;
  const H = scope.clientHeight;

  // Compute group’s extents relative to leader
  let minDX = Infinity, minDY = Infinity, maxDXR = -Infinity, maxDYB = -Infinity;
  draggedGroup.forEach(el => {
    const off = groupOffsets.get(el);
    if (!off) return;
    minDX = Math.min(minDX, off.dxFromLeader);
    minDY = Math.min(minDY, off.dyFromLeader);
    maxDXR = Math.max(maxDXR, off.dxFromLeader + off.w);
    maxDYB = Math.max(maxDYB, off.dyFromLeader + off.h);
  });

  const leaderMinX = padding - minDX;
  const leaderMaxX = (W - padding) - maxDXR;
  const leaderMinY = padding - minDY;
  const leaderMaxY = (H - padding) - maxDYB;

  leaderX = Math.max(leaderMinX, Math.min(leaderX, leaderMaxX));
  leaderY = Math.max(leaderMinY, Math.min(leaderY, leaderMaxY));

  // Position each item by its stored offset from the leader
  draggedGroup.forEach(el => {
    const off = groupOffsets.get(el);
    if (!off) return;
    el.style.left = `${leaderX + off.dxFromLeader}px`;
    el.style.top  = `${leaderY + off.dyFromLeader}px`;
  });

  // Hover highlight ONLY within the current scope
  const inScope = foldersInScope(scope)
    .filter(icon => !draggedGroup.includes(icon) && !icon.classList.contains('in-trash'));

  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  const topFolderUnderPointer = stack.find(el =>
    el.classList && el.classList.contains('folder') && inScope.includes(el)
  );

  // Clear & set highlight
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

  const scope = groupScopeEl || desktopEl;

  // Restore pointer events & z-index
  draggedGroup.forEach(el => {
    el.style.pointerEvents = '';
    el.style.zIndex = '';
  });

  // Resolve drop target (folder under pointer within current scope)
  const stack = document.elementsFromPoint(e.clientX, e.clientY);
  const inScope = foldersInScope(scope).filter(icon => !draggedGroup.includes(icon));
  const targetFolder = stack.find(el => el.classList && el.classList.contains('folder') && inScope.includes(el));

  // Clear highlight
  document.querySelectorAll('.folder.folder-target').forEach(f => f.classList.remove('folder-target'));

  // 1) Trash drop — if pointer is near the dock Trash, move all
  const t = window.trash;
  if (t && e) {
    const r = t.getBoundingClientRect();
    const PAD = 60;
    const overTrash =
      e.clientX > (r.left - PAD) && e.clientX < (r.right + PAD) &&
      e.clientY > (r.top  - PAD) && e.clientY < (r.bottom + PAD);

    if (overTrash) {
      if (typeof addToTrash === 'function') {
        draggedGroup.forEach(el => addToTrash(el));
      }
      cleanupDragListeners();
      draggedGroup = [];
      leaderFolder = null;
      window.draggedFolder = null;
      dragStarted = false; // ✅ ensure next double-click works
      return;
    }
  }

  // 2) Drop onto a folder (open its window and move entire group inside)
  if (targetFolder) {
    const windowId = targetFolder.getAttribute('data-window');
    const targetWindow = document.getElementById(windowId);

    if (targetWindow) {
      // Ensure window is shown so we can measure
      if (targetWindow.style.display === 'none' && typeof openFolder === 'function') {
        openFolder(targetFolder);
      }

      const content = targetWindow.querySelector('.window-content');
      freezeWindowContentLayout(content);

      // Place group near pointer inside target window’s viewport, keeping their relative offsets
      const cr = content.getBoundingClientRect();
      const sL = content.scrollLeft, sT = content.scrollTop;

      // Leader desired in content-local coords
      let leaderX = (e.clientX - cr.left + sL) - leaderGrabDX;
      let leaderY = (e.clientY - cr.top  + sT) - leaderGrabDY;

      // Clamp so the whole group fits inside the content
      const W = content.clientWidth;
      const H = content.clientHeight;

      let minDX = Infinity, minDY = Infinity, maxDXR = -Infinity, maxDYB = -Infinity;
      draggedGroup.forEach(el => {
        const off = groupOffsets.get(el);
        if (!off) return;
        minDX = Math.min(minDX, off.dxFromLeader);
        minDY = Math.min(minDY, off.dyFromLeader);
        maxDXR = Math.max(maxDXR, off.dxFromLeader + off.w);
        maxDYB = Math.max(maxDYB, off.dyFromLeader + off.h);
      });

      const leaderMinX = sL + 8 - minDX;
      const leaderMaxX = sL + W - 8 - maxDXR;
      const leaderMinY = sT + 8 - minDY;
      const leaderMaxY = sT + H - 8 - maxDYB;

      leaderX = Math.max(leaderMinX, Math.min(leaderX, leaderMaxX));
      leaderY = Math.max(leaderMinY, Math.min(leaderY, leaderMaxY));

      // Re-parent and position each item
      draggedGroup.forEach(el => {
        if (el.parentElement !== content) content.appendChild(el);
        const off = groupOffsets.get(el);
        el.style.position = 'absolute';
        el.style.left = `${leaderX + off.dxFromLeader}px`;
        el.style.top  = `${leaderY + off.dyFromLeader}px`;
      });

      cleanupDragListeners();
      draggedGroup = [];
      leaderFolder = null;
      window.draggedFolder = null;
      dragStarted = false; // ✅ ensure next double-click works
      return;
    }
  }

  // 3) Otherwise, leave them where they are (already positioned absolutely in current scope)
  cleanupDragListeners();
  draggedGroup = [];
  leaderFolder = null;
  window.draggedFolder = null;
  dragStarted = false; // ✅ ensure next double-click works
}

function cleanupDragListeners() {
  document.removeEventListener('mousemove', onDragFolder);
}

/* Bind per-folder drag start (static nodes at load; add similarly when injecting new ones) */
function bindFolderHandlers(root = document) {
  root.querySelectorAll('.folder').forEach(folder => {
    // Disable native drag ghost
    folder.addEventListener('dragstart', e => e.preventDefault());

    // Our drag
    folder.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      if (event.detail > 1) return; // ✅ ignore second click of a double-click
      if (window.PHYSICS_ON) return; // physics mode takes over dragging
      startFolderDrag(folder, event);
    });
  });
}

bindFolderHandlers();

/* If you dynamically add folders later, call:
   bindFolderHandlers(containerEl);
   attachWindowContentSelectionHandlers();
*/
