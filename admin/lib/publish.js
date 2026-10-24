// admin/lib/publish.js
// "Publish" = commit everything that changed and push it to GitHub. GitHub Pages then
// rebuilds the live site (usually within a minute or two).
// On a real host (SITE_MODE=hosted) edits are live straight away and this isn't used.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../scripts/build.js');

const GITHUB_LIMIT = 95 * 1024 * 1024; // GitHub refuses files over 100 MB

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { raw, ...rest } = opts;
    execFile('git', args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, ...rest }, (err, stdout, stderr) => {
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

async function status() {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { available: false, reason: "This copy of the site isn't a git repository, so it can't publish." };
  }
  let remote = '';
  try { remote = await git(['remote', 'get-url', 'origin']); } catch { /* no remote */ }
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '?');
  const raw = await git(['status', '--porcelain', '-uall', '-z'], { raw: true });
  const changes = [];
  const parts = raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (code.includes('R')) i++; // rename: next entry is the old name
    changes.push({ file, change: describe(code) });
  }
  let ahead = 0;
  try { ahead = Number(await git(['rev-list', '--count', '@{u}..HEAD'])) || 0; } catch { /* no upstream */ }
  return {
    available: !!remote,
    reason: remote ? null : 'No GitHub remote is set up for this folder.',
    remote,
    branch,
    liveBranch: 'main',
    changes,
    ahead,
  };
}

async function publish(message) {
  const st = await status();
  if (!st.available) throw Object.assign(new Error(st.reason), { status: 400 });
  if (!st.changes.length && !st.ahead) return { ok: true, nothing: true, log: 'Nothing new to publish.' };

  const log = [];
  if (st.changes.length) {
    const tooBig = st.changes
      .filter((c) => c.change !== 'removed')
      .map((c) => ({ ...c, size: (() => { try { return fs.statSync(path.join(ROOT, c.file)).size; } catch { return 0; } })() }))
      .filter((c) => c.size > GITHUB_LIMIT);
    if (tooBig.length) {
      const list = tooBig.map((c) => `• ${c.file} (${Math.round(c.size / 1048576)} MB)`).join('\n');
      throw Object.assign(new Error(`GitHub won't accept files over 100 MB:\n${list}\nUse an MP3 version instead (Albums → “Make MP3s”), then delete the big file.`), { status: 400 });
    }
    await git(['add', '-A']);
    const msg = (message || '').trim() || `Content update (${st.changes.length} file${st.changes.length === 1 ? '' : 's'})`;
    log.push(await git(['commit', '-m', msg]));
  }

  try {
    log.push(await git(['pull', '--rebase', '--autostash']));
  } catch (e) {
    await git(['rebase', '--abort']).catch(() => {});
    throw Object.assign(new Error(`Your changes are saved on this computer, but GitHub has newer changes that clash with them. Ask for help merging.\n\n${e.output || e.message}`), { status: 409 });
  }
  try {
    log.push(await git(['push'], { timeout: 30 * 60 * 1000 }));
  } catch (e) {
    throw Object.assign(new Error(`Saved on this computer, but pushing to GitHub failed:\n\n${e.output || e.message}`), { status: 502 });
  }
  return { ok: true, branch: st.branch, log: log.filter(Boolean).join('\n') };
}

module.exports = { status, publish };
