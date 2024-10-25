let isSelecting = false;
let isDraggingFolder = false;
let startX, startY, offsetX, offsetY, draggedFolder, parentRect;

// Create selection box element
const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
document.body.appendChild(selectionBoxDiv);

// Handle selection box start (mousedown)
document.getElementById('desktop').addEventListener('mousedown', function (event) {
    if (isDraggingFolder || event.target.closest('.window')) return;

    if (event.button === 0) {
        isSelecting = true;
        event.preventDefault();
        startX = event.clientX;
        startY = event.clientY;
        selectionBoxDiv.style.left = `${startX}px`;
        selectionBoxDiv.style.top = `${startY}px`;
        selectionBoxDiv.style.width = '0';
        selectionBoxDiv.style.height = '0';
        selectionBoxDiv.style.display = 'block';

        const folders = document.querySelectorAll('.folder');
        folders.forEach(folder => folder.classList.remove('selected'));
    }
});

// Handle mouse movement for adjusting the selection box size
document.getElementById('desktop').addEventListener('mousemove', function (event) {
    if (!isSelecting || isDraggingFolder) return;

    const endX = event.clientX;
    const endY = event.clientY;
    selectionBoxDiv.style.left = Math.min(startX, endX) + 'px';
    selectionBoxDiv.style.top = Math.min(startY, endY) + 'px';
    selectionBoxDiv.style.width = Math.abs(endX - startX) + 'px';
    selectionBoxDiv.style.height = Math.abs(endY - startY) + 'px';

    const folders = document.querySelectorAll('.folder');
    folders.forEach(folder => {
        const folderRect = folder.getBoundingClientRect();
        const selectionRect = selectionBoxDiv.getBoundingClientRect();

        if (selectionRect.left < folderRect.right &&
            selectionRect.right > folderRect.left &&
            selectionRect.top < folderRect.bottom &&
            selectionRect.bottom > folderRect.top) {
            folder.classList.add('selected');
        } else {
            folder.classList.remove('selected');
        }
    });
});

// Handle mouseup event for ending both selection and folder dragging
document.addEventListener('mouseup', function () {
    if (isSelecting) {
        isSelecting = false;
        selectionBoxDiv.style.display = 'none';
    }

    if (isDraggingFolder) {
        stopDragFolder();
    }
});

// Folder dragging functionality
const folders = document.querySelectorAll('.folder');
folders.forEach(folder => {
    folder.addEventListener('dragstart', (e) => e.preventDefault());

    folder.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            isDraggingFolder = true;
            draggedFolder = folder;

            const rect = folder.getBoundingClientRect();
            parentRect = folder.closest('.window') ? folder.closest('.window').getBoundingClientRect() : document.body.getBoundingClientRect();

            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            folder.style.position = 'absolute';
            folder.style.zIndex = '1000';

            document.addEventListener('mousemove', onDragFolder);
            document.addEventListener('mouseup', stopDragFolder);
        }
    });
});

// Extend functionality to allow moving folders into folder icons
function onDragFolder(event) {
    if (isDraggingFolder && draggedFolder) {
        const x = event.clientX - parentRect.left - offsetX;
        const y = event.clientY - parentRect.top - offsetY;

        draggedFolder.style.left = `${x}px`;
        draggedFolder.style.top = `${y}px`;

        // Detect if dragged folder is within any open window
        const windows = document.querySelectorAll('.window');
        let movedToWindow = false;
        windows.forEach(win => {
            const winRect = win.getBoundingClientRect();
            if (
                event.clientX > winRect.left &&
                event.clientX < winRect.right &&
                event.clientY > winRect.top &&
                event.clientY < winRect.bottom
            ) {
                // If within window bounds, append to window and update parentRect
                win.querySelector('.window-content').appendChild(draggedFolder);
                parentRect = winRect;
                movedToWindow = true;
                console.log("Folder moved to window:", win.id);
            }
        });

        // If dragged outside of all windows, move to desktop
        if (!movedToWindow && draggedFolder.closest('.window')) {
            const desktop = document.getElementById('desktop');
            desktop.appendChild(draggedFolder);
            parentRect = desktop.getBoundingClientRect();
            console.log("Folder moved to the desktop");
        }

        // Check if dragged folder is hovering over any other folder icons
        const folderIcons = document.querySelectorAll('.folder:not(.in-trash)');
        folderIcons.forEach(icon => {
            const iconRect = icon.getBoundingClientRect();
            if (
                event.clientX > iconRect.left &&
                event.clientX < iconRect.right &&
                event.clientY > iconRect.top &&
                event.clientY < iconRect.bottom &&
                icon !== draggedFolder
            ) {
                icon.classList.add('folder-target');
            } else {
                icon.classList.remove('folder-target');
            }
        });

        checkTrashProximity(draggedFolder);
    }
}

// Function to stop dragging the folder and cleanup
function stopDragFolder() {
    if (isDraggingFolder) {
        isDraggingFolder = false;

        if (draggedFolder) {
            const targetFolder = document.querySelector('.folder-target');

            if (targetFolder) {
                targetFolder.classList.remove('folder-target');
                const windowId = targetFolder.getAttribute('data-window');
                const targetWindow = document.getElementById(windowId);

                if (targetWindow) {
                    const targetContent = targetWindow.querySelector('.window-content');
                    targetContent.appendChild(draggedFolder);

                    // Reset position inside the new window
                    draggedFolder.style.left = '10px';
                    draggedFolder.style.top = '10px';
                    draggedFolder.style.zIndex = '';
                    openFolder(targetFolder); // Open the target folder window if not open
                    console.log(`Folder moved to ${windowId} window.`);
                }
            } else if (trash.classList.contains('trash-enlarged')) {
                console.log("Trash is enlarged, hiding the folder.");
                draggedFolder.style.display = 'none';
                draggedFolder.classList.add('in-trash');
                trashIcon.src = 'assets/icons/trash-icon-full.png';
            } else {
                draggedFolder.style.zIndex = '';
            }
        }

        draggedFolder = null;
        document.removeEventListener('mousemove', onDragFolder);
        document.removeEventListener('mouseup', stopDragFolder);
    }
}
