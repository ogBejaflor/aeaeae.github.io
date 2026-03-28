document.addEventListener('DOMContentLoaded', () => {
  const galleryData = window.aeGalleryData || [];
  
  const contentEl = document.getElementById('gallery-content');
  
  const lightbox = document.getElementById('gallery-lightbox');
  const lightboxMediaContainer = document.getElementById('lightbox-media-container');
  const btnClose = document.getElementById('lightbox-close');
  const btnPrev = document.getElementById('lightbox-prev');
  const btnNext = document.getElementById('lightbox-next');

  let currentIndex = -1;

  function renderGallery() {
    contentEl.innerHTML = '';
    contentEl.className = 'gallery-grid';

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

      itemEl.innerHTML = mediaHtml;

      // Click to open lightbox
      itemEl.addEventListener('click', () => openLightbox(index));

      // Handle hover video playback nicely in grid
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

  // Lightbox controls
  btnClose.addEventListener('click', closeLightbox);
  btnNext.addEventListener('click', showNext);
  btnPrev.addEventListener('click', showPrev);

  // Initial render
  renderGallery();
});
