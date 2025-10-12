// assets/js/windowControls.js

// ---------------- Minimize ----------------
document.querySelectorAll('.minimize-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    const windowId = windowElement.id;

    const doMinimize = () => minimizeWindow(windowElement, windowId);

    if (document.fullscreenElement) {
      document.exitFullscreen().then(doMinimize).catch(err => {
        console.error("Error exiting fullscreen:", err);
        doMinimize();
      });
    } else {
      doMinimize();
    }
  });
});

// ---------------- Open folder on double-click ----------------
document.querySelectorAll('.folder').forEach(folder => {
  folder.addEventListener('dblclick', function () {
    openFolder(folder);
  });
});

function openFolder(folder) {
  const windowId = folder.getAttribute('data-window');
  const windowElement = document.getElementById(windowId);
  const minimizedWindow = document.querySelector(`.minimized-window[data-window="${windowId}"]`);

  if (minimizedWindow) {
    minimizedWindow.remove();
    restoreMinimizedWindow(minimizedWindow, windowElement);
  } else if (windowElement) {
    windowElement.style.display = 'block';
    windowElement.style.zIndex = '1001';
  }
}

// ---------------- Minimize / Restore helpers ----------------
function minimizeWindow(windowElement, windowId) {
  windowElement.classList.add('minimizing');

  // Use trash (rightmost) as anchor if available
  const anchor = window.trash || document.querySelector('.dock-item[data-window="trash-window"]');
  const targetRect = anchor ? anchor.getBoundingClientRect() : document.getElementById('dock').getBoundingClientRect();

  const windowRect = windowElement.getBoundingClientRect();
  const translateX = targetRect.left - windowRect.left;
  const translateY = targetRect.top  - windowRect.top;

  windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;

  setTimeout(() => {
    windowElement.style.display = 'none';
    windowElement.classList.remove('minimizing');
    addMinimizedWindowToDock(windowId);
  }, 500);
}

function addMinimizedWindowToDock(windowId) {
  const dock = document.getElementById('dock');

  if (!document.querySelector(`.minimized-window[data-window="${windowId}"]`)) {
    const minimizedWindow = document.createElement('div');
    minimizedWindow.classList.add('dock-item', 'minimized-window');
    minimizedWindow.setAttribute('data-window', windowId);
    minimizedWindow.innerHTML = `<img src="assets/icons/minimized-window-icon.png" alt="Minimized Window" />`;

    dock.insertBefore(minimizedWindow, dock.firstChild);

    minimizedWindow.addEventListener('click', function () {
      restoreMinimizedWindow(this, document.getElementById(windowId));
    });
  }
}

function restoreMinimizedWindow(minimizedWindow, windowElement) {
  const anchor = window.trash || document.querySelector('.dock-item[data-window="trash-window"]');
  const targetRect = anchor ? anchor.getBoundingClientRect() : document.getElementById('dock').getBoundingClientRect();
  const windowRect = windowElement.getBoundingClientRect();

  windowElement.style.display = 'block';
  const translateX = targetRect.left - windowRect.left;
  const translateY = targetRect.top  - windowRect.top;

  windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;
  windowElement.style.opacity = '0';

  // Force reflow
  void windowElement.offsetHeight;

  windowElement.classList.add('restoring');
  windowElement.style.transform = 'translate(0, 0) scale(1, 1)';
  windowElement.style.opacity = '1';

  if (minimizedWindow) minimizedWindow.remove();

  setTimeout(() => {
    windowElement.classList.remove('restoring');
  }, 500);
}

// ---------------- Close ----------------
document.querySelectorAll('.close-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => windowElement.style.display = 'none');
    } else {
      windowElement.style.display = 'none';
    }
  });
});

// ---------------- Fullscreen ----------------
document.querySelectorAll('.fullscreen-button').forEach(button => {
  button.addEventListener('click', function () {
    const windowElement = this.closest('.window');
    if (document.fullscreenEnabled) {
      if (!document.fullscreenElement) {
        windowElement.requestFullscreen().catch(() => {
          alert('Fullscreen request was blocked by the browser.');
        });
      } else {
        document.exitFullscreen();
      }
    } else {
      alert('Fullscreen mode is not supported by your browser.');
    }
  });
});

/* ---------------- Trash window open & live refresh ---------------- */

(function attachTrashClick() {
  const t = window.trash || document.querySelector('.dock-item[data-window="trash-window"]');
  if (!t) return;
  // Keep opening on each click
  t.addEventListener('click', openTrashWindow);
})();

function openTrashWindow() {
  const trashWindow = document.getElementById('trash-window');
  if (!trashWindow) return;

  renderTrashWindow();
  trashWindow.style.display = 'block';
  trashWindow.style.zIndex = '1001';
}

// Re-render the Trash window contents from window.trashedFolders
function renderTrashWindow() {
  const trashWindow = document.getElementById('trash-window');
  if (!trashWindow) return;
  const trashContent = trashWindow.querySelector('.window-content');
  if (!trashContent) return;

  trashContent.innerHTML = '';

  const trashed = (window.trashedFolders || []).filter(
    el => el && el.classList && el.classList.contains('in-trash')
  );

  if (trashed.length === 0) {
    trashContent.innerHTML = '<p>The trash is empty.</p>';
    return;
  }

  // Simple grid
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, 100px)';
  grid.style.gap = '12px';

  trashed.forEach((folderEl, idx) => {
    // Clone just for display
    const card = document.createElement('div');
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.gap = '6px';

    const icon = document.createElement('img');
    const originalImg = folderEl.querySelector('img');
    icon.src = originalImg ? originalImg.src : 'assets/icons/folder-icon.png';
    icon.alt = 'Trashed item';
    icon.style.width = '64px';
    icon.style.height = '64px';
    icon.style.objectFit = 'contain';

    const label = document.createElement('div');
    const originalLabel = folderEl.querySelector('.folder-label');
    label.textContent = originalLabel ? originalLabel.textContent : `Item ${idx + 1}`;
    label.style.fontSize = '12px';
    label.style.textAlign = 'center';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restore';
    restoreBtn.style.fontSize = '11px';
    restoreBtn.style.padding = '4px 6px';
    restoreBtn.style.cursor = 'pointer';

    // (Optional) Delete permanently button
    // const deleteBtn = document.createElement('button');
    // deleteBtn.textContent = 'Delete';
    // deleteBtn.style.fontSize = '11px';
    // deleteBtn.style.padding = '4px 6px';
    // deleteBtn.style.cursor = 'pointer';

    // Restore behavior: make the original visible again on the desktop
    restoreBtn.addEventListener('click', () => {
    try {
        const desktop = document.getElementById('desktop');

        // Ensure it’s on the desktop
        if (desktop && folderEl.parentElement !== desktop) {
        desktop.appendChild(folderEl);
        }

        // Show it and remove trash state
        folderEl.style.display = '';
        folderEl.classList.remove('in-trash');

        // Center it on the desktop
        const dRect = desktop.getBoundingClientRect();
        // Measure the folder (fallback to 100x100-ish if hidden/small)
        const fw = folderEl.offsetWidth || 100;
        const fh = folderEl.offsetHeight || 110;

        // Absolutely position it within the desktop
        folderEl.style.position = 'absolute';
        folderEl.style.left = `${(dRect.width - fw) / 2}px`;
        folderEl.style.top  = `${(dRect.height - fh) / 2}px`;
        folderEl.style.zIndex = '1000';

        // Update trash icon + refresh list
        if (typeof window.setTrashIconByState === 'function') window.setTrashIconByState();
        window.dispatchEvent(new CustomEvent('trash:updated'));
        renderTrashWindow();
    } catch (err) {
        console.error('Restore failed:', err);
    }
    });


    // deleteBtn.addEventListener('click', () => {
    //   // Permanently remove reference (if you want this UX)
    //   folderEl.remove(); // remove from DOM
    //   window.trashedFolders = window.trashedFolders.filter(n => n !== folderEl);
    //   if (typeof window.setTrashIconByState === 'function') window.setTrashIconByState();
    //   window.dispatchEvent(new CustomEvent('trash:updated'));
    //   renderTrashWindow();
    // });

    actions.appendChild(restoreBtn);
    // actions.appendChild(deleteBtn);

    card.appendChild(icon);
    card.appendChild(label);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  trashContent.appendChild(grid);
}

// Live refresh the list if the Trash is open
window.addEventListener('trash:updated', () => {
  const tw = document.getElementById('trash-window');
  if (tw && tw.style.display !== 'none') {
    renderTrashWindow();
  }
});
