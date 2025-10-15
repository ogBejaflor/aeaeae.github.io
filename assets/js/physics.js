// assets/js/physics.js
(function () {
  // -------- config --------
  const GRAVITY = 2200;          // px/s^2
  const DRAG = 0.96;             // velocity damping each frame
  const RESTITUTION = 0.28;      // bounciness
  const FRICTION = 0.86;         // along-floor friction
  const MAX_DT = 1 / 50;         // clamp dt to keep sim stable
  const THROW_VEL_CAP = 2500;    // max injected velocity from a throw
  const SELECTOR_ICON = '.folder';
  const SELECTOR_WINDOW = '.window';

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
  let dragInfo = null; // {startX,startY,history:[{x,y,t}], lastX,lastY}

  // Utility: time now (s)
  const nowS = () => performance.now() / 1000;

  // Rect helpers
  function getBoundsForContainer(containerEl) {
    const r = containerEl.getBoundingClientRect();
    return { x: 0, y: 0, w: r.width, h: r.height };
  }

  function elSize(el) {
    return { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
  }

  // Make sure element is absolutely positioned in its container.
  function absolutize(el) {
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    if (!parent) return;

    // Ensure container is positioned
    const pcs = getComputedStyle(parent);
    if (pcs.position === 'static') parent.style.position = 'relative';

    // If not already absolute, snapshot current visual pos
    if (cs.position !== 'absolute') {
      const pr = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      el.style.position = 'absolute';
      el.style.left = (r.left - pr.left + (parent.scrollLeft || 0)) + 'px';
      el.style.top  = (r.top  - pr.top  + (parent.scrollTop  || 0)) + 'px';
    }
  }

  // Body creation
  function createBody(el, containerEl, opts = {}) {
    absolutize(el);

    const { w, h } = elSize(el);
    const px = parseFloat(el.style.left || '0');
    const py = parseFloat(el.style.top  || '0');

    const b = {
      el,
      container: containerEl,
      x: px, y: py,
      w, h,
      vx: 0, vy: 0,
      ax: 0, ay: 0,
      dynamic: true,
      type: opts.type || 'icon', // 'icon' | 'window'
      fixedBottom: false,        // not used now; could pin to bottom
    };
    bodies.set(el, b);
    return b;
  }

  function removeBody(el) {
    bodies.delete(el);
  }

  // Collision: simple AABB resolve (separation + naive impulse)
  function resolveAABB(a, b) {
    // Only collide if same container
    if (a.container !== b.container) return;

    const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w, by2 = b.y + b.h;

    if (ax2 <= bx1 || ax1 >= bx2 || ay2 <= by1 || ay1 >= by2) return; // no overlap

    // overlap distances
    const oX1 = ax2 - bx1; // push a left
    const oX2 = bx2 - ax1; // push a right
    const oY1 = ay2 - by1; // push a up
    const oY2 = by2 - ay1; // push a down

    // find smallest translation
    const minX = Math.min(oX1, oX2);
    const minY = Math.min(oY1, oY2);

    if (minX < minY) {
      // separate on X
      const sign = (oX1 < oX2) ? -1 : 1; // -1 => move a left, 1 => move a right
      const sep = minX * sign * 0.5;
      a.x += sep;
      b.x -= sep;

      // swap/reflect velocities on X
      const vax = a.vx, vbx = b.vx;
      a.vx = vbx * RESTITUTION;
      b.vx = vax * RESTITUTION;
    } else {
      // separate on Y
      const sign = (oY1 < oY2) ? -1 : 1; // -1 => move a up, 1 => move a down
      const sep = minY * sign * 0.5;
      a.y += sep;
      b.y -= sep;

      // reflect velocities on Y
      const vay = a.vy, vby = b.vy;
      a.vy = vby * RESTITUTION;
      b.vy = vay * RESTITUTION;

      // friction when colliding vertically
      a.vx *= FRICTION;
      b.vx *= FRICTION;
    }
  }

  // Constrain to container bounds
  function constrainToBounds(b, dt) {
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
      constrainToBounds(b, clamped);
    });

    // collisions (n^2 but fine for small counts)
    const arr = Array.from(bodies.values());
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        resolveAABB(arr[i], arr[j]);
      }
    }

    // write positions to DOM
    bodies.forEach(b => {
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

    const target = e.target.closest(SELECTOR_WINDOW + ',' + SELECTOR_ICON);
    if (!target) return;

    const b = bodies.get(target);
    if (!b) return;

    dragBody = b;
    dragBody.vx = 0;
    dragBody.vy = 0;

    const rect = b.container.getBoundingClientRect();
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
    const rect = dragBody.container.getBoundingClientRect();
    const x = (e.clientX - rect.left) - dragInfo.offsetX;
    const y = (e.clientY - rect.top)  - dragInfo.offsetY;

    dragBody.x = x;
    dragBody.y = y;

    // keep within bounds while dragging
    constrainToBounds(dragBody, 0);

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

    // Pointer hooks
    document.addEventListener('mousedown', onPointerDown, true);

    // Listen for UI lifecycle events to keep bodies in sync
    window.addEventListener('physics-ensure-window', onEnsureWindow);
    window.addEventListener('physics-remove-window', onRemoveWindow);
    window.addEventListener('physics-ensure-scope', onEnsureScope);
    window.addEventListener('physics-remove-icon', onRemoveIcon);

    // Also watch display toggles to auto-add/remove windows
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });

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

    // also bring in any icons currently inside
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
  window.physics = { enable, disable, toggle };

  // Optional: respond to terminal commands if you added them
  window.addEventListener('terminal-physics', (e) => {
    const on = !!e.detail?.on;
    if (on) enable(); else disable();
  });
})();
