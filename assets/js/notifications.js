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

  // Cadence (5–25s)
  const nextDelay = () => 5000 + Math.random() * 20000;

  // --- Mascot (Clippy) support ---
  const MASCOT_ICON = 'assets/images/Clippy.png';
  let __aeMascotShown = false;

  function ensureMascotCSS() {
    if (document.getElementById('ae-mascot-css')) return;
    const style = document.createElement('style');
    style.id = 'ae-mascot-css';
    style.textContent = `
      .ae-notify-card{ user-select:none; -webkit-user-select:none; -ms-user-select:none; }
      .ae-notify-card.ae-notify--mascot{
        background: rgba(199, 199, 199, 0.57) !important;
        color:#111 !important;
        border-color: rgba(0,0,0,0.08) !important;
      }
      .ae-notify-card.ae-notify--mascot .ae-title{ color:#111 !important; }
      .ae-notify-card.ae-notify--mascot .ae-body{ color:#111 !important; opacity:0.95; }
      .ae-notify-card.ae-notify--mascot .ae-close{ color: rgba(0,0,0,0.6) !important; }
      .ae-notify-card.ae-notify--mascot .ae-close:hover{
        background: rgba(0,0,0,0.06) !important; color:#000 !important;
      }
      .ae-notify-card.ae-notify--mascot .ae-act{
        background: rgba(0,0,0,0.06) !important;
        color:#111 !important;
        border-color: rgba(0,0,0,0.14) !important;
      }
      .ae-notify-card.ae-notify--mascot .ae-act:hover{
        background: rgba(0,0,0,0.10) !important;
      }
      .ae-notify-card.ae-notify--mascot .ae-icon{
        width: 80px !important; 
        height: 80px !important;
      }
    `;
    document.head.appendChild(style);
  }

  function pushMascotWelcome() {
    if (__aeMascotShown) return;
    __aeMascotShown = true;
    const payload = {
      title: "Hi, I'm Clippy 👋",
      body: "Welcome to æ. Double-click folders to explore — or open the Terminal and type “help”.",
      icon: MASCOT_ICON,
      mascot: true
    };
    // Be resilient to ordering: prefer global API if present, else local push()
    try {
      (window.aeNotify?.push?.(payload)) ?? push(payload);
    } catch {
      // As a last resort, call local push
      push(payload);
    }
  }

  // Demo pool (once per session unless we reseed)
  const DEMO = [
    { title: 'New Release', body: 'Proxy Fae — “Soft Armor” is out now.' },
    { title: 'Tonight', body: 'Miana live set at 21:00 — stream on the player.' },
    { title: 'Merch Drop', body: 'Limited tees in the Resources folder.' },
    { title: 'Archive', body: 'Photos from last show were added.' },
    { title: 'Tip', body: 'Double-click folders to open; drag to group-move.' },
  ];
  let queue = shuffle(DEMO.slice()); // mutable so we can reseed

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
    el.style.transition = 'none';
    el.style.transform = 'none';

    const r = el.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.left = (r.left || VISIBLE_X) + 'px';
    el.style.top  = (r.top  || (TOP_OFFSET + PADDING)) + 'px';

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
  window.addEventListener('physics-mode-changed', (e) => {
    const on = !!e.detail?.on;

    if (on) {
      cards.forEach(({ el }) => { if (!isFrozen(el)) freezeCardForPhysics(el); });
      if (!timer && queue.length) schedule(); // scheduler keeps running
      return;
    }

    // Physics OFF:
    const toRemove = cards
      .filter(({ el }) => isFrozen(el) || el.dataset.bornInPhysics === '1')
      .map(c => c.el);
    toRemove.forEach(el => dismissCard(el)); // frozen path uses fade-only

    cards.forEach(({ el }) => {
      if (!isFrozen(el) && el.dataset.bornInPhysics !== '1') normalizeForStack(el);
      if (el.dataset.bornInPhysics) el.dataset.bornInPhysics = '';
    });

    layout();
    requestAnimationFrame(() => {
      cards.forEach(({ el }) => {
        if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
        const y = parseFloat(el.dataset.y || '0');
        el.style.opacity = '1';
        el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      });
    });

    reseedQueueIfEmpty();
    if (!timer && queue.length) schedule();
  });

  /* ---------------- Build / Layout / Dismiss ---------------- */
  function createCard({ title, body, icon, actions, mascot }) {
    const el = document.createElement('div');
    el.className = 'ae-notify-card';
    if (mascot) el.classList.add('ae-notify--mascot');
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

    // Remove stray whitespace-only text nodes
    [...el.childNodes].forEach(n => {
      if (n.nodeType === Node.TEXT_NODE && !n.textContent.trim()) n.remove();
    });

    el.querySelector('.ae-close')?.addEventListener('click', () => dismissCard(el));

    el.querySelectorAll('.ae-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        el.dispatchEvent(new CustomEvent('ae:action', { detail: { key }, bubbles: true }));
      });
    });

    enableDragDismiss(el);

    return el;
  }

  function push(item) {
    const el = createCard(item);
    root.appendChild(el);

    requestAnimationFrame(() => {
      const h = el.getBoundingClientRect().height;
      cards.unshift({ el, height: h });

      if (window.PHYSICS_ON) {
        el.dataset.bornInPhysics = '1';
        freezeCardForPhysics(el);
        el.style.opacity = '1';
        return;
      }

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
      if (isFrozen(el) || el.dataset.bornInPhysics === '1') return;
      el.dataset.y = y;
      el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      y += height + V_GAP;
    });
  }

  function dismissCard(el) {
    const idx = cards.findIndex(c => c.el === el);
    if (idx === -1) return;

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

  // Public API (register BEFORE we try to show the mascot)
  window.aeNotify = {
    push,
    dismissCard,
    clear: () => { [...cards].forEach(({ el }) => dismissCard(el)); },
    count: () => cards.length,
    _state: () => cards,
  };

  /* ---------------- Start scheduling ---------------- */
  function startScheduleOnce() {
    ensureMascotCSS();
    // Nudge mascot after the API is surely present
    setTimeout(pushMascotWelcome, 800);
    if (!timer && queue.length) schedule();

    // Watchdog: if truly nothing rendered, show a hello toast (helps diagnose)
    setTimeout(() => {
      if (!cards.length) {
        push({ title: 'Hello', body: 'Notifications are active.' });
        if (!timer && queue.length) schedule();
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startScheduleOnce, { once: true });
  } else {
    startScheduleOnce();
  }

  // If physics already ON at load, freeze any existing (defensive)
  if (window.PHYSICS_ON) cards.forEach(({ el }) => freezeCardForPhysics(el));
})();
