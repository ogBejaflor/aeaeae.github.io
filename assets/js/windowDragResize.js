// assets/js/windowDragResize.js
(() => {
  let dragging = null;     // { win, offX, offY }
  let resizing = null;     // { win, startX, startY, startW, startH }
  const MIN_W = 360;
  const MIN_H = 220;

  const desktop = document.getElementById('desktop');

  // ------- utils -------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function dockHeight() {
    const dock = document.getElementById('dock-wrapper');
    if (!dock) return 0;
    const r = dock.getBoundingClientRect();
    // If dock is hidden (slide-down), give it a nominal margin so windows don't clip
    const visible = dock.classList.contains('show');
    return visible ? r.height : 0;
  }

  function viewportBounds(winEl) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dh = dockHeight();
    // keep a little margin so the header stays reachable
    const margin = 8;
    const h = winEl.getBoundingClientRect().height || 400;
    const w = winEl.getBoundingClientRect().width || 600;
    return {
      minX: margin,
      minY: margin, // your top bar is ~30px, but windows have header; margin works fine
      maxX: vw - margin - w,
      maxY: vh - margin - dh - Math.min(h, vh) + (h - Math.min(h, vh)) + (winEl.offsetTop || 0) // compute below with current size
    };
  }

  function bringFront(win) {
    if (typeof window.bringToFront === 'function') {
      window.bringToFront(win);
    } else {
      // fallback
      const z = (parseInt(win.style.zIndex || '1000', 10) || 1000) + 1;
      win.style.zIndex = String(z);
    }
  }

  function canDrag() {
    // If full physics is on, let physics engine own dragging
    return !window.PHYSICS_ON;
  }

  // ------- dragging -------
  function onHeaderPointerDown(e) {
    if (e.button !== 0) return;
    if (!canDrag()) return;

    const header = e.currentTarget;
    const win = header.closest('.window');
    // ignore clicks on window controls
    if (e.target.closest('.window-controls')) return;

    // ensure positioned
    const cs = getComputedStyle(win);
    if (cs.position !== 'absolute') {
      const r = win.getBoundingClientRect();
      win.style.position = 'absolute';
      win.style.left = `${r.left}px`;
      win.style.top  = `${r.top}px`;
    }

    const r = win.getBoundingClientRect();
    dragging = {
      win,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
    };

    // focus / z-index
    bringFront(win);

    win.classList.add('dragging');
    document.body.classList.add('no-text-select');

    // pointer capture so we don't lose drag
    header.setPointerCapture?.(e.pointerId);
  }

  function onHeaderPointerMove(e) {
    if (!dragging) return;

    const win = dragging.win;
    // position before clamping
    let left = e.clientX - dragging.offX;
    let top  = e.clientY - dragging.offY;

    // clamp to viewport (respect dock)
    const vw = window.innerWidth;
    const vh = window.innerHeight - dockHeight();
    const rect = win.getBoundingClientRect();
    const margin = 8;

    const maxLeft = vw - margin - rect.width;
    const maxTop  = vh - margin - Math.min(rect.height, vh) + (rect.height - Math.min(rect.height, vh)) + margin;

    left = clamp(left, margin, Math.max(margin, maxLeft));
    top  = clamp(top, margin, Math.max(margin, maxTop));

    win.style.left = `${left}px`;
    win.style.top  = `${top}px`;
  }

  function onHeaderPointerUp(e) {
    if (!dragging) return;
    dragging.win.classList.remove('dragging');
    document.body.classList.remove('no-text-select');
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
    dragging = null;
  }

  // ------- resizing -------
  function onResizerPointerDown(e) {
    if (e.button !== 0) return;

    const resizer = e.currentTarget;
    const win = resizer.closest('.window');
    const r = win.getBoundingClientRect();

    resizing = {
      win,
      startX: e.clientX,
      startY: e.clientY,
      startW: r.width,
      startH: r.height
    };

    bringFront(win);
    win.classList.add('dragging');
    document.body.classList.add('no-text-select');

    resizer.setPointerCapture?.(e.pointerId);
  }

  function onResizerPointerMove(e) {
    if (!resizing) return;

    const { win, startX, startY, startW, startH } = resizing;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // proposed size
    let w = Math.max(MIN_W, startW + dx);
    let h = Math.max(MIN_H, startH + dy);

    // clamp to viewport minus dock
    const vw = window.innerWidth;
    const vh = window.innerHeight - dockHeight();
    const winRect = win.getBoundingClientRect();
    const left = parseFloat(win.style.left || winRect.left);
    const top  = parseFloat(win.style.top  || winRect.top);

    w = Math.min(w, vw - left - 8);
    h = Math.min(h, vh - top  - 8);

    win.style.width  = `${w}px`;
    win.style.height = `${h}px`;
  }

  function onResizerPointerUp(e) {
    if (!resizing) return;
    resizing.win.classList.remove('dragging');
    document.body.classList.remove('no-text-select');
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
    resizing = null;
  }

  // ------- init -------
  function initWindow(win) {
    const header = win.querySelector('.window-header');
    if (header && !header.__dragBound) {
      header.addEventListener('pointerdown', onHeaderPointerDown);
      header.addEventListener('pointermove', onHeaderPointerMove);
      header.addEventListener('pointerup', onHeaderPointerUp);
      header.__dragBound = true;
    }

    // ensure a single resizer exists
    let resizer = win.querySelector('.resizer');
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'resizer';
      win.appendChild(resizer);
    }
    if (!resizer.__resizeBound) {
      resizer.addEventListener('pointerdown', onResizerPointerDown);
      resizer.addEventListener('pointermove', onResizerPointerMove);
      resizer.addEventListener('pointerup', onResizerPointerUp);
      resizer.__resizeBound = true;
    }
  }

  function initAll() {
    document.querySelectorAll('.window').forEach(initWindow);
  }

  // If windows can be added dynamically, expose a helper
  window.initWindowDragResize = initWindow;

  // Re-clamp windows on viewport resize so nothing ends up off-screen
  window.addEventListener('resize', () => {
    document.querySelectorAll('.window').forEach(win => {
      if (win.style.display === 'none') return;
      const r = win.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight - dockHeight();
      const margin = 8;
      const left = clamp(r.left, margin, Math.max(margin, vw - margin - r.width));
      const top  = clamp(r.top,  margin, Math.max(margin, vh - margin - Math.min(r.height, vh) + (r.height - Math.min(r.height, vh)) + margin));
      win.style.left = `${left}px`;
      win.style.top  = `${top}px`;
    });
  });

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll, { once: true });
  } else {
    initAll();
  }
})();
