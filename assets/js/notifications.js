// assets/js/notifications.js
(function () {
  const ROOT_ID = 'ae-notify-root';
  const WIDTH = 320;
  const TOP_OFFSET = 36;
  const PADDING = 12;
  const V_GAP = 10;
  const HIDDEN_X = -WIDTH - 40;
  const VISIBLE_X = PADDING;
  const DRAG_DISMISS_PX = 80;

  // Keep your current cadence (you had 5–25s in the snippet)
  const nextDelay = () => 5000 + Math.random() * 20000;

  // Demo pool (once per session unless we reseed)
  const DEMO = [
    { title: 'New Release', body: 'Proxy Fae — “Soft Armor” is out now.' },
    { title: 'Tonight', body: 'Miana live set at 21:00 — stream on the player.' },
    { title: 'Merch Drop', body: 'Limited tees in the Resources folder.' },
    { title: 'Archive', body: 'Photos from last show were added.' },
    { title: 'Tip', body: 'Double-click folders to open; drag to group-move.' },
  ];
  let queue = shuffle(DEMO.slice()); // <-- make this mutable so we can reseed

  // Root element
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    top: `${TOP_OFFSET}px`,
    zIndex: '5000',
    width: `${WIDTH}px`,
    pointerEvents: 'none',
  });

  // Live cards (top → bottom for stacked layout)
  let cards = []; // [{ el, height }]

  /* ---------------- Per-card freeze (Physics) ---------------- */
  function isFrozen(el) { return el?.dataset?.locked === '1'; }

  function freezeCardForPhysics(el) {
    // Stop our transitions/translate so physics fully owns motion
    el.style.transition = 'none';
    el.style.transform = 'none';

    // Fix current screen position (no jump)
    const r = el.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.left = (r.left || VISIBLE_X) + 'px';
    el.style.top  = (r.top  || (TOP_OFFSET + PADDING)) + 'px';

    // Interact but not select text
    el.style.pointerEvents = 'auto';
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.msUserSelect = 'none';

    el.dataset.locked = '1';
  }

  // Return a physics-managed card to stacked behavior
  function normalizeForStack(el) {
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.transition = '';
    el.style.transform = `translate(${HIDDEN_X}px, ${PADDING}px)`;
    el.style.opacity = '0';
    enableDragDismiss(el);
  }

  /* ---------------- Physics toggle behavior ---------------- */
  // ON  → freeze all current toasts, keep scheduler running.
  // OFF → dismiss ALL that either fell (frozen) OR were born while physics was ON,
  //       then normalize & restack any leftovers, reseed queue if needed, and restart scheduler.
  window.addEventListener('physics-mode-changed', (e) => {
    const on = !!e.detail?.on;

    if (on) {
      // Freeze everything currently alive so physics can take over.
      cards.forEach(({ el }) => {
        // If card wasn't marked, it's a pre-existing one → freeze it.
        if (!isFrozen(el)) freezeCardForPhysics(el);
      });
      // Ensure scheduler keeps ticking even in physics mode
      if (!timer && queue.length) schedule();
      return;
    }

    // Physics OFF:
    // 1) Dismiss all cards that were affected by physics:
    //    - frozen ones, OR
    //    - those created while physics was ON (bornInPhysics)
    const toRemove = cards
      .filter(({ el }) => isFrozen(el) || el.dataset.bornInPhysics === '1')
      .map(c => c.el);

    toRemove.forEach(el => dismissCard(el)); // frozen path uses fade-only

    // 2) Normalize any remaining (stack-managed) cards back into the column
    cards.forEach(({ el }) => {
      if (!isFrozen(el) && el.dataset.bornInPhysics !== '1') {
        normalizeForStack(el);
      }
      // Clear the marker if it exists
      if (el.dataset.bornInPhysics) el.dataset.bornInPhysics = '';
    });

    // 3) Restack & animate in
    layout();
    requestAnimationFrame(() => {
      cards.forEach(({ el }) => {
        if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
        const y = parseFloat(el.dataset.y || '0');
        el.style.opacity = '1';
        el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      });
    });

    // 4) Reseed + restart scheduler so it behaves like on page load
    reseedQueueIfEmpty();
    if (!timer && queue.length) schedule();
  });

  /* ---------------- Build / Layout / Dismiss ---------------- */
  function createCard({ title, body, icon, actions }) {
    const el = document.createElement('div');
    el.className = 'ae-notify-card';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    el.style.transform = `translate(${HIDDEN_X}px, ${PADDING}px)`;
    el.style.opacity = '0';
    el.style.pointerEvents = 'auto';
    el.style.transition = 'transform 280ms cubic-bezier(.2,.9,.2,1), opacity 200ms ease';
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.msUserSelect = 'none';

    el.innerHTML = `
      <div class="ae-row">
        ${icon
          ? '<img class="ae-icon" src="' + icon + '" alt="">'
          : '<div style="width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.08);"></div>'}
        <div class="ae-main">
          <div class="ae-title">${escapeHTML(title || 'Notification')}</div>
          ${body ? '<div class="ae-body">' + escapeHTML(body) + '</div>' : ''}
          ${
            Array.isArray(actions) && actions.length
              ? '<div class="ae-actions">' +
                actions.map(a =>
                  '<button class="ae-act" data-key="' + escapeAttr(a.key || a.label) + '">' +
                    escapeHTML(a.label) +
                  '</button>'
                ).join('') +
                '</div>'
              : ''
          }
        </div>
        <button class="ae-close" aria-label="Dismiss">×</button>
      </div>
    `;

    // Remove stray whitespace-only text nodes (prevents odd text artifacts)
    [...el.childNodes].forEach(n => {
      if (n.nodeType === Node.TEXT_NODE && !n.textContent.trim()) n.remove();
    });

    // Close works in both normal & frozen states
    el.querySelector('.ae-close')?.addEventListener('click', () => dismissCard(el));

    // Action buttons emit an event
    el.querySelectorAll('.ae-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        el.dispatchEvent(new CustomEvent('ae:action', { detail: { key }, bubbles: true }));
      });
    });

    // Swipe only for unfrozen cards
    enableDragDismiss(el);

    return el;
  }

  function push(item) {
    const el = createCard(item);
    root.appendChild(el);

    // Measure & register
    requestAnimationFrame(() => {
      const h = el.getBoundingClientRect().height;
      cards.unshift({ el, height: h });

      // If physics is ON at creation:
      // - mark as born during physics,
      // - freeze immediately so physics engine owns it,
      // - make it fully visible (physics controls position).
      if (window.PHYSICS_ON) {
        el.dataset.bornInPhysics = '1';
        freezeCardForPhysics(el);
        el.style.opacity = '1';
        return; // do NOT stack-animate
      }

      // Normal stacked behavior
      layout();
      requestAnimationFrame(() => {
        const y = parseFloat(el.dataset.y || '0');
        el.style.opacity = '1';
        el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      });
    });

    return el;
  }

  function layout() {
    let y = PADDING;
    cards.forEach(({ el, height }) => {
      if (isFrozen(el) || el.dataset.bornInPhysics === '1') return; // skip physics-affected
      el.dataset.y = y;
      el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      y += height + V_GAP;
    });
  }

  function dismissCard(el) {
    const idx = cards.findIndex(c => c.el === el);
    if (idx === -1) return;

    // If frozen or born during physics → fade only
    if (isFrozen(el) || el.dataset.bornInPhysics === '1') {
      el.style.transition = 'opacity 180ms ease';
      el.style.opacity = '0';
      el.addEventListener('transitionend', () => {
        if (el.parentNode === root) root.removeChild(el);
        cards.splice(idx, 1);
        layout();
      }, { once: true });
      return;
    }

    // Normal slide-out + fade
    el.style.transition = 'transform 240ms ease, opacity 200ms ease';
    const y = parseFloat(el.dataset.y || '0');
    el.style.transform = `translate(${HIDDEN_X}px, ${y}px)`;
    el.style.opacity = '0';
    el.addEventListener('transitionend', function onEnd() {
      el.removeEventListener('transitionend', onEnd);
      if (el.parentNode === root) root.removeChild(el);
      cards.splice(idx, 1);
      layout();
    }, { once: true });
  }

  function enableDragDismiss(el) {
    if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;

    let startX = 0;
    let originX = VISIBLE_X;
    let y = 0;
    let dragging = false;
    let moved = false;

    const onDown = (clientX) => {
      dragging = true;
      moved = false;
      startX = clientX;
      originX = VISIBLE_X;
      y = parseFloat(el.dataset.y || '0');
      el.style.transition = 'none';
      document.body.classList.add('no-text-select');
    };

    const onMove = (clientX) => {
      if (!dragging) return;
      const dx = clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const x = Math.min(originX + Math.max(dx, -WIDTH), originX + 16);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = String(Math.max(0.4, 1 + (x - originX) / 200));
    };

    const onUp = (clientX) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('no-text-select');
      const dx = clientX - startX;

      if (dx <= -DRAG_DISMISS_PX) {
        el.style.transition = 'transform 200ms ease, opacity 180ms ease';
        el.style.transform = `translate(${HIDDEN_X}px, ${y}px)`;
        el.style.opacity = '0';
        el.addEventListener('transitionend', () => dismissCard(el), { once: true });
      } else {
        el.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease';
        el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
        el.style.opacity = '1';
      }
    };

    // Mouse
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || isFrozen(el) || el.dataset.bornInPhysics === '1') return;
      onDown(e.clientX);
      const move = (ev) => onMove(ev.clientX);
      const up = (ev) => { cleanup(); onUp(ev.clientX); };
      const cleanup = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });

    // Touch
    el.addEventListener('touchstart', (e) => {
      if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
      const t = e.touches[0]; onDown(t.clientX);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
      const t = e.touches[0]; onMove(t.clientX);
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
      const t = e.changedTouches[0]; onUp(t.clientX);
    });
  }

  /* ---------------- Scheduler ---------------- */
  let timer = null;
  let nextAt = 0; // performance.now() timestamp for next fire

  function fireNext() {
    timer = null;
    const next = queue.shift();
    if (next) push(next);
    if (queue.length) schedule(); // chain
  }

  function schedule() {
    const delay = nextDelay();
    nextAt = performance.now() + delay;
    clearTimeout(timer);
    timer = setTimeout(fireNext, delay);
  }

  function reseedQueueIfEmpty() {
    if (!queue.length) {
      queue = shuffle(DEMO.slice());
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!queue.length) return;
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
      return;
    }
    const remaining = Math.max(0, nextAt - performance.now());
    clearTimeout(timer);
    timer = setTimeout(fireNext, remaining || 0);
  });

  /* ---------------- Utilities / Public API ---------------- */
  function escapeHTML(s = '') {
    return s.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }
  function escapeAttr(s = '') { return String(s).replace(/"/g, '&quot;'); }
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j]]; } return arr; }

  window.aeNotify = {
    push,
    dismissCard,
    clear: () => { [...cards].forEach(({ el }) => dismissCard(el)); },
    count: () => cards.length,
    _state: () => cards,
  };

  /* ---------------- Start scheduling ---------------- */
  function startScheduleOnce() {
    if (!timer && queue.length) schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startScheduleOnce, { once: true });
  } else {
    startScheduleOnce();
  }

  // If physics was already ON at load, freeze any existing (defensive)
  if (window.PHYSICS_ON) cards.forEach(({ el }) => freezeCardForPhysics(el));

  // Self-check: if nothing showed, show 1 toast and ensure schedule is running
  setTimeout(() => {
    if (!cards.length) {
      try { push({ title: 'Hello', body: 'Notifications are active.' }); } catch {}
      startScheduleOnce();
    }
  }, 3000);
})();
