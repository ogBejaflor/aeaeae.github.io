// assets/js/physics.js
(function () {
  // -------- config --------
  let GRAVITY = 2600;        // px/s^2  (mutable via setGravity)
  const DRAG = 0.96;         // velocity damping each frame
  const RESTITUTION = 0.28;  // bounciness
  const FRICTION = 0.86;     // along-floor friction
  const MAX_DT = 1 / 50;     // clamp dt to keep sim stable
  const THROW_VEL_CAP = 2500;// max injected velocity from a throw

  const SELECTOR_ICON = '.folder';
  const SELECTOR_WINDOW = '.window';
  const SELECTOR_NOTIFY = '.ae-notify-card'; // NEW: notifications

  // Globals
  let running = false;
  let rafId = null;
  let lastT = 0;

  const desktop = document.getElementById('desktop');
  if (!desktop) {
    console.warn('[physics] #desktop not found; physics disabled.');
    return;
  }

  // Bodies live in maps keyed by element
  const bodies = new Map(); // element -> body

  // Track pointer for "throw"
  let dragBody = null;
  let dragInfo = null; // {offsetX,offsetY,history:[{x,y,t}]}

  // Utility: time now (s)
  const nowS = () => performance.now() / 1000;

  // Bounds helpers
  function getBoundsForContainer(containerEl) {
    // Special case: notifications use viewport bounds
    if (containerEl === window) {
      return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    }
    const r = containerEl.getBoundingClientRect();
    return { x: 0, y: 0, w: r.width, h: r.height };
  }

  function elSize(el) {
    return { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
  }

  // Make sure element is positioned in its container.
  // For notifications we want fixed (viewport-relative).
  function absolutize(el, { fixed = false } = {}) {
    const parent = el.parentElement;
    if (!parent) return;

    if (fixed) {
      // Snapshot current screen position then switch to fixed/left/top
      const r = el.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.left = r.left + 'px';
      el.style.top  = r.top  + 'px';
      el.style.transform = 'none'; // disable layout translate so physics owns it
      return;
    }

    const cs = getComputedStyle(el);
    const pcs = getComputedStyle(parent);
    if (pcs.position === 'static') parent.style.position = 'relative';

    if (cs.position !== 'absolute') {
      const pr = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      el.style.position = 'absolute';
      el.style.left = (r.left - pr.left + (parent.scrollLeft || 0)) + 'px';
      el.style.top  = (r.top  - pr.top  + (parent.scrollTop  || 0)) + 'px';
    }
  }

  // Body creation
  // opts: { type: 'icon' | 'window' | 'notify' }
  function createBody(el, containerEl, opts = {}) {
    if (opts.type === 'notify') {
      // For notifications we position fixed and use viewport bounds (container = window)
      absolutize(el, { fixed: true });
    } else {
      absolutize(el);
    }

    const { w, h } = elSize(el);
    const px = parseFloat(el.style.left || '0');
    const py = parseFloat(el.style.top  || '0');

    const b = {
      el,
      container: opts.type === 'notify' ? window : containerEl,
      x: px, y: py,
      w, h,
      vx: 0, vy: 0,
      ax: 0, ay: 0,
      dynamic: true,
      type: opts.type || 'icon', // 'icon' | 'window' | 'notify'
    };
    bodies.set(el, b);
    return b;
  }

  function removeBody(el) {
    bodies.delete(el);
  }

  // Collision: simple AABB resolve (separation + naive impulse)
  function resolveAABB(a, b) {
    // Only collide if same "container" identity (viewport vs desktop vs window-content)
    if (a.container !== b.container) return;

    const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w, by2 = b.y + b.h;

    if (ax2 <= bx1 || ax1 >= bx2 || ay2 <= by1 || ay1 >= by2) return; // no overlap

    const oX1 = ax2 - bx1;
    const oX2 = bx2 - ax1;
    const oY1 = ay2 - by1;
    const oY2 = by2 - ay1;

    const minX = Math.min(oX1, oX2);
    const minY = Math.min(oY1, oY2);

    if (minX < minY) {
      const sign = (oX1 < oX2) ? -1 : 1;
      const sep = minX * sign * 0.5;
      a.x += sep;
      b.x -= sep;

      const vax = a.vx, vbx = b.vx;
      a.vx = vbx * RESTITUTION;
      b.vx = vax * RESTITUTION;
    } else {
      const sign = (oY1 < oY2) ? -1 : 1;
      const sep = minY * sign * 0.5;
      a.y += sep;
      b.y -= sep;

      const vay = a.vy, vby = b.vy;
      a.vy = vby * RESTITUTION;
      b.vy = vay * RESTITUTION;

      a.vx *= FRICTION;
      b.vx *= FRICTION;
    }
  }

  // Constrain to container bounds
  function constrainToBounds(b) {
    const bounds = getBoundsForContainer(b.container);

    // Bottom
    if (b.y + b.h > bounds.h) {
      b.y = bounds.h - b.h;
      if (b.vy > 0) b.vy = -b.vy * RESTITUTION;
      b.vx *= FRICTION;
    }
    // Top
    if (b.y < 0) {
      b.y = 0;
      if (b.vy < 0) b.vy = -b.vy * RESTITUTION;
    }
    // Right
    if (b.x + b.w > bounds.w) {
      b.x = bounds.w - b.w;
      if (b.vx > 0) b.vx = -b.vx * RESTITUTION;
      b.vy *= FRICTION;
    }
    // Left
    if (b.x < 0) {
      b.x = 0;
      if (b.vx < 0) b.vx = -b.vx * RESTITUTION;
      b.vy *= FRICTION;
    }
  }

  // Integrate
  function step(dt) {
    const clamped = Math.min(dt, MAX_DT);

    bodies.forEach(b => {
      if (!b.dynamic) return;

      // gravity (only vertical)
      b.ay = GRAVITY;

      // integrate velocity
      b.vx += b.ax * clamped;
      b.vy += b.ay * clamped;

      // integrate position
      b.x += b.vx * clamped;
      b.y += b.vy * clamped;

      // damping
      b.vx *= DRAG;
      b.vy *= DRAG;

      // bounds
      constrainToBounds(b);
    });

    // collisions (folders collide with everything, windows don't hit each other)
    const arr = Array.from(bodies.values());
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const A = arr[i];
        const B = arr[j];

        // Skip window–window collisions
        if (A.type === 'window' && B.type === 'window') continue;

        resolveAABB(A, B);
      }
    }

    // write positions to DOM
    bodies.forEach(b => {
      // For notifications we keep position:fixed; others are absolute within their containers
      b.el.style.left = `${b.x}px`;
      b.el.style.top  = `${b.y}px`;
    });
  }

  function loop(t) {
    if (!running) return;
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    step(dt);
    rafId = requestAnimationFrame(loop);
  }

  // Drag & throw (physics-mode takes over)
  function onPointerDown(e) {
    if (!running) return;

    const target = e.target.closest(`${SELECTOR_WINDOW},${SELECTOR_ICON},${SELECTOR_NOTIFY}`);
    if (!target) return;

    const b = bodies.get(target);
    if (!b) return;

    dragBody = b;
    dragBody.vx = 0;
    dragBody.vy = 0;

    // Container space: viewport for notify, else element's parent
    const rect = (b.container === window)
      ? { left: 0, top: 0 }
      : b.container.getBoundingClientRect();

    const ox = (e.clientX - rect.left);
    const oy = (e.clientY - rect.top);

    dragInfo = {
      offsetX: ox - b.x,
      offsetY: oy - b.y,
      history: []
    };

    // bring windows to front when grabbed
    if (b.type === 'window' && typeof window.bringToFront === 'function') {
      window.bringToFront(b.el);
    }

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!running || !dragBody || !dragInfo) return;

    // Container space: viewport for notify, else element's parent
    const rect = (dragBody.container === window)
      ? { left: 0, top: 0 }
      : dragBody.container.getBoundingClientRect();

    const x = (e.clientX - rect.left) - dragInfo.offsetX;
    const y = (e.clientY - rect.top)  - dragInfo.offsetY;

    dragBody.x = x;
    dragBody.y = y;

    // keep within bounds while dragging
    constrainToBounds(dragBody);

    // track recent positions for velocity injection
    const t = nowS();
    dragInfo.history.push({ x: dragBody.x, y: dragBody.y, t });
    if (dragInfo.history.length > 5) dragInfo.history.shift();
  }

  function onPointerUp() {
    if (!running || !dragBody || !dragInfo) {
      cleanupPointer();
      return;
    }
    // compute throw velocity from last positions
    const h = dragInfo.history;
    if (h.length >= 2) {
      const a = h[h.length - 2];
      const b = h[h.length - 1];
      const dt = Math.max(1e-3, b.t - a.t);
      let vx = (b.x - a.x) / dt;
      let vy = (b.y - a.y) / dt;

      // cap
      const mag = Math.hypot(vx, vy);
      if (mag > THROW_VEL_CAP) {
        const k = THROW_VEL_CAP / mag;
        vx *= k; vy *= k;
      }
      dragBody.vx = vx;
      dragBody.vy = vy;
    }
    cleanupPointer();
  }

  function cleanupPointer() {
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    dragBody = null;
    dragInfo = null;
  }

  // ---------- Public helpers for terminal ----------
  function setGravity(val) {
    const g = Number(val);
    if (!isFinite(g)) return;
    GRAVITY = g;
  }

  // Radial impulse from desktop center (or custom point)
  function impulseAll({ power = 1200, x, y } = {}) {
    // Use viewport center for notify bodies if container === window
    const rect = desktop.getBoundingClientRect();
    const cx = (typeof x === 'number') ? x : rect.width / 2;
    const cy = (typeof y === 'number') ? y : rect.height / 2;

    bodies.forEach(b => {
      // direction from center to body center
      const bx = b.x + b.w / 2;
      const by = b.y + b.h / 2;
      let dx = bx - cx;
      let dy = by - cy;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const k = power;
      b.vx += dx * k;
      b.vy += dy * k;
    });
  }

  // Give everything an upward kick
  function hopAll({ vy = -1200 } = {}) {
    bodies.forEach(b => {
      b.vy = vy;
    });
  }

  // ---------- helpers: notifications ----------
  function ensureNotifyBodies() {
    document.querySelectorAll(SELECTOR_NOTIFY).forEach(el => {
      if (!bodies.has(el)) createBody(el, window, { type: 'notify' });
    });
  }

  // MutationObserver to catch NEW notifications being added while physics is on
  const notifyObs = new MutationObserver(muts => {
    if (!running) return;
    muts.forEach(m => {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches && node.matches(SELECTOR_NOTIFY)) {
          createBody(node, window, { type: 'notify' });
        }
        // Also catch wrapped adds
        node.querySelectorAll?.(SELECTOR_NOTIFY).forEach(el => {
          if (!bodies.has(el)) createBody(el, window, { type: 'notify' });
        });
      });
    });
  });

  // ---------- Public API ----------
  function enable() {
    if (running) return;
    window.PHYSICS_ON = true;

    // Register desktop windows (visible only)
    document.querySelectorAll(SELECTOR_WINDOW).forEach(win => {
      if (win.style.display === 'none') return;
      if (!bodies.has(win)) createBody(win, desktop, { type: 'window' });
    });

    // Register desktop icons
    desktop.querySelectorAll(':scope > ' + SELECTOR_ICON).forEach(icon => {
      if (!bodies.has(icon)) createBody(icon, desktop, { type: 'icon' });
    });

    // Register icons inside each visible window (fall within window-content)
    document.querySelectorAll(SELECTOR_WINDOW).forEach(win => {
      if (win.style.display === 'none') return;
      const content = win.querySelector('.window-content');
      if (!content) return;
      content.querySelectorAll(SELECTOR_ICON).forEach(icon => {
        if (!bodies.has(icon)) createBody(icon, content, { type: 'icon' });
      });
    });

    // Register existing notifications (viewport bodies)
    ensureNotifyBodies();

    // Pointer hooks
    document.addEventListener('mousedown', onPointerDown, true);

    // Listen for UI lifecycle events to keep bodies in sync
    window.addEventListener('physics-ensure-window', onEnsureWindow);
    window.addEventListener('physics-remove-window', onRemoveWindow);
    window.addEventListener('physics-ensure-scope', onEnsureScope);
    window.addEventListener('physics-remove-icon', onRemoveIcon);

    // Also watch display toggles to auto-add/remove windows
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });

    // Watch for notifications being added dynamically
    notifyObs.observe(document.body, { childList: true, subtree: true });

    // Kick the loop
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(loop);

    // Let other scripts know
    window.dispatchEvent(new CustomEvent('physics-mode-changed', { detail: { on: true } }));
  }

  function disable() {
    if (!running) return;
    running = false;
    window.PHYSICS_ON = false;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    document.removeEventListener('mousedown', onPointerDown, true);
    window.removeEventListener('physics-ensure-window', onEnsureWindow);
    window.removeEventListener('physics-remove-window', onRemoveWindow);
    window.removeEventListener('physics-ensure-scope', onEnsureScope);
    window.removeEventListener('physics-remove-icon', onRemoveIcon);
    obs.disconnect();
    notifyObs.disconnect();

    bodies.clear();

    window.dispatchEvent(new CustomEvent('physics-mode-changed', { detail: { on: false } }));
  }

  function toggle() {
    if (running) disable(); else enable();
  }

  // Lifecycle event handlers (called from your windowControls & others)
  function onEnsureWindow(e) {
    const win = e.detail?.el;
    if (!win || !(win instanceof HTMLElement)) return;
    if (win.style.display === 'none') return;
    if (!bodies.has(win)) createBody(win, desktop, { type: 'window' });

    const content = win.querySelector('.window-content');
    if (content) {
      content.querySelectorAll(SELECTOR_ICON).forEach(icon => {
        if (!bodies.has(icon)) createBody(icon, content, { type: 'icon' });
      });
    }
  }

  function onRemoveWindow(e) {
    const win = e.detail?.el;
    if (!win || !(win instanceof HTMLElement)) return;
    removeBody(win);
  }

  function onEnsureScope(e) {
    const content = e.detail?.el;
    if (!content || !(content instanceof HTMLElement)) return;
    content.querySelectorAll(SELECTOR_ICON).forEach(icon => {
      if (!bodies.has(icon)) createBody(icon, content, { type: 'icon' });
    });
  }

  function onRemoveIcon(e) {
    const icon = e.detail?.el;
    if (!icon || !(icon instanceof HTMLElement)) return;
    removeBody(icon);
  }

  // MutationObserver: if a window’s display toggles, add/remove body
  const obs = new MutationObserver(muts => {
    muts.forEach(m => {
      const el = m.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList || !el.classList.contains('window')) return;

      const vis = el.style.display !== 'none';
      const has = bodies.has(el);

      if (running) {
        if (vis && !has) {
          createBody(el, desktop, { type: 'window' });
        } else if (!vis && has) {
          removeBody(el);
        }
      }
    });
  });

  // Expose API
  window.physics = {
    enable,
    disable,
    toggle,
    setGravity,
    impulseAll,
    hopAll
  };

  // Optional: respond to terminal commands if you added them
  window.addEventListener('terminal-physics', (e) => {
    const on = !!e.detail?.on;
    if (on) enable(); else disable();
  });
})();
