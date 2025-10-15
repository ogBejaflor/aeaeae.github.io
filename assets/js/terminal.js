// assets/js/terminal.js
(function () {
  const screen = document.getElementById('terminal-screen');
  const input  = document.getElementById('terminal-input');
  const prompt = document.getElementById('terminal-prompt');
  if (!screen || !input || !prompt) return;

  /* ===============================
     Helpers: Folders & Output
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
    return s.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
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
     Inline Physics Fallback
  ================================= */
  window.PHYSICS_ON = window.PHYSICS_ON || false;
  const physics = { rafId: null, worlds: [], lastTime: 0, G: 2400 };

  function enablePhysics() {
    if (window.PHYSICS_ON) return;
    window.PHYSICS_ON = true;
    physics.worlds = [];
    const desktop = document.getElementById('desktop');
    if (desktop) physics.worlds.push(makeWorld(desktop));
    document.querySelectorAll('.window .window-content').forEach(c => physics.worlds.push(makeWorld(c)));
    physics.lastTime = performance.now();
    tickPhysics();
  }

  function disablePhysics() {
    window.PHYSICS_ON = false;
    if (physics.rafId) cancelAnimationFrame(physics.rafId);
    physics.worlds = [];
  }

  function makeWorld(containerEl) {
    const bodies = new Map();
    const folders = Array.from(containerEl.querySelectorAll(':scope > .folder'));
    folders.forEach(el => {
      const r = el.getBoundingClientRect(), cr = containerEl.getBoundingClientRect();
      el.style.position = 'absolute';
      el.style.left = r.left - cr.left + 'px';
      el.style.top  = r.top - cr.top + 'px';
      bodies.set(el, { el, x: r.left - cr.left, y: r.top - cr.top, vx: 0, vy: 0 });
    });
    return { el: containerEl, bodies };
  }

  function tickPhysics(now) {
    physics.rafId = requestAnimationFrame(tickPhysics);
    const dt = Math.min((now - physics.lastTime) / 1000, 1/30);
    physics.lastTime = now;
    physics.worlds.forEach(w => stepWorld(w, dt));
  }

  function stepWorld(world, dt) {
    const W = world.el.clientWidth, H = world.el.clientHeight;
    world.bodies.forEach(b => {
      b.vy += physics.G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y + 100 > H) { b.y = H - 100; b.vy *= -0.4; }
      if (b.x < 0) { b.x = 0; b.vx *= -0.4; }
      if (b.x + 100 > W) { b.x = W - 100; b.vx *= -0.4; }
      b.el.style.left = `${b.x}px`; b.el.style.top = `${b.y}px`;
    });
  }

  /* ===============================
     Text-to-Speech
  ================================= */
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoicesOnce() {
    if (!synth) return;
    const load = () => { voices = synth.getVoices() || []; };
    load();
    synth.addEventListener('voiceschanged', load, { once: true });
  }
  function findVoiceByName(name) {
    const lower = name.toLowerCase();
    return voices.find(v => (v.name || '').toLowerCase().includes(lower));
  }
  function parseSpeakArgs(args) {
    const opts = { text: '', voice: '', lang: '', rate: 1, pitch: 1, volume: 1, list: false, stop: false };
    const parts = [...args];
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i], n = parts[i+1];
      if (a === '--list') { opts.list = true; parts.splice(i,1); i--; }
      else if (a === '--stop') { opts.stop = true; parts.splice(i,1); i--; }
      else if (a === '--voice' && n) { opts.voice = n; parts.splice(i,2); i--; }
      else if (a === '--lang' && n) { opts.lang = n; parts.splice(i,2); i--; }
      else if (a === '--rate' && n) { opts.rate = parseFloat(n); parts.splice(i,2); i--; }
      else if (a === '--pitch' && n) { opts.pitch = parseFloat(n); parts.splice(i,2); i--; }
      else if (a === '--vol' && n) { opts.volume = parseFloat(n); parts.splice(i,2); i--; }
    }
    opts.text = parts.join(' ').trim();
    return opts;
  }

  /* ===============================
     Fun Extras
  ================================= */
  const FORTUNES = [
    "Trust the glitch — it knows the route.",
    "The crowd is a synthesizer; tune it, don’t fight it.",
    "Latency is just suspense with better branding.",
    "Rehearse chaos until it sounds intentional.",
    "Your next release already exists—go find it."
  ];
  const LINKS = { Website: location.origin, Instagram: "#", Bandcamp: "#", Spotify: "#", YouTube: "#" };

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }

  let matrixTimer = null;

function startMatrix(seconds = 5) {
  stopMatrix();

  // Ensure the terminal "screen" is a positioning context
  const cs = getComputedStyle(screen);
  if (cs.position === 'static') {
    screen.style.position = 'relative';
  }

  const overlay = document.createElement('div');
  overlay.className = 'matrix-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',           // <-- was inset: 0 (as number) which is ignored
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: '9999',        // make sure it’s above .terminal-line
    mixBlendMode: 'normal' // tweak if you want fancy compositing
  });

  const cols = Math.max(12, Math.floor(screen.clientWidth / 18));
  const charset = "01△◇□◆░▒▓#*$@";
  for (let i = 0; i < cols; i++) {
    const col = document.createElement('div');
    Object.assign(col.style, {
      position: 'absolute',
      left: `${(i / cols) * 100}%`,
      top: '-100%',
      whiteSpace: 'pre',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '12px',
      color: '#00ff66',
      textShadow: '0 0 6px rgba(0,255,102,.6)',
      opacity: '0.85',
      transform: 'translateY(-100%)'
    });

    col.textContent = Array.from({ length: 100 }, () =>
      charset.charAt((Math.random() * charset.length) | 0)
    ).join('\n');

    overlay.appendChild(col);

    const duration = 3000 + Math.random() * 2500;
    col.animate(
      [{ transform: 'translateY(-100%)' }, { transform: 'translateY(220%)' }],
      { duration, iterations: Infinity, easing: 'linear', delay: Math.random() * 1500 }
    );
  }

  screen.appendChild(overlay);
  matrixTimer = setTimeout(stopMatrix, seconds * 1000);
}

function stopMatrix() {
  if (matrixTimer) {
    clearTimeout(matrixTimer);
    matrixTimer = null;
  }
  const overlay = screen.querySelector('.matrix-overlay');
  if (overlay) overlay.remove();
}

  function ensureRainbowCSS() {
    if (document.getElementById('term-rainbow-style')) return;
    const style = document.createElement('style');
    style.id = 'term-rainbow-style';
    style.textContent = `
      @keyframes aeHue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
      .terminal-rainbow { animation: aeHue 6s linear infinite; }
    `;
    document.head.appendChild(style);
  }

  /* ===============================
     Commands
  ================================= */
  const history = [];
  let historyIndex = -1;

  const commands = {
    help() {
      writeLine([
        'Available commands:',
        '  help',
        '  clear',
        '  ls',
        '  artist [name]',
        '  trash',
        '  fetch',
        '  echo [text]              - prints text',
        '  speak [...opts] "text"   — Text-to-speech (use --list)',
        '  fetch                    — Show label/system info',
        '  share                    — Copy a shareable link',
        '  linktree                 — Show clickable links',
        '  fortune                  — Random fortune',
        '  matrix [seconds]         — Matrix rain overlay',
        '  rainbow on|off           — Color cycle',
        '  physics g [number].      — Change gravity',
        '  physics boom [number]    — Physics xplosion',
        '  physics hop              — Jump'
      ].join('\n'));
    },

    clear() { screen.innerHTML = ''; },

    ls() {
      const items = getDesktopFolders().map(f => f.name).sort();
      writeLine(items.length ? items.join('\n') : '(no folders)');
    },

    open(args) {
      const name = args.join(' ').trim();
      if (!name) return writeLine('Usage: open <folder name>', 'err');
      const ok = openByName(name);
      writeLine(ok ? `Opening “${escapeHTML(name)}”…` : `Folder not found: ${escapeHTML(name)}`, ok ? '' : 'err');
    },
    artist(args){ return this.open(args); },

    trash() {
      const btn = document.querySelector('.dock-item[data-window="trash-window"]');
      if (btn) btn.click(); else writeLine('Trash not found.', 'err');
    },

    echo(args){ writeLine(args.join(' ')); },
    date(){ writeLine(new Date().toString()); },
    whoami(){ writeLine('guest'); },
    pwd(){ writeLine('~/Desktop'); },

    history(){
      if (!history.length) return writeLine('(empty)');
      history.forEach((h,i)=>writeLine(`${i+1} ${escapeHTML(h)}`));
    },

    fetch(){
      const artistCount = document.querySelectorAll('#artists-window .window-content .folder').length;
      const openWindows = Array.from(document.querySelectorAll('.window')).filter(w=>w.style.display!=='none').length;
      writeLine([
        'æ System Fetch:',
        `  Artists: ${artistCount}`,
        `  Open windows: ${openWindows}`,
        `  Physics: ${window.PHYSICS_ON ? 'ON' : 'OFF'}`,
        `  Viewport: ${window.innerWidth}x${window.innerHeight}`,
        `  Time: ${new Date().toLocaleString()}`
      ].join('\n'));
    },

    linktree(){
      const lines = Object.entries(LINKS).map(([k,v])=>`• <a href="${v}" target="_blank">${escapeHTML(k)}</a>`);
      writeLine(lines.join('\n'));
    },

    async share(){
      const snippet = `æ — come click around the desktop. ${location.href}`;
      try { await copyToClipboard(snippet); writeLine('🔗 Copied to clipboard.'); }
      catch { writeLine('Clipboard unavailable. ' + snippet); }
    },

    fortune(){
      const f = FORTUNES[Math.floor(Math.random()*FORTUNES.length)];
      writeLine('✨ ' + f);
    },

    matrix(args){
      const sec = Math.max(1, Math.min(20, parseFloat(args[0]) || 5));
      startMatrix(sec);
      writeLine(`🟩 Matrix for ${sec}s…`);
    },

    rainbow(args){
      ensureRainbowCSS();
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'on' || !sub){ screen.classList.add('terminal-rainbow'); writeLine('🌈 Rainbow ON'); }
      else if (sub === 'off'){ screen.classList.remove('terminal-rainbow'); writeLine('🌈 Rainbow OFF'); }
      else writeLine('Usage: rainbow on|off', 'err');
    },

    physics(args){
      const sub = (args[0] || '').toLowerCase();
      const hasExt = !!(window.physics && window.physics.enable);
      if (sub === 'on'){ (hasExt ? window.physics.enable() : enablePhysics()); writeLine('Physics: ON.'); return; }
      if (sub === 'off'){ (hasExt ? window.physics.disable() : disablePhysics()); writeLine('Physics: OFF.'); return; }
      if (sub === 'g' && window.physics?.setGravity){
        const val = Number(args[1]);
        if (!isFinite(val)) return writeLine('Usage: physics g <number>', 'err');
        window.physics.setGravity(val); writeLine(`Gravity set to ${val}.`); return;
      }
      if (sub === 'boom' && window.physics?.impulseAll){
        const power = Number(args[1]) || 1200;
        window.physics.impulseAll({ power }); writeLine(`💥 Impulse fired (${power}).`); return;
      }
      if (sub === 'hop' && window.physics?.hopAll){
        const vy = Number(args[1]) || -1200;
        window.physics.hopAll({ vy }); writeLine(`🟢 Hop (${vy}).`); return;
      }
      writeLine('Usage: physics on|off | g <val> | boom [pwr] | hop [vy]', 'err');
    },

    speak(args){
    if (!window.speechSynthesis) return writeLine('Speech synthesis not supported.', 'err');
    loadVoicesOnce();
    const opts = parseSpeakArgs(args);

    // Stop / list
    if (opts.stop){ speechSynthesis.cancel(); return writeLine('🔇 Stopped.'); }
    if (opts.list){ 
        if (!voices.length) return writeLine('(No voices yet — try again.)');
        writeLine('Voices:\n' + voices.map(v=>`• ${v.name} (${v.lang})${v.default?' [default]':''}`).join('\n')); 
        return; 
    }

    // Default: if no text, show usage
    if (!opts.text) return writeLine('Usage: speak [--list] [--voice "Name"] "text"', 'err');

    // ---- 🌸 DEFAULT FEMALE VOICE ----
    // Find a female-like voice if none was specified
    if (!opts.voice && voices.length) {
        const female = voices.find(v => /female|woman|susan|salli|emma|linda|olivia|fiona|UK English/i.test(v.name));
        if (female) opts.voice = female.name;
        else opts.voice = voices.find(v => /en/i.test(v.lang))?.name || '';
    }

    // Create utterance
    const utter = new SpeechSynthesisUtterance(opts.text);
    if (opts.lang) utter.lang = opts.lang;
    utter.rate = opts.rate || 1;
    utter.volume = opts.volume || 1;

    // Pitch up 4 semitones ≈ pitch 1.26
    utter.pitch = opts.pitch || 12;

    // Set the chosen (female) voice
    const v = findVoiceByName(opts.voice);
    if (v) utter.voice = v;

    utter.onstart = ()=>writeLine(`🗣️ Speaking with ${v?.name || 'default'}…`);
    utter.onend = ()=>writeLine('✅ Done.');
    speechSynthesis.speak(utter);
    }
  };

  /* ===============================
     Command Runner & Input
  ================================= */
  function runCommand(raw) {
    const line = raw.trim();
    if (!line) return;
    writePrompted(line);
    const [cmd, ...rest] = tokenize(line);
    const fn = commands[cmd];
    if (fn) try { fn(rest); } catch (e) { writeLine(String(e), 'err'); }
    else writeLine(`Command not found: ${escapeHTML(cmd)}`, 'err');
  }

  function tokenize(s) {
    const out = []; let buf = '', q = null;
    for (const c of s) {
      if (q) { if (c === q) q = null; else buf += c; }
      else if (c === '"' || c === "'") q = c;
      else if (/\s/.test(c)) { if (buf) { out.push(buf); buf=''; } }
      else buf += c;
    }
    if (buf) out.push(buf);
    return out;
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value;
      if (v.trim()) { history.push(v); historyIndex = history.length; }
      runCommand(v);
      input.value = '';
    } else if (e.key === 'ArrowUp') {
      if (history.length) { historyIndex = Math.max(0, historyIndex - 1); input.value = history[historyIndex] || ''; }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (history.length) { historyIndex = Math.min(history.length, historyIndex + 1); input.value = historyIndex === history.length ? '' : (history[historyIndex] || ''); }
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault(); commands.clear();
    }
  });

  const termWin = document.getElementById('terminal-window');
  if (termWin) {
    termWin.addEventListener('mousedown', () => setTimeout(() => input.focus(), 0));
    new MutationObserver(() => {
      if (termWin.style.display !== 'none') setTimeout(() => input.focus(), 0);
    }).observe(termWin, { attributes: true, attributeFilter: ['style'] });
  }

  writeLine('æ Terminal — type "help" to get started.');
  input.placeholder = 'Type a command…';
  setTimeout(() => { input.focus(); loadVoicesOnce(); }, 0);
})();
