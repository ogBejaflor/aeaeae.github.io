import { AEBootSequence } from './boot-sequence.js';
import { AEPowerScreen } from './power-screen.js';

const restoreAttribute = (element, name, value) => {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
};

/**
 * A click-to-power-on gate followed by the existing procedural boot sequence.
 * Construction preloads the renderer; it never starts playback or a timeout.
 *
 * Keep `desktop` separate from the overlay and the optional `skipButton`.
 * Listen on this controller for `enter`, whose detail is { reason }.
 */
export class AEComputerBoot extends EventTarget {
  constructor(overlay, {
    desktop, skipButton = null, focusTarget = null, options = {}, timeoutMs
  } = {}) {
    super();
    if (overlay?.nodeType !== 1 || desktop?.nodeType !== 1) {
      throw new TypeError('AEComputerBoot needs an overlay element and a desktop element.');
    }
    if (overlay === desktop || overlay.contains(desktop) || desktop.contains(overlay)) {
      throw new TypeError('The boot overlay and desktop must be separate elements.');
    }
    if (skipButton && (skipButton.tagName !== 'BUTTON' || skipButton === overlay || desktop.contains(skipButton))) {
      throw new TypeError('Place the optional Skip button outside the desktop.');
    }
    if (focusTarget && typeof focusTarget.focus !== 'function') {
      throw new TypeError('focusTarget must be a focusable DOM element.');
    }

    this.overlay = overlay;
    this.desktop = desktop;
    this.skipButton = skipButton;
    this.focusTarget = focusTarget;
    this.boot = null;
    this.power = null;
    this.state = 'waiting';
    this._disposed = false;
    this._initializationError = null;
    this._watchdog = null;
    this._abort = new AbortController();
    this._desktopAttributes = {
      inert: desktop.getAttribute('inert'),
      ariaHidden: desktop.getAttribute('aria-hidden')
    };

    desktop.setAttribute('inert', '');
    desktop.setAttribute('aria-hidden', 'true');
    if (skipButton) {
      skipButton.hidden = true;
      skipButton.disabled = true;
      skipButton.addEventListener('click', () => this.skip(), { signal: this._abort.signal });
    }
    overlay.ownerDocument.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (this.state === 'starting' || this.state === 'booting')) {
        event.preventDefault();
        this.skip();
      }
    }, { signal: this._abort.signal });

    try {
      this.boot = new AEBootSequence(overlay, {
        ...options, loop: false, endBehavior: 'dismiss'
      });
      this.boot.addEventListener('dismiss', () => {
        if (this.state === 'booting') this._enter('complete');
      }, { signal: this._abort.signal });
      // An initialization failure must not turn on the computer by itself.
      // Keep the gate waiting, then release the desktop if the user activates it.
      Promise.resolve(this.boot.ready).catch(error => {
        if (this._disposed) return;
        this._initializationError = error;
        if (this.state === 'booting') this._enter('error');
      });
    } catch (error) {
      this._initializationError = error;
    }

    const duration = this.boot?.duration ?? 9.2;
    const defaultTimeout = Math.max(15000, duration * 1000 + 6000);
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(timeoutMs, 2147483647) : defaultTimeout;

    try {
      // The power screen is added after the boot canvas, above it in this overlay.
      this.power = new AEPowerScreen(overlay, options);
      this.power.addEventListener('activating', () => {
        if (this.state === 'waiting') this.state = 'starting';
      }, { signal: this._abort.signal });
      this.power.addEventListener('activate', () => this._beginBoot(), {
        signal: this._abort.signal
      });
    } catch (error) {
      this._initializationError = error;
      // Let callers attach their enter listener before reporting a failed gate.
      queueMicrotask(() => this._enter('error'));
    }
  }

  /** Activate the power gate. Repeated requests resolve false. */
  start() {
    if (this.state !== 'waiting' || !this.power) return Promise.resolve(false);
    try {
      return Promise.resolve(this.power.activate()).catch(error => {
        this._initializationError = error;
        this._enter('error');
        return false;
      });
    } catch (error) {
      this._initializationError = error;
      this._enter('error');
      return Promise.resolve(false);
    }
  }

  /** Skip only after power activation has begun; waiting cannot be bypassed. */
  skip() {
    if (this.state !== 'starting' && this.state !== 'booting') return false;
    this._enter('skipped');
    return true;
  }

  _beginBoot() {
    if (this.state !== 'waiting' && this.state !== 'starting') return;
    this.state = 'booting';
    if (this.skipButton) {
      this.skipButton.hidden = false;
      this.skipButton.disabled = false;
    }
    this._watchdog = setTimeout(() => this._enter('timeout'), this.timeoutMs);
    if (this._initializationError || !this.boot) {
      this._enter('error');
      return;
    }
    try {
      Promise.resolve(this.boot.play()).catch(error => {
        this._initializationError = error;
        this._enter('error');
      });
    } catch (error) {
      this._initializationError = error;
      this._enter('error');
    }
  }

  _enter(reason) {
    if (this.state === 'complete' || this.state === 'destroyed') return;
    this.state = 'complete';
    this._dispose();
    this._focusDesktop();
    this.dispatchEvent(new CustomEvent('enter', { detail: { reason } }));
  }

  _focusDesktop() {
    const target = this.focusTarget?.isConnected ? this.focusTarget : this.desktop;
    if (!target.isConnected || target.closest('[inert], [aria-hidden="true"]')) return;
    const addTabindex = !target.hasAttribute('tabindex') && target.tabIndex < 0;
    if (addTabindex) target.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); }
    catch { try { target.focus(); } catch {} }
    if (addTabindex) target.removeAttribute('tabindex');
  }

  _dispose() {
    if (this._disposed) return;
    this._disposed = true;
    clearTimeout(this._watchdog);
    this._watchdog = null;
    this._abort.abort();
    // A resource-cleanup error must not leave the existing desktop locked.
    for (const resource of [this.power, this.boot]) {
      try { resource?.destroy(); } catch {}
    }
    restoreAttribute(this.desktop, 'inert', this._desktopAttributes.inert);
    restoreAttribute(this.desktop, 'aria-hidden', this._desktopAttributes.ariaHidden);
    this.skipButton?.remove();
    this.overlay.remove();
  }

  /** Dispose without an enter event or focus change; never remove the desktop. */
  destroy() {
    if (this.state === 'destroyed') return;
    this.state = 'destroyed';
    this._dispose();
  }
}
