// assets/js/artistRing.js
// Artists on a merry-go-round: cards stand on a ring in CSS 3D and the ring
// turns to bring one to the front. Drag, scroll, arrow keys or click a card.
//
//   const ring = new ArtistRing(wrapEl, ringEl, artists, { photoFor });
//   ring.addEventListener('focus',  e => e.detail.index)   // a new artist is at the front
//   ring.addEventListener('select', e => e.detail.index)   // the front artist was clicked

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (n, m) => ((n % m) + m) % m;

function hueFrom(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export class ArtistRing extends EventTarget {
  constructor(wrap, ring, artists, { photoFor = () => null } = {}) {
    super();
    this.wrap = wrap;
    this.ring = ring;
    this.artists = artists;
    this.n = artists.length;
    this.pos = 0;        // fractional index at the front (unbounded, wraps)
    this.target = 0;
    this.vel = 0;
    this.dragging = false;
    this.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.cards = artists.map((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'aep-card';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', a.name);
      b.dataset.index = String(i);
      const photo = photoFor(a);
      if (photo) {
        const img = document.createElement('span');
        img.className = 'aep-card-img';
        img.style.backgroundImage = `url("${photo}")`;
        b.appendChild(img);
      } else {
        // no photo yet: a typographic card, tinted from the name
        const hue = hueFrom(a.name);
        const ph = document.createElement('span');
        ph.className = 'aep-card-ph';
        ph.style.setProperty('--h', hue);
        ph.innerHTML = `<span class="aep-card-ph-name"></span><span class="aep-card-ph-mark">æ</span>`;
        ph.firstChild.textContent = a.name;
        b.appendChild(ph);
      }
      const gloss = document.createElement('span');
      gloss.className = 'aep-card-gloss';
      b.appendChild(gloss);
      ring.appendChild(b);
      return b;
    });

    this._bind();
    this.resizeObserver = new ResizeObserver(() => this._layout());
    this.resizeObserver.observe(wrap);
    this._layout();
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  get index() { return mod(Math.round(this.target), this.n); }

  focusTo(i, { instant = false } = {}) {
    if (!this.n) return;
    // go the short way round
    const cur = this.target;
    const base = Math.round(cur);
    let delta = mod(i - mod(base, this.n), this.n);
    if (delta > this.n / 2) delta -= this.n;
    this.target = base + delta;
    if (instant) { this.pos = this.target; this.vel = 0; }
    this._emitFocus();
  }
  next() { this.target = Math.round(this.target) + 1; this._emitFocus(); }
  prev() { this.target = Math.round(this.target) - 1; this._emitFocus(); }

  _emitFocus() {
    const idx = this.index;
    if (idx === this._lastEmitted) return;
    this._lastEmitted = idx;
    this.cards.forEach((c, i) => c.setAttribute('aria-selected', i === idx ? 'true' : 'false'));
    this.dispatchEvent(new CustomEvent('focus', { detail: { index: idx } }));
  }

  _layout() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    const cardW = clamp(Math.min(w * 0.24, h * 0.42), 120, 230);
    const cardH = cardW * 1.25;
    this.step = 360 / Math.max(this.n, 1);
    // radius so neighbours don't overlap, but small enough that the far side stays in view
    const r = Math.max((cardW * 1.12) / (2 * Math.tan(Math.PI / Math.max(this.n, 3))), cardW * 1.4);
    this.radius = r;
    this.cardW = cardW;
    this.wrap.style.setProperty('--card-w', `${cardW}px`);
    this.wrap.style.setProperty('--card-h', `${cardH}px`);
    this.wrap.style.setProperty('--persp', `${Math.max(900, r * 3.2)}px`);
    this._apply(true);
  }

  _apply(force) {
    if (!this.step) return;
    const r = this.radius;
    this.ring.style.transform = `translateZ(${-r}px) rotateX(-7deg) rotateY(${-this.pos * this.step}deg)`;
    this.cards.forEach((c, i) => {
      let rel = mod(i - this.pos + this.n / 2, this.n) - this.n / 2;  // -n/2 … n/2
      const ang = rel * this.step * Math.PI / 180;
      const facing = (Math.cos(ang) + 1) / 2;                        // 1 front … 0 back
      const front = Math.abs(rel) < 0.5;
      // the front card steps out of the ring a little
      const pop = Math.pow(Math.max(0, Math.cos(ang)), 8) * this.cardW * 0.22;
      c.style.transform = `rotateY(${i * this.step}deg) translateZ(${(r + pop).toFixed(1)}px)`;
      c.style.opacity = (0.18 + 0.82 * Math.pow(facing, 1.6)).toFixed(3);
      c.style.zIndex = String(Math.round(facing * 100));
      c.classList.toggle('is-front', front);
      c.style.pointerEvents = facing > 0.45 ? 'auto' : 'none';
      c.tabIndex = front ? 0 : -1;
    });
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min((now - this._last) / 1000, 1 / 15);
    this._last = now;
    if (!this.wrap.isConnected || this.wrap.offsetParent === null || document.hidden) return;
    if (!this.dragging) {
      const k = this.reduceMotion ? 220 : 60, c = 2 * Math.sqrt(k) * 0.82;
      this.vel += (-k * (this.pos - this.target) - c * this.vel) * dt;
      this.pos += this.vel * dt;
    }
    if (Math.abs(this.pos - this.target) > 0.0005 || Math.abs(this.vel) > 0.0005 || this.dragging || this._dirty) {
      this._dirty = false;
      this._apply();
    }
  }

  _bind() {
    const el = this.wrap;
    let down = null;

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation(); // keep the desktop from starting a window drag / selection
      down = { x: e.clientX, lx: e.clientX, t: performance.now(), et: e.timeStamp, start: this.pos, moved: false, v: 0, card: e.target.closest('.aep-card') };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!down.moved && Math.abs(dx) > 6) {
        down.moved = true;
        this.dragging = true;
        el.classList.add('is-dragging');
      }
      if (!down.moved) return;
      const now = performance.now();
      const per = this.cardW * 1.15;
      this.pos = down.start - dx / per;
      const dtm = Math.max(1, now - down.t) / 1000;
      down.v = down.v * 0.6 + (-(e.clientX - down.lx) / per / dtm) * 0.4;
      down.lx = e.clientX;
      down.t = now;
    });
    const end = e => {
      if (!down) return;
      const d = down;
      down = null;
      el.classList.remove('is-dragging');
      if (d.moved) {
        this.dragging = false;
        this.vel = d.v;
        this.target = Math.round(this.pos + d.v * 0.22);
        this._emitFocus();
        return;
      }
      if (e.timeStamp - d.et > 600 || !d.card) return;
      const i = Number(d.card.dataset.index);
      if (i === this.index) this.dispatchEvent(new CustomEvent('select', { detail: { index: i } }));
      else this.focusTo(i);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      if (!down) return;
      down = null;
      this.dragging = false;
      el.classList.remove('is-dragging');
      this.target = Math.round(this.pos);
      this._emitFocus();
    });

    // wheel / trackpad turns the ring a card at a time
    let acc = 0, lastStep = 0;
    el.addEventListener('wheel', e => {
      e.preventDefault();
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = performance.now();
      if (Math.abs(acc) > 40 && now - lastStep > 140) {
        acc > 0 ? this.next() : this.prev();
        acc = 0;
        lastStep = now;
      }
    }, { passive: false });

    this.ring.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('select', { detail: { index: this.index } }));
      }
    });
  }

  /** Little "nope" shake on the front card (e.g. an artist with no releases yet). */
  nudge() {
    const c = this.cards[this.index];
    if (!c || this.reduceMotion) return;
    c.classList.remove('is-nudged');
    void c.offsetWidth;
    c.classList.add('is-nudged');
  }
}
