document.addEventListener('DOMContentLoaded', () => {
  const galleryData = window.aeGalleryData || [];
  
  const contentEl = document.getElementById('gallery-content');
  const lightbox = document.getElementById('gallery-lightbox');
  const lightboxMediaContainer = document.getElementById('lightbox-media-container');
  const btnClose = document.getElementById('lightbox-close');
  const btnPrev = document.getElementById('lightbox-prev');
  const btnNext = document.getElementById('lightbox-next');

  let folders = {};
  let currentFolderName = null; // null means viewing folders
  let currentIndex = -1;

  function buildFolders() {
    folders = { "All": [...galleryData], "Covers": [], "Videos": [] };

    galleryData.forEach(item => {
      const dir = item.directory || '';
      
      if (item.type === 'video') folders["Videos"].push(item);
      if (item.filename.toLowerCase().includes('cover')) folders["Covers"].push(item);

      if (dir.startsWith('Archive/')) {
        const sub = dir.substring(8);
        if (sub) {
          const folderName = sub.split('/')[0];
          if (!folders[folderName]) folders[folderName] = [];
          if (!folders[folderName].includes(item)) folders[folderName].push(item);
        }
      } else if (dir.startsWith('Catalogo/')) {
        const parts = dir.split('/');
        if (parts.length > 1) {
          const artist = parts[1];
          // E.g. Bejaflor
          if (!folders[artist]) folders[artist] = [];
          if (!folders[artist].includes(item)) folders[artist].push(item);
        }
      }
    });

    // Remove empty hardcoded folders
    Object.keys(folders).forEach(k => {
      if (folders[k].length === 0) delete folders[k];
    });
  }

  function renderFolders() {
    contentEl.className = 'gallery-folders-view';
    contentEl.innerHTML = '';
    
    if (galleryData.length === 0) {
      contentEl.innerHTML = '<p style="padding: 20px; color: #888;">No media found. Upload files to Archive.</p>';
      return;
    }

    Object.keys(folders).forEach(folderName => {
      const folderItems = folders[folderName];
      const folderEl = document.createElement('div');
      folderEl.className = 'gallery-folder';
      
      // Build the pile
      const pileEl = document.createElement('div');
      pileEl.className = 'folder-pile';
      
      // Get up to 3 thumbnails
      const thumbs = folderItems.slice(0, 3).reverse(); // reverse so the first item is on top (last in DOM)
      
      if (thumbs.length === 0) {
        pileEl.innerHTML = '<div class="empty-pile"></div>';
      } else {
        thumbs.forEach((thumb, i) => {
          let mediaHtml = '';
          if (thumb.type === 'image') {
            mediaHtml = `<img src="${thumb.src}" class="pile-thumb pile-thumb-${i}" loading="lazy"/>`;
          } else {
            mediaHtml = `<video src="${thumb.src}" class="pile-thumb pile-thumb-${i}" muted playsinline></video>`;
          }
          pileEl.insertAdjacentHTML('beforeend', mediaHtml);
        });
      }

      const labelEl = document.createElement('div');
      labelEl.className = 'folder-label';
      labelEl.textContent = `${folderName} (${folderItems.length})`;

      folderEl.appendChild(pileEl);
      folderEl.appendChild(labelEl);

      folderEl.addEventListener('click', () => openFolder(folderName));
      contentEl.appendChild(folderEl);
    });
  }

  function renderGrid(folderName) {
    contentEl.className = 'gallery-grid-view';
    contentEl.innerHTML = '';

    const folderItems = folders[folderName];

    // Header Back Button
    const headerEl = document.createElement('div');
    headerEl.className = 'gallery-grid-header';
    headerEl.innerHTML = `
      <button class="gallery-back-btn">&larr; Folders</button>
      <h2 class="gallery-folder-title">${folderName}</h2>
    `;
    
    const backBtn = headerEl.querySelector('.gallery-back-btn');
    backBtn.addEventListener('click', () => {
      currentFolderName = null;
      renderFolders();
    });

    contentEl.appendChild(headerEl);

    const gridEl = document.createElement('div');
    gridEl.className = 'gallery-grid';
    contentEl.appendChild(gridEl);

    folderItems.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'gallery-item';
      itemEl.dataset.index = index;
      
      let mediaHtml = '';
      if (item.type === 'image') {
        mediaHtml = `<img src="${item.src}" alt="${item.filename}" loading="lazy" />`;
      } else if (item.type === 'video') {
        mediaHtml = `<video src="${item.src}" muted loop playsinline></video>`;
      }

      itemEl.innerHTML = mediaHtml;
      itemEl.addEventListener('click', () => openLightbox(index));

      if (item.type === 'video') {
        const vid = itemEl.querySelector('video');
        itemEl.addEventListener('mouseenter', () => vid && vid.play().catch(()=>{}));
        itemEl.addEventListener('mouseleave', () => {
          if (vid) {
            vid.pause();
            vid.currentTime = 0;
          }
        });
      }

      gridEl.appendChild(itemEl);
    });
  }

  function openFolder(name) {
    currentFolderName = name;
    renderGrid(name);
  }

  function openLightbox(index) {
    currentIndex = index;
    updateLightboxContent();
    lightbox.style.display = 'flex';
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lightboxMediaContainer.innerHTML = '';
    currentIndex = -1;
  }

  function showNext() {
    const arr = folders[currentFolderName];
    if (currentIndex < arr.length - 1) {
      currentIndex++;
      updateLightboxContent();
    }
  }

  function showPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      updateLightboxContent();
    }
  }

  function updateLightboxContent() {
    const arr = folders[currentFolderName];
    if (currentIndex < 0 || currentIndex >= arr.length) return;
    
    const item = arr[currentIndex];
    
    if (item.type === 'image') {
      lightboxMediaContainer.innerHTML = `<img src="${item.src}" alt="${item.filename}" />`;
    } else if (item.type === 'video') {
      lightboxMediaContainer.innerHTML = `<video src="${item.src}" controls autoplay loop playsinline></video>`;
    }

    btnPrev.style.opacity = currentIndex === 0 ? '0.2' : '1';
    btnPrev.style.pointerEvents = currentIndex === 0 ? 'none' : 'auto';
    btnNext.style.opacity = currentIndex === arr.length - 1 ? '0.2' : '1';
    btnNext.style.pointerEvents = currentIndex === arr.length - 1 ? 'none' : 'auto';
  }

  btnClose.addEventListener('click', closeLightbox);
  btnNext.addEventListener('click', showNext);
  btnPrev.addEventListener('click', showPrev);

  // Initial render
  buildFolders();
  renderFolders();

  // --- API for Inter-App Drag and Drop ---
  window.aeGalleryAPI = {
    isOpen: () => {
      // It's open if it's visible, but actually we can just check if currentFolderName is not null to drop into it
      return currentFolderName !== null;
    },
    getItemByEl: (el) => {
      if (!currentFolderName) return null;
      const arr = folders[currentFolderName];
      // We need the index. Since renderGrid doesn't set dataset.index, let's fix renderGrid.
      const indexStr = el.dataset.index;
      if (indexStr === undefined) return null;
      const i = parseInt(indexStr);
      return arr[i] || null;
    },
    removeItem: (el) => {
      if (!currentFolderName) return;
      const indexStr = el.dataset.index;
      if (indexStr === undefined) return;
      const i = parseInt(indexStr);
      
      const arr = folders[currentFolderName];
      arr.splice(i, 1);
      
      // Also remove from master galleryData if we want to be thorough
      const masterIndex = galleryData.findIndex(item => item === arr[i]);
      if (masterIndex > -1) galleryData.splice(masterIndex, 1);

      // Re-render
      renderGrid(currentFolderName);
    },
    addItem: (itemData) => {
      if (!currentFolderName) return; // user must be inside a folder to drop!
      
      const arr = folders[currentFolderName];
      arr.push(itemData);
      
      // Also add back to master if missing
      if (!galleryData.includes(itemData)) {
        galleryData.push(itemData);
      }

      // Re-render
      renderGrid(currentFolderName);
    }
  };
});
