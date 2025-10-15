// assets/js/terminal.js
(function () {
  const screen = document.getElementById('terminal-screen');
  const input  = document.getElementById('terminal-input');
  const prompt = document.getElementById('terminal-prompt');

  if (!screen || !input || !prompt) return; // terminal window not mounted yet

  /* ===============================
     Small DOM "filesystem" helpers
  ================================= */
  function getDesktopFolders() {
    const desktop = document.getElementById('desktop');
    if (!desktop) return [];
    return Array.from(desktop.querySelectorAll(':scope > .folder'))
      .filter(el => el.style.display !== 'none')
      .map(el => ({
        el,
        name: (el.querySelector('.folder-label')?.textContent || '').trim()
      }));
  }

  function getAllFolders() {
    return Array.from(document.querySelectorAll('.folder')).map(el => ({
      el,
      name: (el.querySelector('.folder-label')?.textContent || '').trim()
    }));
  }

  /* ===============================
     Terminal UI helpers
  ================================= */
  function writeLine(html, cls = '') {
    const line = document.createElement('div');
    line.className = 'terminal-line' + (cls ? (' ' + cls) : '');
    line.innerHTML = html;
    screen.appendChild(line);
    screen.scrollTop = screen.scrollHeight;
  }

  function writePrompted(cmdText) {
    writeLine(`${prompt.textContent} <span class="cmd">${escapeHTML(cmdText)}</span>`);
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function openByName(name) {
    if (!name) return false;
    const all = getAllFolders();
    const target = all.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!target) return false;
    if (typeof window.openFolder === 'function') {
      window.openFolder(target.el);
      return true;
    }
    return false;
  }

  /* ===============================
     Physics mode (gravity/collisions)
  ================================== */

  // Public toggle flag read by your drag code
  window.PHYSICS_ON = window.PHYSICS_ON || false;

  // Simple per-container physics worlds
  const physics = {
    rafId: null,
    worlds: [],   // [{el, bodies: Map<el, body>, isWindowContent, padding}]
    lastTime: 0,
    G: 2400,           // px/s^2
    DAMP_WALL: 0.35,   // energy loss on walls/floor
    DAMP_COLL: 0.5,    // energy loss on icon-icon collisions
    MAX_DT: 1/30,      // clamp dt to avoid tunneling on long tabs
  };

  function enablePhysics() {
    if (window.PHYSICS_ON) return;
    window.PHYSICS_ON = true;

    // Build worlds: desktop + every visible window content
    physics.worlds = [];

    const desktop = document.getElementById('desktop');
    if (desktop) {
      // Desktop is already absolute via your freeze logic; but ensure
      if (typeof window.freezeDesktopLayout === 'function') {
        window.freezeDesktopLayout();
      }
      physics.worlds.push(makeWorldForContainer(desktop, false));
    }

    document.querySelectorAll('.window .window-content').forEach(content => {
      // Freeze grid to absolute so items won't jump during sim
      if (typeof window.freezeWindowContentLayout === 'function') {
        window.freezeWindowContentLayout(content);
      } else {
        // Fallback: ensure positioned
        const cs = getComputedStyle(content);
        if (cs.position === 'static') content.style.position = 'relative';
        // Convert statics to absolute where needed (basic fallback)
        Array.from(content.querySelectorAll(':scope > .folder')).forEach(f => {
          const r = f.getBoundingClientRect();
          const cr = content.getBoundingClientRect();
          f.style.position = 'absolute';
          f.style.left = (r.left - cr.left + content.scrollLeft) + 'px';
          f.style.top  = (r.top  - cr.top  + content.scrollTop ) + 'px';
        });
      }
      physics.worlds.push(makeWorldForContainer(content, true));
    });

    // Hook pointer drag while in physics mode (so you can move icons around)
    addPhysicsPointerHandlers();

    physics.lastTime = performance.now();
    tickPhysics();
  }

  function disablePhysics() {
    if (!window.PHYSICS_ON) return;
    window.PHYSICS_ON = false;

    removePhysicsPointerHandlers();

    if (physics.rafId) {
      cancelAnimationFrame(physics.rafId);
      physics.rafId = null;
    }
    physics.worlds = [];
  }

  function makeWorldForContainer(containerEl, isWindowContent) {
    const bodies = new Map();
    const padding = 6; // tiny gap from walls
    const cr = containerEl.getBoundingClientRect();

    const folders = Array.from(containerEl.querySelectorAll(':scope > .folder'))
      .filter(el => el.style.display !== 'none' && !el.classList.contains('in-trash'));

    folders.forEach(el => {
      const pos = getLocalXY(containerEl, el);
      const w = el.offsetWidth || 100;
      const h = el.offsetHeight || 120;
      el.style.position = 'absolute'; // ensure absolute
      // If no left/top set (string), set from computed
      if (!/px$/.test(el.style.left)) el.style.left = pos.x + 'px';
      if (!/px$/.test(el.style.top))  el.style.top  = pos.y + 'px';
      bodies.set(el, {
        el,
        x: parseFloat(el.style.left) || pos.x,
        y: parseFloat(el.style.top)  || pos.y,
        w, h,
        vx: 0, vy: 0,
        grabbed: false,
        grabDX: 0, grabDY: 0,
      });
    });

    return { el: containerEl, bodies, isWindowContent, padding, width: cr.width, height: cr.height };
  }

  function getLocalXY(container, el) {
    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const sL = container.scrollLeft || 0;
    const sT = container.scrollTop  || 0;
    return { x: er.left - cr.left + sL, y: er.top - cr.top + sT };
  }

  function tickPhysics(now) {
    physics.rafId = requestAnimationFrame(tickPhysics);
    if (!now) now = performance.now();
    let dt = (now - physics.lastTime) / 1000;
    physics.lastTime = now;
    dt = Math.min(dt, physics.MAX_DT);

    physics.worlds.forEach(world => stepWorld(world, dt));
  }

  function stepWorld(world, dt) {
    const { el, bodies, padding } = world;

    // Effective container bounds (use client size)
    const W = el.clientWidth;
    const H = el.clientHeight;

    // 1) Integrate
    bodies.forEach(b => {
      if (b.grabbed) { // held by the mouse
        b.vx = 0; b.vy = 0;
        return;
      }
      b.vy += physics.G * dt;         // gravity
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;
    });

    // 2) Collide with walls/floor/ceiling
    bodies.forEach(b => {
      // left/right
      if (b.x < padding) {
        b.x = padding;
        b.vx = -b.vx * physics.DAMP_WALL;
      }
      if (b.x + b.w > W - padding) {
        b.x = Math.max(padding, W - padding - b.w);
        b.vx = -b.vx * physics.DAMP_WALL;
      }
      // top
      if (b.y < padding) {
        b.y = padding;
        b.vy = -b.vy * physics.DAMP_WALL;
      }
      // bottom (the “floor”)
      if (b.y + b.h > H - padding) {
        b.y = Math.max(padding, H - padding - b.h);
        b.vy = -b.vy * physics.DAMP_WALL;
        // small horizontal damping when on ground to settle easier
        b.vx *= 0.98;
      }
    });

    // 3) Pairwise icon collisions (AABB + simple separation)
    const arr = Array.from(bodies.values());
    for (let i = 0; i < arr.length; i++) {
      const A = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const B = arr[j];
        if (A.grabbed && B.grabbed) continue;

        if (rectsOverlap(A, B)) {
          // minimal translation vector
          const dx1 = (A.x + A.w) - B.x;      // A to the left of B
          const dx2 = (B.x + B.w) - A.x;      // B to the left of A
          const dy1 = (A.y + A.h) - B.y;
          const dy2 = (B.y + B.h) - A.y;

          // Choose axis with smaller overlap
          const overlapX = Math.min(dx1, dx2);
          const overlapY = Math.min(dy1, dy2);

          if (overlapX < overlapY) {
            // Separate along X
            if (dx1 < dx2) {
              // move A left
              const shift = overlapX / 2;
              A.x -= shift;
              B.x += shift;
            } else {
              A.x += overlapX / 2;
              B.x -= overlapX / 2;
            }
            const tmp = A.vx;
            A.vx = -B.vx * physics.DAMP_COLL;
            B.vx = -tmp * physics.DAMP_COLL;
          } else {
            // Separate along Y
            if (dy1 < dy2) {
              const shift = overlapY / 2;
              A.y -= shift;
              B.y += shift;
            } else {
              A.y += overlapY / 2;
              B.y -= overlapY / 2;
            }
            const tmp = A.vy;
            A.vy = -B.vy * physics.DAMP_COLL;
            B.vy = -tmp * physics.DAMP_COLL;
          }
        }
      }
    }

    // 4) Apply to DOM
    bodies.forEach(b => {
      b.el.style.left = `${b.x}px`;
      b.el.style.top  = `${b.y}px`;
      // ensure absolute & pointer events enabled
      b.el.style.position = 'absolute';
    });
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  }

  /* Pointer drag while physics is ON */
  const physicsPointer = {
    onMouseDown: null,
    onMouseMove: null,
    onMouseUp:   null
  };

  function addPhysicsPointerHandlers() {
    // mousedown: if target is a folder inside any physics world, grab it
    physicsPointer.onMouseDown = (e) => {
      if (!window.PHYSICS_ON) return;
      const el = e.target.closest('.folder');
      if (!el) return;

      // Find the world that owns this element
      const world = physics.worlds.find(w => w.bodies.has(el));
      if (!world) return;

      const body = world.bodies.get(el);
      if (!body) return;

      // bring its container to front (optional nicer UX)
      const win = el.closest('.window');
      if (win && typeof window.bringToFront === 'function') {
        window.bringToFront(win);
      }

      body.grabbed = true;
      const r = el.getBoundingClientRect();
      body.grabDX = e.clientX - r.left;
      body.grabDY = e.clientY - r.top;

      e.preventDefault();
    };

    physicsPointer.onMouseMove = (e) => {
      if (!window.PHYSICS_ON) return;

      physics.worlds.forEach(world => {
        world.bodies.forEach(b => {
          if (!b.grabbed) return;

          const cr = world.el.getBoundingClientRect();
          const sL = world.el.scrollLeft || 0;
          const sT = world.el.scrollTop  || 0;

          // target position under mouse, clamped to container
          const tx = (e.clientX - cr.left + sL) - b.grabDX;
          const ty = (e.clientY - cr.top  + sT) - b.grabDY;

          const minX = 0 + world.padding;
          const maxX = world.el.clientWidth  - b.w - world.padding;
          const minY = 0 + world.padding;
          const maxY = world.el.clientHeight - b.h - world.padding;

          b.x = Math.max(minX, Math.min(tx, maxX));
          b.y = Math.max(minY, Math.min(ty, maxY));
          b.vx = 0; b.vy = 0; // reset momentum while dragging
        });
      });
    };

    physicsPointer.onMouseUp = () => {
      if (!window.PHYSICS_ON) return;
      physics.worlds.forEach(world => {
        world.bodies.forEach(b => { b.grabbed = false; });
      });
    };

    document.addEventListener('mousedown', physicsPointer.onMouseDown, true);
    document.addEventListener('mousemove', physicsPointer.onMouseMove, true);
    document.addEventListener('mouseup',   physicsPointer.onMouseUp,   true);
  }

  function removePhysicsPointerHandlers() {
    document.removeEventListener('mousedown', physicsPointer.onMouseDown, true);
    document.removeEventListener('mousemove', physicsPointer.onMouseMove, true);
    document.removeEventListener('mouseup',   physicsPointer.onMouseUp,   true);
  }

  /* ===============================
     Commands & input handling
  ================================= */
  const history = [];
  let historyIndex = -1;

  const commands = {
    help() {
      writeLine([
        'Available commands:',
        '  help                Show this help',
        '  clear               Clear the terminal',
        '  ls                  List desktop folders',
        '  open <name>         Open a folder window by name',
        '  trash               Open the Trash window',
        '  echo <text>         Print text',
        '  date                Current date/time',
        '  whoami              Prints current user',
        '  pwd                 Prints pseudo path (~/Desktop)',
        '  history             Show command history',
        '  physics on          Enable gravity/collisions for icons',
        '  physics off         Disable physics mode'
      ].join('\n'));
    },

    clear() {
      screen.innerHTML = '';
    },

    ls() {
      const items = getDesktopFolders().map(f => f.name).sort((a,b)=>a.localeCompare(b));
      if (!items.length) writeLine('(no folders on desktop)');
      else writeLine(items.join('\n'));
    },

    open(args) {
      const name = args.join(' ').trim();
      if (!name) return writeLine('Usage: open <folder name>', 'err');
      const ok = openByName(name);
      writeLine(ok ? `Opening “${escapeHTML(name)}”...` : `Folder not found: ${escapeHTML(name)}`, ok ? '' : 'err');
    },

    trash() {
      const btn = document.querySelector('.dock-item[data-window="trash-window"]');
      if (btn) btn.click();
      else writeLine('Trash not found.', 'err');
    },

    echo(args) { writeLine(args.join(' ')); },
    date()     { writeLine(new Date().toString()); },
    whoami()   { writeLine('guest'); },
    pwd()      { writeLine('~/Desktop'); },

    history() {
      if (!history.length) return writeLine('(history empty)');
      history.forEach((h, i) => writeLine(`${i+1}  ${escapeHTML(h)}`));
    },

    physics(args) {
      const arg = (args[0] || '').toLowerCase();
      if (arg === 'on') {
        enablePhysics();
        writeLine('Physics: ON (gravity enabled; drag icons and release to let them fall).');
      } else if (arg === 'off') {
        disablePhysics();
        writeLine('Physics: OFF (icons stay where you left them).');
      } else {
        writeLine('Usage: physics on | physics off', 'err');
      }
    }
  };

  function runCommand(raw) {
    const line = raw.trim();
    if (!line) return;

    writePrompted(line);

    const [cmd, ...rest] = tokenize(line);
    const fn = commands[cmd];
    if (fn) {
      try { fn(rest); } catch (e) { writeLine(String(e), 'err'); }
    } else {
      writeLine(`Command not found: ${escapeHTML(cmd)}`, 'err');
    }
  }

  // Tokenizer: split by spaces but keep quoted strings
  function tokenize(s) {
    const out = [];
    let buf = '';
    let quote = null;
    for (let i=0; i<s.length; i++) {
      const c = s[i];
      if (quote) {
        if (c === quote) { quote = null; }
        else { buf += c; }
      } else {
        if (c === '"' || c === "'") { quote = c; }
        else if (/\s/.test(c)) { if (buf) { out.push(buf); buf=''; } }
        else { buf += c; }
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  // Input behavior
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value;
      if (value.trim()) {
        history.push(value);
        historyIndex = history.length;
      }
      runCommand(value);
      input.value = '';
      return;
    }

    if (e.key === 'ArrowUp') {
      if (history.length) {
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex] ?? '';
        setCaretToEndSoon();
      }
      e.preventDefault();
    }

    if (e.key === 'ArrowDown') {
      if (history.length) {
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = historyIndex === history.length ? '' : (history[historyIndex] ?? '');
        setCaretToEndSoon();
      }
      e.preventDefault();
    }

    // Ctrl/Cmd+L to clear
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      commands.clear();
    }
  });

  function setCaretToEndSoon() {
    setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
  }

  // Focus input when terminal is interacted with or shown
  const termWin = document.getElementById('terminal-window');
  if (termWin) {
    termWin.addEventListener('mousedown', () => setTimeout(() => input.focus(), 0));
    const observer = new MutationObserver(() => {
      if (termWin.style.display !== 'none') setTimeout(() => input.focus(), 0);
    });
    observer.observe(termWin, { attributes: true, attributeFilter: ['style'] });
  }

  // Greeting
  writeLine('æ Terminal — type "help" to get started.');
  input.placeholder = 'Type a command…';
  setTimeout(() => input.focus(), 0);
})();
