let isSelecting = false;
let isDraggingFolder = false; // Ensure this is accessible globally
let startX, startY, offsetX, offsetY, draggedFolder;

const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
document.body.appendChild(selectionBoxDiv);

// Handle the desktop mousedown event for starting the selection box
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

// Handle the mousemove event for adjusting the selection box size
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

// Handle the mouseup event to end the selection process
document.addEventListener('mouseup', function () {
    if (isSelecting) {
        isSelecting = false;
        selectionBoxDiv.style.display = 'none';
    }
    if (isDraggingFolder) {
        isDraggingFolder = false;
        draggedFolder.style.zIndex = ''; // Reset z-index after dragging
        draggedFolder = null; // Reset dragged folder
        document.removeEventListener('mousemove', onDragFolder); // Stop folder dragging
        document.removeEventListener('mouseup', stopDragFolder); // Remove event listeners
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
            draggedFolder = folder; // Set the currently dragged folder
            const rect = folder.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            folder.style.position = 'absolute'; // Ensure absolute positioning for dragging
            folder.style.zIndex = '1000'; // Bring folder to front

            // Attach mousemove and mouseup for dragging
            document.addEventListener('mousemove', onDragFolder);
            document.addEventListener('mouseup', stopDragFolder);
        }
    });
});

// Function to handle folder dragging
function onDragFolder(event) {
    if (isDraggingFolder && draggedFolder) {
        draggedFolder.style.left = (event.clientX - offsetX) + 'px';
        draggedFolder.style.top = (event.clientY - offsetY) + 'px';
    }
}

// Function to stop dragging the folder
function stopDragFolder() {
    isDraggingFolder = false;
    if (draggedFolder) {
        draggedFolder.style.zIndex = ''; // Reset z-index after dragging
    }
    draggedFolder = null;
    document.removeEventListener('mousemove', onDragFolder); // Stop folder dragging
    document.removeEventListener('mouseup', stopDragFolder); // Remove event listeners
}
