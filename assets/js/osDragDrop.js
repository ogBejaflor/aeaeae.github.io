// assets/js/osDragDrop.js
// Handles Inter-App Drag and Drop of internal elements (Gallery <-> Desktop)
(function() {
  let isDragging = false;
  let dragItem = null;
  let dragClone = null;
  let dragPayload = null; 

  let startX = 0;
  let startY = 0;
  const DRAG_THRESHOLD = 5; 
  let mouseDownFired = false;

  document.addEventListener('mousedown', (e) => {
    // 1. Check if dragging a Gallery Item (from the Grid View)
    if (e.target.closest('.gallery-grid-header') || e.target.closest('.gallery-lightbox-overlay')) return;

    let targetEl = e.target.closest('.gallery-grid .gallery-item');
    if (targetEl && window.aeGalleryAPI) {
      const itemData = window.aeGalleryAPI.getItemByEl(targetEl);
      if (itemData) {
        initDrag(e, targetEl, { source: 'gallery', data: itemData, el: targetEl });
      }
    }
  });

  function initDrag(e, sourceEl, payload) {
    mouseDownFired = true;
    startX = e.clientX;
    startY = e.clientY;
    
    dragItem = sourceEl;
    dragPayload = payload;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault(); 
  }

  function onMouseMove(e) {
    if (!mouseDownFired) return;
    
    if (!isDragging) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > DRAG_THRESHOLD) {
        startDragging(e);
      } else {
        return;
      }
    }

    if (dragClone) {
      dragClone.style.left = `${e.clientX}px`;
      dragClone.style.top = `${e.clientY}px`;
    }
  }

  function startDragging(e) {
    isDragging = true;
    
    dragClone = document.createElement('div');
    dragClone.classList.add('os-drag-ghost', 'file-item');
    
    const mediaNode = dragItem.querySelector('img, video');
    if (mediaNode) {
       const cloneMedia = mediaNode.cloneNode(true);
       cloneMedia.className = 'file-thumb';
       dragClone.appendChild(cloneMedia);
    }
    
    dragClone.style.position = 'fixed';
    dragClone.style.pointerEvents = 'none';
    dragClone.style.zIndex = '999999';
    dragClone.style.opacity = '0.9';
    dragClone.style.transform = 'translate(-50%, -50%)';
    
    document.body.appendChild(dragClone);
    dragItem.style.opacity = '0.3'; 
    
    // Initial position
    dragClone.style.left = `${e.clientX}px`;
    dragClone.style.top = `${e.clientY}px`;
  }

  function onMouseUp(e) {
    if (!mouseDownFired) return;
    mouseDownFired = false;
    
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    if (isDragging) {
      finishDrag(e);
    } else {
      if (dragItem) dragItem.style.opacity = '';
    }
    
    isDragging = false;
    dragItem = null;
    dragPayload = null;
    
    if (dragClone) {
      dragClone.remove();
      dragClone = null;
    }
  }

  function finishDrag(e) {
    if (dragItem) dragItem.style.opacity = '';

    dragClone.style.display = 'none'; 
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    dragClone.style.display = ''; 

    if (dragPayload.source === 'gallery') {
      const galleryWindow = dropTarget ? dropTarget.closest('#gallery-window') : null;
      if (!galleryWindow) {
        const folderWin = dropTarget ? dropTarget.closest('.window:not(#gallery-window):not(#preview-window):not(#trash-window):not(#terminal-window)') : null;
        
        if (folderWin) {
          const contentEl = folderWin.querySelector('.window-content');
          if (contentEl) {
             dropToFileContainer(dragPayload.data, e.clientX, e.clientY, contentEl);
          }
        } else {
           dropToFileContainer(dragPayload.data, e.clientX, e.clientY, document.getElementById('desktop'));
        }
        
        if (window.aeGalleryAPI) {
           window.aeGalleryAPI.removeItem(dragPayload.el);
        }
      }
    }
  }

  function dropToFileContainer(itemData, x, y, container) {
    if (!container) return;

    const fileEl = document.createElement('div');
    fileEl.className = 'folder file-item';
    fileEl.dataset.mediaData = JSON.stringify(itemData);
    fileEl.title = itemData.filename || 'Photo';

    let mediaHtml = '';
    if (itemData.type === 'image') {
       mediaHtml = `<img src="${itemData.src}" class="file-thumb" draggable="false" />`;
    } else {
       mediaHtml = `<video src="${itemData.src}" class="file-thumb" draggable="false" muted></video>`;
    }
    
    let displayName = itemData.filename || 'Media';
    if (displayName.length > 12) displayName = displayName.substring(0, 10) + '...';
    
    const labelHtml = `<span class="folder-label">${displayName}</span>`;
    
    fileEl.innerHTML = mediaHtml + labelHtml;
    
    // Convert screen coordinates to container-relative coordinates
    const rect = container.getBoundingClientRect();
    const relX = x - rect.left - 32;
    const relY = y - rect.top - 32;
    
    fileEl.style.position = 'absolute';
    fileEl.style.left = relX + 'px';
    fileEl.style.top = relY + 'px';
    
    container.appendChild(fileEl);

    // Bind standard folder drag behaviors for when physics is disabled
    fileEl.addEventListener('dragstart', e => e.preventDefault());
    fileEl.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || event.detail > 1 || window.PHYSICS_ON) return;
      if (typeof window.startFolderDrag === 'function') {
        window.startFolderDrag(fileEl, event);
      }
    });

    if (window.physics && window.PHYSICS_ON) {
       window.dispatchEvent(new CustomEvent('physics-ensure-scope', { detail: { el: container } }));
    } else {
       // if physics is off, make it absolute so it stays there
       fileEl.style.margin = '0';
    }
  }

  // --- Track Desktop .file-item dragging BACK TO GALLERY ---
  let desktopFileDragging = null;
  document.addEventListener('mousedown', (e) => {
    const fileItem = e.target.closest('#desktop > .folder.file-item, .window-content > .folder.file-item');
    if (fileItem && !fileItem.closest('#gallery-window')) {
       desktopFileDragging = fileItem;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (desktopFileDragging) {
       desktopFileDragging.style.display = 'none'; // hide to pierce through
       const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
       desktopFileDragging.style.display = ''; // restore
       
       const galleryWin = dropTarget ? dropTarget.closest('#gallery-window') : null;
       const folderWin = dropTarget ? dropTarget.closest('.window:not(#gallery-window):not(#preview-window):not(#trash-window):not(#terminal-window)') : null;
       const trashWin = dropTarget ? dropTarget.closest('#trash-window') : null;
       
       if (galleryWin && window.aeGalleryAPI && window.aeGalleryAPI.isOpen()) {
         try {
           const itemData = JSON.parse(desktopFileDragging.dataset.mediaData);
           window.aeGalleryAPI.addItem(itemData);
           
           if (window.physics && window.PHYSICS_ON) {
              window.dispatchEvent(new CustomEvent('physics-remove-icon', { detail: { el: desktopFileDragging } }));
           }
           desktopFileDragging.remove();
         } catch(err) {
           console.error("Failed to parse desktop file data", err);
         }
       } else if (trashWin) {
          // If dropped on trash (already handled by Trash UI logic, do nothing here to let trash take it)
       } else if (folderWin) {
         // Dropped into a folder window
         const contentEl = folderWin.querySelector('.window-content');
         if (contentEl && !contentEl.contains(desktopFileDragging)) {
            const rect = contentEl.getBoundingClientRect();
            desktopFileDragging.style.left = (e.clientX - rect.left - 32) + 'px';
            desktopFileDragging.style.top = (e.clientY - rect.top - 32) + 'px';
            contentEl.appendChild(desktopFileDragging);
         }
       } else {
         // Dropped onto desktop
         const desktopEl = document.getElementById('desktop');
         if (desktopEl && !desktopEl.contains(desktopFileDragging)) {
            const rect = desktopEl.getBoundingClientRect();
            desktopFileDragging.style.left = (e.clientX - rect.left - 32) + 'px';
            desktopFileDragging.style.top = (e.clientY - rect.top - 32) + 'px';
            desktopEl.appendChild(desktopFileDragging);
         }
       }
       desktopFileDragging = null;
    }
  });
})();
