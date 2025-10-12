// assets/js/trashBehavior.js

// Global store shared across files
window.trashedFolders = window.trashedFolders || [];

/* -------------------- Safely get dock trash elements -------------------- */
const trashDockItem = document.querySelector('.dock-item[data-window="trash-window"]');

// Expose globals even if missing so other files don't crash
window.trash = trashDockItem || null;
window.trashIcon = trashDockItem ? trashDockItem.querySelector('img') : null;

if (!window.trash || !window.trashIcon) {
  console.warn('Trash dock item not found. trashBehavior.js will no-op.');
  // Safe no-ops
  window.checkTrashProximity = () => {};
  window.addToTrash = () => {};
  window.setTrashIconByState = () => {};
  window.resetTrashSize = () => {};
  window.enlargeTrash = () => {};
} else {
  const emptyIconSrc = 'assets/icons/trash-icon.png';
  const fullIconSrc  = 'assets/icons/trash-icon-full.png';

  /* -------------------- Helpers -------------------- */

  function setTrashIconByState() {
    const hasItems = (window.trashedFolders || []).some(
      el => el && el.classList && el.classList.contains('in-trash')
    );
    window.trashIcon.src = hasItems ? fullIconSrc : emptyIconSrc;
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
    if (!window.trash || !window.trashIcon) return;

    const trashRect = window.trash.getBoundingClientRect();

    // If we got a mouse event, use pointer location
    if (arg && typeof arg.clientX === 'number' && typeof arg.clientY === 'number') {
      const { clientX: x, clientY: y } = arg;
      const near =
        x > (trashRect.left - 50) && x < (trashRect.right + 50) &&
        y > (trashRect.top  - 50) && y < (trashRect.bottom + 50);
      return near ? enlargeTrash() : resetTrashSize();
    }

    // Fallback: element-based (older call sites)
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
   * Hides the real node, marks it in-trash, updates icon, and notifies listeners.
   */
  function addToTrash(folderEl) {
    if (!folderEl) return;

    folderEl.style.display = 'none';
    folderEl.classList.add('in-trash');

    if (!window.trashedFolders.includes(folderEl)) {
      window.trashedFolders.push(folderEl);
    }

    setTrashIconByState();
    resetTrashSize();

    // 🔔 tell others (e.g., Trash window) to refresh
    window.dispatchEvent(new CustomEvent('trash:updated'));
  }

  /* -------------------- Global Event Wiring -------------------- */

  // Mouseup: ensure enlargement resets visually
  document.addEventListener('mouseup', function () {
    resetTrashSize();
  });

  // Initial icon state
  setTrashIconByState();

  /* -------------------- Expose API -------------------- */
  window.checkTrashProximity = checkTrashProximity;
  window.addToTrash = addToTrash;
  window.setTrashIconByState = setTrashIconByState;
  window.resetTrashSize = resetTrashSize;
  window.enlargeTrash = enlargeTrash;
}
