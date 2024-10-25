// Select the trash and its icon
const trash = document.querySelector('.dock-item[data-window="trash-window"]');
const trashIcon = trash.querySelector('img');
let trashIconOriginalSrc = trashIcon.src;

console.log("Trash and trash icon initialized.");

// Check proximity between dragged folder and trash icon
function checkTrashProximity(draggedFolder) {
    const trashRect = trash.getBoundingClientRect();
    const folderRect = draggedFolder.getBoundingClientRect();

    console.log(`Dragged folder rect: ${JSON.stringify(folderRect)}`);
    console.log(`Trash rect: ${JSON.stringify(trashRect)}`);

    // Check if the folder is near the trash icon (within 50px range)
    if (
        folderRect.right > trashRect.left - 50 &&
        folderRect.left < trashRect.right + 50 &&
        folderRect.bottom > trashRect.top - 50 &&
        folderRect.top < trashRect.bottom + 50
    ) {
        console.log("Folder is near the trash icon. Enlarging trash icon...");
        enlargeTrash(); // Enlarge trash icon when folder is near
    } else {
        console.log("Folder is not near the trash icon. Resetting trash size...");
        resetTrashSize(); // Reset trash icon size if folder is away
    }
}

// Enlarge the trash icon when dragging near
function enlargeTrash() {
    trashIcon.style.transform = 'scale(1.5)';
    trashIcon.style.transition = 'transform 0.2s ease';
    trash.classList.add('trash-enlarged'); // Add the 'trash-enlarged' class
    console.log("Trash icon enlarged and 'trash-enlarged' class added.");
}

// Reset the trash icon size when dragging away or dropping
function resetTrashSize() {
    trashIcon.style.transform = 'scale(1)';
    trashIcon.style.transition = 'transform 0.2s ease'; // Smooth transition for reset too
    trash.classList.remove('trash-enlarged'); // Remove the 'trash-enlarged' class
    console.log("Trash icon reset to normal size and 'trash-enlarged' class removed.");
}

// Handle the folder drop near the trash during mouseup
document.addEventListener('mouseup', function (event) {
    console.log("Mouseup event detected.");
    
    if (isDraggingFolder && draggedFolder) {
        console.log("Mouseup event detected while dragging folder.");

        const trashRect = trash.getBoundingClientRect();
        const folderRect = draggedFolder.getBoundingClientRect();

        console.log(`Checking if folder is inside trash...`);

        // Check if folder is dropped within the trash area
        if (trash.classList.contains('trash-enlarged')) {
            console.log("Folder is inside trash area. Hiding folder...");
            trashIcon.src = 'assets/icons/trash-icon-full.png'; // Change trash to full icon
            draggedFolder.style.display = 'none'; // "Delete" the folder by hiding it
            draggedFolder.classList.add('in-trash'); // Add a class indicating it's in the trash
            console.log("Folder moved to trash and hidden.");
        } else {
            console.log("Folder is NOT inside the trash area.");
        }

        resetTrashSize();  // Reset the trash size
        stopDragFolder();  // Finalize the drag operation
    } else {
        console.log("Mouseup event detected, but no folder is being dragged.");
    }
});
