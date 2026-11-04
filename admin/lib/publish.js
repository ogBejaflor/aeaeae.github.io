// admin/lib/publish.js
// "Publish" = commit everything that changed and push it to GitHub. GitHub Pages then
// rebuilds the live site (usually within a minute or two).
// On a real host (SITE_MODE=hosted) edits are live straight away and this isn't used.
//
// Publish sorts out the clashes it safely can by itself:
//   • computer clutter (node_modules, .DS_Store, the admin's own folders) is never published
//   • the generated data files (assets/js/*Data.js, siteSettings.js) are rebuilt after syncing
// Only a real clash in your content (e.g. the same pop-up edited here and on GitHub) stops it.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const build = require('../../scripts/build.js');

const { ROOT } = build;
const GITHUB_LIMIT = 95 * 1024 * 1024; // GitHub refuses files over 100 MB

// Never published. Matches .gitignore.
const JUNK = [
  ':(glob)**/node_modules/**',
  ':(glob)**/.DS_Store',
  ':(glob)admin/.trash/**',
  ':(glob)admin/.tmp/**',
];
const isJunk = (f) => /(^|\/)node_modules\//.test(f) || /(^|\/)\.DS_Store$/.test(f) || /^admin\/\.(trash|tmp)\//.test(f);

// Rebuilt from the content, so whichever version wins a clash doesn't matter.
const GENERATED = new Set([
  'assets/js/musicData.js',
  'assets/js/notificationsData.js',
  'assets/js/galleryData.js',
  'assets/js/siteSettings.js',
]);

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { raw, ...rest } = opts;
    execFile('git', args, {
      cwd: ROOT,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' },
      ...rest,
    }, (err, stdout, stderr) => {
      if (err) {
        err.output = `${stdout || ''}${stderr || ''}`.trim();
        return reject(err);
      }
      resolve(raw ? stdout : `${stdout || ''}${stderr || ''}`.trim());
    });
  });
}

function describe(code) {
  if (code.includes('?') || code.includes('A')) return 'added';
  if (code.includes('D')) return 'removed';
  if (code.includes('R')) return 'renamed';
  return 'changed';
}

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const rebaseInProgress = () => exists('.git/rebase-merge') || exists('.git/rebase-apply');
const mergeInProgress = () => exists('.git/MERGE_HEAD');

// Stage everything except clutter, and stop tracking clutter that older versions committed.
async function stageAll() {
  await git(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', ...JUNK]);
  await git(['add', '-A', '--', '.', ...JUNK.map((p) => p.replace(':(glob)', ':(exclude,glob)'))]);
}

async function changedFiles() {
  const raw = await git(['status', '--porcelain', '-uall', '-z'], { raw: true });
  const out = [];
  const parts = raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (code.includes('R')) i++; // rename: next entry is the old name
    out.push({ file, change: describe(code), junk: isJunk(file) });
  }
  return out;
}

async function status() {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { available: false, reason: "This copy of the site isn't a git repository, so it can't publish." };
  }
  let remote = '';
  try { remote = await git(['remote', 'get-url', 'origin']); } catch { /* no remote */ }
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '?');
  const all = await changedFiles();
  // Tracked clutter that's about to be dropped still counts as something to publish.
  const changes = all.filter((c) => !c.junk || c.change !== 'added').map(({ junk, ...c }) => (junk ? { ...c, change: 'cleanup' } : c));
  let ahead = 0;
  try { ahead = Number(await git(['rev-list', '--count', '@{u}..HEAD'])) || 0; } catch { /* no upstream */ }
  const stuck = rebaseInProgress() || mergeInProgress();
  return {
    available: !!remote,
    reason: remote ? null : 'No GitHub remote is set up for this folder.',
    remote,
    branch,
    liveBranch: 'main',
    changes: changes.filter((c) => c.change !== 'cleanup'),
    cleanup: changes.filter((c) => c.change === 'cleanup').length,
    ahead,
    stuck,
  };
}

// Pull GitHub's latest and replay ours on top, settling clutter/generated clashes automatically.
async function syncWithGitHub(log) {
  try {
    log.push(await git(['pull', '--rebase', '--autostash']));
    return;
  } catch (e) {
    if (!rebaseInProgress()) throw e;
    log.push(e.output || e.message);
  }

  for (let step = 0; step < 500; step++) {
    const conflicted = (await git(['diff', '--name-only', '--diff-filter=U', '-z'], { raw: true })).split('\0').filter(Boolean);
    const real = conflicted.filter((f) => !isJunk(f) && !GENERATED.has(f));
    if (real.length) {
      await git(['rebase', '--abort']).catch(() => {});
      const list = real.map((f) => `• ${f}`).join('\n');
      throw Object.assign(new Error(
        `The same thing was changed here and on GitHub, so Publish stopped without changing anything:\n${list}\n\nYour edits are safe on this computer. Ask for help merging these files.`,
      ), { status: 409 });
    }
    for (const f of conflicted) {
      if (isJunk(f)) await git(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', f]);
      else { await git(['checkout', '--ours', '--', f]).catch(() => {}); await git(['add', '-A', '--', f]); }
    }
    await git(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', ...JUNK]);

    try {
      // nothing left to commit for this step (it only touched clutter) → skip it
      const staged = await git(['diff', '--cached', '--name-only']);
      log.push(await git(staged ? ['rebase', '--continue'] : ['rebase', '--skip']));
      if (!rebaseInProgress()) return;
    } catch (e) {
      if (!rebaseInProgress()) throw e;
      log.push(e.output || e.message);
    }
  }
  await git(['rebase', '--abort']).catch(() => {});
  throw Object.assign(new Error('Publish got stuck syncing with GitHub and undid its attempt. Your edits are safe on this computer.'), { status: 409 });
}

async function publish(message) {
  const st = await status();
  if (!st.available) throw Object.assign(new Error(st.reason), { status: 400 });

  // A sync that was interrupted earlier: undo it so we start clean (edits stay).
  if (rebaseInProgress()) await git(['rebase', '--abort']).catch(() => {});
  if (mergeInProgress()) await git(['merge', '--abort']).catch(() => {});

  const log = [];
  const pending = await changedFiles();
  if (pending.length) {
    const tooBig = pending
      .filter((c) => !c.junk && c.change !== 'removed')
      .map((c) => ({ ...c, size: (() => { try { return fs.statSync(path.join(ROOT, c.file)).size; } catch { return 0; } })() }))
      .filter((c) => c.size > GITHUB_LIMIT);
    if (tooBig.length) {
      const list = tooBig.map((c) => `• ${c.file} (${Math.round(c.size / 1048576)} MB)`).join('\n');
      throw Object.assign(new Error(`GitHub won't accept files over 100 MB:\n${list}\nUse an MP3 version instead (Albums → “Make MP3s”), then delete the big file.`), { status: 400 });
    }
    await stageAll();
    const staged = (await git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
    if (staged.length) {
      const real = staged.filter((f) => !isJunk(f)).length;
      const msg = (message || '').trim() || (real ? `Content update (${real} file${real === 1 ? '' : 's'})` : 'Tidy up: stop tracking computer clutter');
      log.push(await git(['commit', '-m', msg]));
    }
  }

  try {
    await syncWithGitHub(log);
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error(`Couldn't get the latest from GitHub, so nothing was published. Your edits are safe on this computer.\n\n${e.output || e.message}`), { status: 502 });
  }

  // The data files may have come from either side of a clash — rebuild them from the content.
  build.buildAll();
  await stageAll();
  if (await git(['diff', '--cached', '--name-only'])) log.push(await git(['commit', '-m', 'Rebuild site data']));

  let ahead = 0;
  try { ahead = Number(await git(['rev-list', '--count', '@{u}..HEAD'])) || 0; } catch { ahead = 1; }
  if (!ahead) return { ok: true, nothing: true, log: 'Nothing new to publish.' };

  try {
    log.push(await git(['push'], { timeout: 30 * 60 * 1000 }));
  } catch (e) {
    throw Object.assign(new Error(`Saved on this computer, but sending to GitHub failed:\n\n${e.output || e.message}`), { status: 502 });
  }
  return { ok: true, branch: st.branch, log: log.filter(Boolean).join('\n') };
}

module.exports = { status, publish };
