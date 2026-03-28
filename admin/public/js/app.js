document.addEventListener('DOMContentLoaded', () => {

  // --- TAB NAVIGATION ---
  const navMusic = document.getElementById('nav-music');
  const navNotify = document.getElementById('nav-notify');
  const navDeploy = document.getElementById('nav-deploy');
  
  const secMusic = document.getElementById('sec-music');
  const secNotify = document.getElementById('sec-notify');
  const secDeploy = document.getElementById('sec-deploy');

  function switchTab(nav, sec) {
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    nav.classList.add('active');
    sec.classList.add('active');
  }

  navMusic.addEventListener('click', (e) => { e.preventDefault(); switchTab(navMusic, secMusic); });
  navNotify.addEventListener('click', (e) => { e.preventDefault(); switchTab(navNotify, secNotify); renderNotifyList(); });
  navDeploy.addEventListener('click', (e) => { e.preventDefault(); switchTab(navDeploy, secDeploy); });

  // --- NOTIFICATIONS MANAGEMENT ---
  let notifications = [];
  const notifyListEl = document.getElementById('notify-list');
  
  async function loadNotifications() {
    try {
      const res = await fetch('/api/notifications');
      notifications = await res.json();
    } catch (e) {
      console.error(e);
      notifications = [];
    }
  }

  function renderNotifyList() {
    notifyListEl.innerHTML = '';
    if (notifications.length === 0) {
      notifyListEl.innerHTML = '<p>No notifications configured.</p>';
      return;
    }
    
    notifications.forEach((note, index) => {
      const div = document.createElement('div');
      div.style.background = 'rgba(255,255,255,0.05)';
      div.style.padding = '10px';
      div.style.marginBottom = '10px';
      div.style.borderRadius = '4px';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';

      div.innerHTML = `
        <div>
          <strong>${note.title}</strong>
          <p style="margin: 5px 0 0 0; color: #aaa; font-size: 0.9rem;">${note.body}</p>
        </div>
        <button class="btn destructive" data-index="${index}" style="padding: 5px 10px; font-size: 0.8rem;">Remove</button>
      `;
      
      div.querySelector('button').addEventListener('click', (e) => {
        const idx = e.target.getAttribute('data-index');
        notifications.splice(idx, 1);
        renderNotifyList();
      });
      
      notifyListEl.appendChild(div);
    });
  }

  const notifyForm = document.getElementById('notify-form');
  notifyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = document.getElementById('n-title').value;
    const b = document.getElementById('n-body').value;
    notifications.push({ title: t, body: b });
    notifyForm.reset();
    renderNotifyList();
  });

  const btnSaveNotify = document.getElementById('btn-save-notify');
  const notifyStatus = document.getElementById('notify-status');

  btnSaveNotify.addEventListener('click', async () => {
    btnSaveNotify.disabled = true;
    notifyStatus.className = 'alert mt-10';
    notifyStatus.innerText = 'Saving and rebuilding...';

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications })
      });
      const json = await res.json();
      
      if (json.success) {
        notifyStatus.className = 'alert success mt-10';
        notifyStatus.innerText = 'Notifications successfully updated!';
      } else {
        throw new Error(json.error || 'Failed to save notifications');
      }
    } catch (err) {
      notifyStatus.className = 'alert error mt-10';
      notifyStatus.innerText = err.message;
    } finally {
      btnSaveNotify.disabled = false;
    }
  });

  // Initial load
  loadNotifications();

  // --- UPLOAD TRACK ---
  const uploadForm = document.getElementById('upload-form');
  const uploadStatus = document.getElementById('upload-status');

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = uploadForm.querySelector('button');
    btn.disabled = true;
    btn.innerText = 'Uploading...';
    
    uploadStatus.className = 'alert mt-10';
    uploadStatus.innerText = 'Uploading files, please wait...';

    const formData = new FormData(uploadForm);

    try {
      const res = await fetch('/api/upload-track', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();
      
      if (json.success) {
        uploadStatus.className = 'alert success mt-10';
        uploadStatus.innerText = 'Upload successful!';
        uploadForm.reset();
      } else {
        throw new Error(json.message || 'Unknown error');
      }
    } catch (err) {
      uploadStatus.className = 'alert error mt-10';
      uploadStatus.innerText = 'Upload failed: ' + err.message;
    } finally {
      btn.disabled = false;
      btn.innerText = 'Upload to Catalog';
    }
  });

  // --- REBUILD CATALOG ---
  const btnRebuild = document.getElementById('btn-rebuild');
  const rebuildStatus = document.getElementById('rebuild-status');

  btnRebuild.addEventListener('click', async () => {
    btnRebuild.disabled = true;
    btnRebuild.innerText = 'Rebuilding...';
    rebuildStatus.className = 'alert mt-10';
    rebuildStatus.innerText = 'Running background script...';

    try {
      const res = await fetch('/api/build-catalog', { method: 'POST' });
      const json = await res.json();
      
      if (json.success) {
        rebuildStatus.className = 'alert success mt-10';
        rebuildStatus.innerText = 'Catalog rebuilt successfully! Changes are ready.';
      } else {
        throw new Error('Rebuild failed. Check console.');
      }
    } catch (err) {
      rebuildStatus.className = 'alert error mt-10';
      rebuildStatus.innerText = err.message;
    } finally {
      btnRebuild.disabled = false;
      btnRebuild.innerText = 'Rebuild Catalog Index';
    }
  });

  // --- PUBLISH TO GITHUB ---
  const btnPublish = document.getElementById('btn-publish');
  const publishStatus = document.getElementById('publish-status');

  btnPublish.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to push all changes to the live site?')) return;

    btnPublish.disabled = true;
    btnPublish.innerText = 'Committing and Pushing...';
    publishStatus.className = 'alert mt-10';
    publishStatus.innerText = 'Running Git commands, do not close...';

    try {
      const res = await fetch('/api/publish', { method: 'POST' });
      const json = await res.json();
      
      if (json.success) {
        publishStatus.className = 'alert success mt-10';
        publishStatus.innerText = 'Site successfully published to GitHub!';
      } else {
        throw new Error(json.output || 'Publish failed.');
      }
    } catch (err) {
      publishStatus.className = 'alert error mt-10';
      publishStatus.innerText = 'Error publishing: ' + err.message;
    } finally {
      btnPublish.disabled = false;
      btnPublish.innerText = 'Commit & Push to Live';
    }
  });

});
