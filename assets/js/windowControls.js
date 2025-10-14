// assets/js/windowControls.js

/* ---------------- Z-index & Staggering ---------------- */
let zCounter = 2000;                   // ensure above desktop items
let staggerIndex = 0;
const STAGGER_STEP = 28;               // px offset between newly opened windows
const BASE_LEFT = 60;                  // starting left
const BASE_TOP  = 60;                  // starting top
const MAX_STAGGERS = 10;               // wrap the diagonal after N openings

function bringToFront(winEl) {
  zCounter += 1;
  winEl.style.zIndex = String(zCounter);
}

function nextStaggerPosition(winEl) {
  const step = STAGGER_STEP;
  let left = BASE_LEFT + step * staggerIndex;
  let top  = BASE_TOP  + step * staggerIndex;

  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  // best-effort window size (use current size or defaults)
  const rect = winEl.getBoundingClientRect();
  const w = rect.width  || 560;   // default width (match your CSS open size)
  const h = rect.height || 420;   // default height

  // Keep on-screen with some margins (account for top bar ~30px and dock ~80px)
  const marginRight = 40;
  const marginBottom = 140;

  if (left + w > vw - marginRight) left = BASE_LEFT;
  if (top + h > vh - marginBottom) top = BASE_TOP;

  // advance index for the next window
  staggerIndex = (staggerIndex + 1) % MAX_STAGGERS;

  return { left, top };
}

/* ---------------- Minimize / Restore / Open ---------------- */

// Minimize buttons
document.querySelectorAll('.minimize-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    const windowId = windowElement.id;

    // if currently fullscreen, exit first then minimize
    if (document.fullscreenElement) {
      document.exitFullscreen()
        .then(() => minimizeWindow(windowElement, windowId))
        .catch(err => console.error("Error exiting fullscreen:", err));
    } else {
      minimizeWindow(windowElement, windowId);
    }
  });
});

// Double-click any folder to open its window (or restore if minimized)
document.querySelectorAll('.folder').forEach(folder => {
  folder.addEventListener('dblclick', function () {
    openFolder(folder);
  });
});

// Open selected folder or restore minimized window
function openFolder(folder) {
  const windowId = folder.getAttribute('data-window');
  const windowElement = document.getElementById(windowId);
  const minimizedWindow = document.querySelector(`.minimized-window[data-window="${windowId}"]`);

  if (!windowElement) return;

  if (minimizedWindow) {
    minimizedWindow.remove();
    restoreMinimizedWindow(minimizedWindow, windowElement);
  } else {
    // First-time open (or re-opened after being closed)
    windowElement.style.display = 'block';

    // Stagger position ONLY if this window hasn't been positioned before
    if (!windowElement.dataset.positioned) {
      const { left, top } = nextStaggerPosition(windowElement);
      windowElement.style.left = `${left}px`;
      windowElement.style.top  = `${top}px`;
      windowElement.dataset.positioned = '1';
    }

    bringToFront(windowElement);
  }
}

function minimizeWindow(windowElement, windowId) {
  windowElement.classList.add('minimizing');

  // Use the trash dock item's position as the target for the genie-like animation
  const trashDockItem = document.querySelector('.dock-item[data-window="trash-window"]');
  const targetDockRect = trashDockItem
    ? trashDockItem.getBoundingClientRect()
    : document.getElementById('dock').getBoundingClientRect();

  const winRect = windowElement.getBoundingClientRect();
  const translateX = targetDockRect.left - winRect.left;
  const translateY = targetDockRect.top  - winRect.top;

  windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;

  setTimeout(() => {
    windowElement.style.display = 'none';
    windowElement.classList.remove('minimizing');
    addMinimizedWindowToDock(windowId);
  }, 500);
}

function addMinimizedWindowToDock(windowId) {
  const dock = document.getElementById('dock');
  if (!dock) return;

  // Avoid duplicates
  if (document.querySelector(`.minimized-window[data-window="${windowId}"]`)) return;

  const windowEl = document.getElementById(windowId);
  const titleText = windowEl?.querySelector('.window-title')?.textContent || 'Window';
  const iconEl = windowEl?.querySelector('.window-header img');
  const iconSrc = iconEl ? iconEl.src : 'assets/icons/folder-icon.png';

  // Create minimized folder-style icon
  const minimizedWindow = document.createElement('div');
  minimizedWindow.classList.add('dock-item', 'minimized-window');
  minimizedWindow.setAttribute('data-window', windowId);
  minimizedWindow.innerHTML = `
    <div class="minimized-folder">
      <img src="${iconSrc}" alt="${titleText}" />
      <div class="minimized-label">${titleText}</div>
    </div>
  `;

  // Insert to the RIGHT of Trash and other minimized windows
  const trashDockItem = dock.querySelector('.dock-item[data-window="trash-window"]');
  const minimizedItems = Array.from(dock.querySelectorAll('.minimized-window'));
  const lastMinimized = minimizedItems[minimizedItems.length - 1] || null;

  const insertAfter = (refEl, newEl) => {
    if (!refEl) dock.appendChild(newEl);
    else if (refEl.nextSibling) dock.insertBefore(newEl, refEl.nextSibling);
    else dock.appendChild(newEl);
  };

  if (lastMinimized) insertAfter(lastMinimized, minimizedWindow);
  else if (trashDockItem) insertAfter(trashDockItem, minimizedWindow);
  else dock.appendChild(minimizedWindow);

  // Click to restore
  minimizedWindow.addEventListener('click', function () {
    restoreMinimizedWindow(this, document.getElementById(windowId));
  });
}

function restoreMinimizedWindow(minimizedWindow, windowElement) {
  const trashDockItem = document.querySelector('.dock-item[data-window="trash-window"]');
  const dockRect = trashDockItem
    ? trashDockItem.getBoundingClientRect()
    : document.getElementById('dock').getBoundingClientRect();

  const winRect = windowElement.getBoundingClientRect();

  windowElement.style.display = 'block';
  const translateX = dockRect.left - winRect.left;
  const translateY = dockRect.top  - winRect.top;

  // start from dock position
  windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;
  windowElement.style.opacity = '0';

  // force reflow
  // eslint-disable-next-line no-unused-expressions
  windowElement.offsetHeight;

  windowElement.classList.add('restoring');
  windowElement.style.transform = 'translate(0, 0) scale(1, 1)';
  windowElement.style.opacity = '1';

  bringToFront(windowElement);
  if (minimizedWindow) minimizedWindow.remove();

  setTimeout(() => {
    windowElement.classList.remove('restoring');
  }, 500);
}

/* ---------------- Close / Fullscreen ---------------- */

document.querySelectorAll('.close-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => {
        windowElement.style.display = 'none';
      });
    } else {
      windowElement.style.display = 'none';
    }
  });
});

document.querySelectorAll('.fullscreen-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    if (document.fullscreenEnabled) {
      if (!document.fullscreenElement) {
        windowElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    } else {
      alert('Fullscreen mode is not supported by your browser.');
    }
  });
});

/* ---------------- Bring windows to front when interacted with ---------------- */
document.querySelectorAll('.window').forEach(win => {
  // Any mousedown on a window brings it forward
  win.addEventListener('mousedown', () => bringToFront(win));
});

/* ---------------- Trash window open (uses trashedFolders from trashBehavior.js) ---------------- */
// Find the first free "cell" from the top-right of the desktop and place the item there
function placeFolderTopRight(desktop, folder) {
  const dRect = desktop.getBoundingClientRect();

  // Cell sizing that feels like macOS icons (tweak if you want tighter/looser packing)
  const CELL_W = 120;   // icon + label width
  const CELL_H = 120;   // icon + label height
  const PAD_X  = 20;    // desktop padding from edges
  const PAD_Y  = 20;
  const BOTTOM_MARGIN = 140; // leave space for the dock if it pops up

  // Build a list of occupied cells by existing desktop folders (direct children)
  const occupied = [];
  Array.from(desktop.querySelectorAll('.folder'))
    .filter(el => el.parentElement === desktop && el.style.display !== 'none')
    .forEach(el => {
      const r = el.getBoundingClientRect();
      // convert to desktop-local coordinates
      const x = r.left - dRect.left;
      const y = r.top  - dRect.top;
      occupied.push({ x, y, w: el.offsetWidth || CELL_W, h: el.offsetHeight || CELL_H });
    });

  // Starting cell at the top-right
  let x = dRect.width - PAD_X - CELL_W; // local-left coordinate
  let y = PAD_Y;

  function collides(ax, ay) {
    const aw = CELL_W, ah = CELL_H;
    return occupied.some(({ x: bx, y: by, w: bw, h: bh }) =>
      ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
    );
  }

  // Scan down, then one column left, repeat (like Finder)
  while (true) {
    if (!collides(x, y)) break;

    y += CELL_H; // go down one row
    if (y + CELL_H > dRect.height - BOTTOM_MARGIN) {
      // new column to the left
      y = PAD_Y;
      x -= CELL_W;
      if (x < PAD_X) {
        // If we ever run out of columns, wrap back to top-right
        x = dRect.width - PAD_X - CELL_W;
      }
    }
  }

  // Apply absolute placement relative to desktop
  folder.style.position = 'absolute';
  folder.style.left = `${x}px`;
  folder.style.top  = `${y}px`;
}

// --- add in assets/js/windowControls.js (above openTrashWindow) ---
function buildTrashWindowContents() {
  const trashWindow = document.getElementById('trash-window');
  const trashContent = trashWindow.querySelector('.window-content');
  trashContent.innerHTML = '';

  const trashed = (window.trashedFolders || []).filter(Boolean);

  if (trashed.length === 0) {
    trashContent.innerHTML = '<p>The trash is empty.</p>';
    return;
  }

  trashed.forEach(folder => {
    const cloned = folder.cloneNode(true);
    cloned.style.display = 'flex';
    cloned.style.position = '';
    cloned.style.left = '';
    cloned.style.top = '';
    cloned.classList.remove('in-trash');

    const wrapper = document.createElement('div');
    wrapper.className = 'trash-item';
    wrapper.appendChild(cloned);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore-btn';
    restoreBtn.textContent = 'Restore';

    restoreBtn.addEventListener('click', () => {
      const desktop = document.getElementById('desktop');
      if (folder.parentElement !== desktop) desktop.appendChild(folder);
      folder.style.display = 'flex';
      folder.classList.remove('in-trash');

      // Place top-right without overlap
      if (typeof placeFolderTopRight === 'function') {
        placeFolderTopRight(desktop, folder);
      }

      // Remove from trashed list
      window.trashedFolders = (window.trashedFolders || []).filter(el => el !== folder);

      if (typeof window.setTrashIconByState === 'function') {
        window.setTrashIconByState();
      }

      // Remove UI block
      wrapper.remove();

      // If empty after removal, show message
      if (!trashContent.children.length) {
        trashContent.innerHTML = '<p>The trash is empty.</p>';
      }

      // Notify others (optional)
      window.dispatchEvent(new CustomEvent('trash-changed'));
    });

    wrapper.appendChild(restoreBtn);
    trashContent.appendChild(wrapper);

    // Live-refresh Trash window when items are added/removed
    window.addEventListener('trash-changed', () => {
    const trashWindow = document.getElementById('trash-window');
    if (trashWindow && trashWindow.style.display !== 'none') {
        buildTrashWindowContents();   // rebuild the list
        bringToFront(trashWindow);    // keep it on top if you’re interacting with it
    }
    });

  });
}

function openTrashWindow() {
  const trashWindow = document.getElementById('trash-window');

  // Build/refresh contents
  buildTrashWindowContents();

  // Show + bring to front
  trashWindow.style.display = 'block';
  bringToFront(trashWindow);

  // Stagger only once
  if (!trashWindow.dataset.positioned) {
    const { left, top } = nextStaggerPosition(trashWindow);
    trashWindow.style.left = `${left}px`;
    trashWindow.style.top  = `${top}px`;
    trashWindow.dataset.positioned = '1';
  }
}

// Click on the trash dock item (robust even if trashBehavior hasn't run yet)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.dock-item[data-window="trash-window"]');
  if (btn) {
    e.preventDefault();
    openTrashWindow();
  }
});

// Make these accessible to other scripts
window.openFolder = openFolder;
window.placeFolderTopRight = placeFolderTopRight;
