// assets/js/notifications.js
(function () {
  const ROOT_ID = 'ae-notify-root';
  const WIDTH = 320;              // keep in sync with CSS .ae-notify-card width
  const TOP_OFFSET = 36;          // ↓ a little lower than the very top
  const PADDING = 12;             // inset inside the root
  const V_GAP = 10;               // vertical gap between stacked cards
  const HIDDEN_X = -WIDTH - 40;   // off-screen start/end position (slide in from here)
  const VISIBLE_X = PADDING;      // target x when shown
  const DRAG_DISMISS_PX = 80;     // drag left beyond this to dismiss

  // random delay: 10–40s
  const nextDelay = () => 10000 + Math.random() * 20000;

  // Demo pool: each item will appear ONCE per session (no repeats)
  const DEMO = [
    { title: 'New Release', body: 'Proxy Fae — “Soft Armor” is out now.' },
    { title: 'Tonight', body: 'Miana live set at 21:00 — stream on the player.' },
    { title: 'Merch Drop', body: 'Limited tees in the Resources folder.' },
    { title: 'Archive', body: 'Photos from last show were added.' },
    { title: 'Tip', body: 'Double-click folders to open; drag to group-move.' },
  ];

  // Create a one-time shuffled queue so we don’t repeat in this session
  const queue = shuffle(DEMO.slice());

  // Ensure root exists + positioned a bit lower
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    top: `${TOP_OFFSET}px`,   // << moved down from top
    zIndex: '5000',
    width: `${WIDTH}px`,
    pointerEvents: 'none'     // cards re-enable on themselves
  });

  /** State of live cards, top to bottom */
  let cards = []; // [{el, height}]

  /** Create a card element */
  function createCard({ title, body, icon, actions }) {
    const el = document.createElement('div');
    el.className = 'ae-notify-card';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.transform = `translate(${HIDDEN_X}px, ${PADDING}px)`;
    el.style.opacity = '0';
    el.style.pointerEvents = 'auto';
    el.style.transition = 'transform 280ms cubic-bezier(.2,.9,.2,1), opacity 200ms ease';

    el.innerHTML = `
      <div class="ae-row">
        ${icon
          ? `<img class="ae-icon" src="${icon}" alt="">`
          : `<div style="width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.08);"></div>`}
        <div class="ae-main">
          <div class="ae-title">${escapeHTML(title || 'Notification')}</div>
          ${body ? `<div class="ae-body">${escapeHTML(body)}</div>` : ''}
          ${
            Array.isArray(actions) && actions.length
              ? `<div class="ae-actions">
                   ${actions
                     .map(
                       (a) =>
                         `<button class="ae-act" data-key="${escapeAttr(
                           a.key || a.label
                         )}">${escapeHTML(a.label)}</button>`
                     )
                     .join('')}
                 </div>`
              : ''
          }
        </div>
        <button class="ae-close" aria-label="Dismiss">×</button>
      </div>
    `;

    // Close button
    el.querySelector('.ae-close')?.addEventListener('click', () => dismissCard(el));

    // Action buttons (emit event)
    el.querySelectorAll('.ae-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        el.dispatchEvent(new CustomEvent('ae:action', { detail: { key }, bubbles: true }));
      });
    });

    // Drag-to-dismiss (mouse + touch)
    enableDragDismiss(el);

    return el;
  }

  function escapeHTML(s = '') {
    return s.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  function escapeAttr(s = '') {
    return String(s).replace(/"/g, '&quot;');
  }

  /** Insert a card and animate in */
  function push(item) {
    const el = createCard(item);
    root.appendChild(el);

    // Temporarily position at top to measure height
    el.style.transform = `translate(${HIDDEN_X}px, ${PADDING}px)`;
    el.style.opacity = '0';
    // Let it render, then measure & place
    requestAnimationFrame(() => {
      const h = el.getBoundingClientRect().height;
      cards.unshift({ el, height: h }); // add at top of stack
      layout(); // set y positions for all
      // Now animate this one to visible X
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        const y = parseFloat(el.dataset.y || '0');
        el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      });
    });

    return el;
  }

  /** Recompute Y positions for stacked cards and animate */
  function layout() {
    let y = PADDING;
    cards.forEach(({ el, height }) => {
      el.dataset.y = y; // store target y for reuse
      el.style.transform = `translate(${VISIBLE_X}px, ${y}px)`;
      y += height + V_GAP;
    });
  }

  /** Remove a card with slide-out animation and close the gap */
  function dismissCard(el) {
    const idx = cards.findIndex((c) => c.el === el);
    if (idx === -1) return;

    // Slide out left + fade
    el.style.transition = 'transform 240ms ease, opacity 200ms ease';
    const y = parseFloat(el.dataset.y || '0');
    el.style.transform = `translate(${HIDDEN_X}px, ${y}px)`;
    el.style.opacity = '0';

    // After animation, remove and relayout the rest
    el.addEventListener(
      'transitionend',
      function onEnd() {
        el.removeEventListener('transitionend', onEnd);
        if (el.parentNode === root) root.removeChild(el);
        cards.splice(idx, 1);
        layout();
      },
      { once: true }
    );
  }

  /** Drag-to-dismiss behavior */
  function enableDragDismiss(el) {
    let startX = 0;
    let originX = VISIBLE_X;
    let y = 0;
    let dragging = false;

    const onDown = (clientX, clientY) => {
      dragging = true;
      startX = clientX;
      originX = VISIBLE_X;
      y = parseFloat(el.dataset.y || '0');
      el.style.transition = 'none';
      document.body.classList.add('no-text-select');
    };

    const onMove = (clientX) => {
      if (!dragging) return;
      const dx = clientX - startX; // negative when dragging left
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
      if (e.button !== 0) return;
      onDown(e.clientX, e.clientY);
      const move = (ev) => onMove(ev.clientX);
      const up = (ev) => {
        cleanup();
        onUp(ev.clientX);
      };
      const cleanup = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });

    // Touch
    el.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
      },
      { passive: true }
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0];
        onMove(t.clientX);
      },
      { passive: true }
    );
    el.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      onUp(t.clientX);
    });
  }

  /** Utilities */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Public API */
  window.aeNotify = {
    push,
    dismissCard,
    _state: () => cards,
  };

  // ---- Auto scheduling: show each item ONCE, with 10–40s gaps ----
  let timer = null;

  function schedule() {
    if (queue.length === 0) return; // nothing left this session
    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      const next = queue.shift();
      if (!next) return;
      push(next);
      schedule(); // schedule the following one
    }, nextDelay()); // delay BEFORE showing (so first waits too)
  }

  // Start only after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
})();
