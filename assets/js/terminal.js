// assets/js/terminal.js

(function () {
  const screen = document.getElementById('terminal-screen');
  const input  = document.getElementById('terminal-input');
  const prompt = document.getElementById('terminal-prompt');

  if (!screen || !input || !prompt) return; // window might not be in DOM yet

  // Simple “filesystem” view helpers (read from DOM)
  function getDesktopFolders() {
    const desktop = document.getElementById('desktop');
    return Array.from(desktop.querySelectorAll(':scope > .folder')) // direct children
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

  // Utilities
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
    // exact match (case-insensitive) among ANY folder
    const all = getAllFolders();
    const target = all.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!target) return false;

    // If an “openFolder” function exists (your window system), use it
    if (typeof window.openFolder === 'function') {
      window.openFolder(target.el);
      return true;
    }
    return false;
  }

  // Commands
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
        '  history             Show command history'
      ].join('\n'));
    },

    clear() {
      screen.innerHTML = '';
    },

    ls() {
      const items = getDesktopFolders().map(f => f.name).sort((a,b)=>a.localeCompare(b));
      if (!items.length) {
        writeLine('(no folders on desktop)');
      } else {
        writeLine(items.join('\n'));
      }
    },

    open(args) {
      const name = args.join(' ').trim();
      if (!name) {
        writeLine('Usage: open <folder name>', 'err');
        return;
      }
      const ok = openByName(name);
      writeLine(ok ? `Opening “${escapeHTML(name)}”...` : `Folder not found: ${escapeHTML(name)}`, ok ? '' : 'err');
    },

    trash() {
      // open the trash window the same way the dock does
      const btn = document.querySelector('.dock-item[data-window="trash-window"]');
      if (btn) btn.click();
      else writeLine('Trash not found.', 'err');
    },

    echo(args) {
      writeLine(args.join(' '));
    },

    date() {
      writeLine(new Date().toString());
    },

    whoami() {
      writeLine('guest');
    },

    pwd() {
      writeLine('~/Desktop');
    },

    history() {
      if (!history.length) {
        writeLine('(history empty)');
        return;
      }
      history.forEach((h, i) => writeLine(`${i+1}  ${escapeHTML(h)}`));
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

  // Input handling
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
        setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      }
      e.preventDefault();
    }

    if (e.key === 'ArrowDown') {
      if (history.length) {
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = historyIndex === history.length ? '' : (history[historyIndex] ?? '');
        setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      }
      e.preventDefault();
    }

    // Ctrl+L to clear (like many terminals)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      commands.clear();
    }
  });

  // Focus input when terminal window is clicked / shown
  const termWin = document.getElementById('terminal-window');
  if (termWin) {
    termWin.addEventListener('mousedown', () => {
      setTimeout(() => input.focus(), 0);
    });
    // If your window system toggles display, refocus on show:
    const observer = new MutationObserver(() => {
      if (termWin.style.display !== 'none') setTimeout(() => input.focus(), 0);
    });
    observer.observe(termWin, { attributes: true, attributeFilter: ['style'] });
  }

  // Friendly greeting
  writeLine('æ Terminal — type "help" to get started.');
  input.placeholder = 'Type a command…';
  setTimeout(() => input.focus(), 0);
})();
