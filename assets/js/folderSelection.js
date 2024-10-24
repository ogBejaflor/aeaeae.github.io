let isSelecting = false;
let isDraggingFolder = false;
let startX, startY, offsetX, offsetY, draggedFolder;

// Create selection box element
const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
document.body.appendChild(selectionBoxDiv);

// Handle selection box start (mousedown)
document.getElementById('desktop').addEventListener('mousedown', function (event) {
    // Prevent selection box if dragging a folder or interacting with a window
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

        // Remove selection from previously selected folders
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
    // End selection
    if (isSelecting) {
        isSelecting = false;
        selectionBoxDiv.style.display = 'none';
    }

    // End dragging
    if (isDraggingFolder) {
        stopDragFolder();  // Call function to finalize dragging
    }
});

// Folder dragging functionality
const folders = document.querySelectorAll('.folder');

folders.forEach(folder => {
    // Prevent default drag behavior for folders
    folder.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });

    folder.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            isDraggingFolder = true;
            draggedFolder = folder;
            const rect = folder.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            folder.style.position = 'absolute';
            folder.style.zIndex = '1000'; // Bring folder to front

            // Attach mousemove and mouseup for dragging
            document.addEventListener('mousemove', onDragFolder);
            document.addEventListener('mouseup', stopDragFolder); // Listener is removed when stopDragFolder is called
        }
    });
});

// Function to handle folder dragging
function onDragFolder(event) {
    if (isDraggingFolder && draggedFolder) {
        draggedFolder.style.left = (event.clientX - offsetX) + 'px';
        draggedFolder.style.top = (event.clientY - offsetY) + 'px';
        checkTrashProximity(draggedFolder); // Check if near trash
    }
}

// Function to stop dragging the folder and cleanup
function stopDragFolder() {
    if (isDraggingFolder) {
        isDraggingFolder = false;

        if (draggedFolder) {
            // Check if the trash is enlarged
            if (trash.classList.contains('trash-enlarged')) {
                // If trash is enlarged, hide the folder
                console.log("Trash is enlarged, hiding the folder.");
                draggedFolder.style.display = 'none';  // Hide the folder
                draggedFolder.classList.add('in-trash');  // Mark the folder as in the trash
                trashIcon.src = 'assets/icons/trash-icon-full.png'; // Change trash icon to full
            }

            draggedFolder.style.zIndex = '';  // Reset z-index after dragging
        }

        draggedFolder = null;

        // Remove event listeners for dragging
        document.removeEventListener('mousemove', onDragFolder);
        document.removeEventListener('mouseup', stopDragFolder);
    }
}
