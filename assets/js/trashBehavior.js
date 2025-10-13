// assets/js/trashBehavior.js

/* ------------------------------------------------------------------ */
/* Globals                                                             */
/* ------------------------------------------------------------------ */
window.trashedFolders = window.trashedFolders || [];

// Try to locate the dock "trash" item, but keep the file resilient
const trashDockItem = document.querySelector('.dock-item[data-window="trash-window"]');

// Expose references on window for other scripts (may be null if not found)
window.trash = trashDockItem || null;
window.trashIcon = trashDockItem ? trashDockItem.querySelector('img') : null;

// Icon sources (adjust paths if yours differ)
const EMPTY_ICON_SRC = 'assets/icons/trash-icon.png';
const FULL_ICON_SRC  = 'assets/icons/trash-icon-full.png';

/* ------------------------------------------------------------------ */
/* Utility: event emitter so other files can react to trash updates    */
/* ------------------------------------------------------------------ */
function emitTrashChanged() {
  window.dispatchEvent(new CustomEvent('trash-changed'));
}
window.emitTrashChanged = emitTrashChanged;

/* ------------------------------------------------------------------ */
/* If trash elements aren’t available yet, export safe no-ops          */
/* ------------------------------------------------------------------ */
if (!window.trash || !window.trashIcon) {
  console.warn('[trashBehavior] Trash dock item not found. Exporting safe no-ops.');

  window.setTrashIconByState = function setTrashIconByState() {};
  window.enlargeTrash = function enlargeTrash() {};
  window.resetTrashSize = function resetTrashSize() {};
  window.checkTrashProximity = function checkTrashProximity() {};
  window.addToTrash = function addToTrash() {
    // Still manage the data list & notify, even if no UI is present yet
    // (caller should have pushed the element already)
    emitTrashChanged();
  };

  // Nothing else to wire up if the dock item isn't present yet.
  // Once the DOM has it and this file re-runs (or another file updates references),
  // the functions above will be replaced by the real ones.
} else {
  /* ---------------------------------------------------------------- */
  /* Helpers (real implementations)                                   */
  /* ---------------------------------------------------------------- */

  function setTrashIconByState() {
    const hasItems = (window.trashedFolders || []).some(
      el => el && el.classList && el.classList.contains('in-trash')
    );
    window.trashIcon.src = hasItems ? FULL_ICON_SRC : EMPTY_ICON_SRC;
  }

  function enlargeTrash() {
    if (!window.trash || !window.trashIcon) return;
    window.trashIcon.style.transform = 'scale(1.5)';
    window.trashIcon.style.transition = 'transform 0.2s ease';
    window.trash.classList.add('trash-enlarged');
  }

  function resetTrashSize() {
    if (!window.trash || !window.trashIcon) return;
    window.trashIcon.style.transform = 'scale(1)';
    window.trashIcon.style.transition = 'transform 0.2s ease';
    window.trash.classList.remove('trash-enlarged');
  }

  /**
   * Pointer-aware proximity check.
   * Accepts either a MouseEvent (preferred) or a folder element (fallback).
   */
  function checkTrashProximity(arg) {
    if (!window.trash) return;

    const trashRect = window.trash.getBoundingClientRect();

    // MouseEvent: use pointer location for nicer UX
    if (arg && typeof arg.clientX === 'number' && typeof arg.clientY === 'number') {
      const { clientX: x, clientY: y } = arg;
      const near =
        x > (trashRect.left - 50) && x < (trashRect.right + 50) &&
        y > (trashRect.top  - 50) && y < (trashRect.bottom + 50);
      return near ? enlargeTrash() : resetTrashSize();
    }

    // Fallback: use the dragged element's rect
    if (arg && typeof arg.getBoundingClientRect === 'function') {
      const r = arg.getBoundingClientRect();
      const near =
        r.right  > trashRect.left - 50 &&
        r.left   < trashRect.right + 50 &&
        r.bottom > trashRect.top  - 50 &&
        r.top    < trashRect.bottom + 50;
      return near ? enlargeTrash() : resetTrashSize();
    }
  }

  /**
   * Add a folder element to the trash (idempotent).
   * - Hides the actual node
   * - Marks it as 'in-trash'
   * - Updates dock icon
   * - Emits "trash-changed" for live UIs (Trash window) to rebuild
   */
function addToTrash(folderEl) {
  if (!folderEl) return;

  folderEl.style.display = 'none';
  folderEl.classList.add('in-trash');

  if (!window.trashedFolders.includes(folderEl)) {
    window.trashedFolders.push(folderEl);
  }

  if (typeof window.setTrashIconByState === 'function') {
    window.setTrashIconByState();
  }

  // ensure visual reset
  if (typeof window.resetTrashSize === 'function') {
    window.resetTrashSize();
  }

  // 🔔 notify others (Trash window will listen)
  window.dispatchEvent(new CustomEvent('trash-changed'));
}

  /* ---------------------------------------------------------------- */
  /* Global listeners                                                  */
  /* ---------------------------------------------------------------- */

  // Mouseup anywhere: reset visual enlargement state
  document.addEventListener('mouseup', () => {
    resetTrashSize();
  });

  // Initialize dock icon correctly on load
  setTrashIconByState();

  /* ---------------------------------------------------------------- */
  /* Export API on window                                              */
  /* ---------------------------------------------------------------- */
  window.setTrashIconByState = setTrashIconByState;
  window.enlargeTrash = enlargeTrash;
  window.resetTrashSize = resetTrashSize;
  window.checkTrashProximity = checkTrashProximity;
  window.addToTrash = addToTrash;

  // --- Allow dropping folders directly into the Trash window ---
const trashWindow = document.getElementById('trash-window');

if (trashWindow) {
  const trashContent = trashWindow.querySelector('.window-content');

  // Allow drag-over events
  trashContent.addEventListener('dragover', (e) => {
    e.preventDefault(); // enable drop
  });

  // Handle folder drop inside trash window
  trashContent.addEventListener('mouseup', (e) => {
    // Find the folder currently being dragged
    if (typeof window.draggedFolder !== 'undefined' && window.draggedFolder) {
      const folder = window.draggedFolder;

      // Prevent double-adding
      if (!folder.classList.contains('in-trash')) {
        if (typeof window.addToTrash === 'function') {
          window.addToTrash(folder);
        }

        // Live-refresh if window is open
        if (trashWindow.style.display !== 'none' && typeof window.buildTrashWindowContents === 'function') {
          window.buildTrashWindowContents();
        }
      }
    }
  });
}
}


