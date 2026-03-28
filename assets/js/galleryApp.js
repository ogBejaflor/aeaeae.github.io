document.addEventListener('DOMContentLoaded', () => {
  const galleryData = window.aeGalleryData || [];
  
  const contentEl = document.getElementById('gallery-content');
  const btnGrid = document.getElementById('view-grid');
  const btnList = document.getElementById('view-list');
  
  const lightbox = document.getElementById('gallery-lightbox');
  const lightboxMediaContainer = document.getElementById('lightbox-media-container');
  const btnClose = document.getElementById('lightbox-close');
  const btnPrev = document.getElementById('lightbox-prev');
  const btnNext = document.getElementById('lightbox-next');

  let currentView = 'grid'; // 'grid' | 'list'
  let currentIndex = -1;

  function renderGallery() {
    contentEl.innerHTML = '';
    contentEl.className = currentView === 'grid' ? 'gallery-grid' : 'gallery-list';

    if (galleryData.length === 0) {
      contentEl.innerHTML = '<p style="padding: 20px; color: #888;">No media found. Upload files to Archive or Catalogo.</p>';
      return;
    }

    galleryData.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'gallery-item';
      itemEl.dataset.index = index;

      let mediaHtml = '';
      if (item.type === 'image') {
        mediaHtml = `<img src="${item.src}" alt="${item.filename}" loading="lazy" />`;
      } else if (item.type === 'video') {
        mediaHtml = `<video src="${item.src}" muted loop playsinline></video>`;
      }

      let infoHtml = '';
      if (currentView === 'list') {
        infoHtml = `<div class="gallery-item-info">
                      <span class="gallery-item-name">${item.filename}</span>
                      <span class="gallery-item-dir">${item.directory}</span>
                    </div>`;
      }

      itemEl.innerHTML = mediaHtml + infoHtml;

      // Click to open lightbox
      itemEl.addEventListener('click', () => openLightbox(index));

      // Handle hover video playback nicely in grid
      if (item.type === 'video' && currentView === 'grid') {
        const vid = itemEl.querySelector('video');
        itemEl.addEventListener('mouseenter', () => vid && vid.play().catch(()=>{}));
        itemEl.addEventListener('mouseleave', () => {
          if (vid) {
            vid.pause();
            vid.currentTime = 0;
          }
        });
      }

      contentEl.appendChild(itemEl);
    });
  }

  function openLightbox(index) {
    currentIndex = index;
    updateLightboxContent();
    lightbox.style.display = 'flex';
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lightboxMediaContainer.innerHTML = ''; // Stop video playback
    currentIndex = -1;
  }

  function showNext() {
    if (currentIndex < galleryData.length - 1) {
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
    if (currentIndex < 0 || currentIndex >= galleryData.length) return;
    
    const item = galleryData[currentIndex];
    
    if (item.type === 'image') {
      lightboxMediaContainer.innerHTML = `<img src="${item.src}" alt="${item.filename}" />`;
    } else if (item.type === 'video') {
      lightboxMediaContainer.innerHTML = `<video src="${item.src}" controls autoplay loop playsinline></video>`;
    }

    // Button states
    btnPrev.style.opacity = currentIndex === 0 ? '0.2' : '1';
    btnPrev.style.pointerEvents = currentIndex === 0 ? 'none' : 'auto';
    
    btnNext.style.opacity = currentIndex === galleryData.length - 1 ? '0.2' : '1';
    btnNext.style.pointerEvents = currentIndex === galleryData.length - 1 ? 'none' : 'auto';
  }

  // View switchers
  btnGrid.addEventListener('click', () => {
    currentView = 'grid';
    btnGrid.classList.add('active');
    btnList.classList.remove('active');
    renderGallery();
  });

  btnList.addEventListener('click', () => {
    currentView = 'list';
    btnList.classList.add('active');
    btnGrid.classList.remove('active');
    renderGallery();
  });

  // Lightbox controls
  btnClose.addEventListener('click', closeLightbox);
  btnNext.addEventListener('click', showNext);
  btnPrev.addEventListener('click', showPrev);

  // Initial render
  renderGallery();
});
