document.querySelectorAll('.minimize-button').forEach(button => {
    button.addEventListener('click', function () {
        const windowElement = this.closest('.window');
        const windowId = windowElement.id;

        if (document.fullscreenElement) {
            document.exitFullscreen().then(() => {
                minimizeWindow(windowElement, windowId);
            }).catch(err => {
                console.error("Error exiting fullscreen:", err);
            });
        } else {
            minimizeWindow(windowElement, windowId);
        }
    });
});

// Function to handle folder double-click
document.querySelectorAll('.folder').forEach(folder => {
    folder.addEventListener('dblclick', function () {
        openFolder(folder); // Call openFolder when a folder is double-clicked
    });
});

// Function to open selected folders or restore minimized windows
function openFolder(folder) {
    const windowId = folder.getAttribute('data-window');
    const windowElement = document.getElementById(windowId);
    const minimizedWindow = document.querySelector(`.minimized-window[data-window="${windowId}"]`);

    if (minimizedWindow) {
        minimizedWindow.remove();
        restoreMinimizedWindow(minimizedWindow, windowElement);
    } else {
        if (windowElement) {
            windowElement.style.display = 'block'; // Show the folder window
            windowElement.style.zIndex = '1001';  // Bring the window to the front
        }
    }
}

function minimizeWindow(windowElement, windowId) {
    windowElement.classList.add('minimizing');
    const dock = document.getElementById('dock');
    const trashIcon = document.querySelector('.dock-item[data-window="trash-window"]');
    const dockRect = trashIcon.getBoundingClientRect();
    const windowRect = windowElement.getBoundingClientRect();
    const translateX = dockRect.left - windowRect.left;
    const translateY = dockRect.top - windowRect.top;

    windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;

    setTimeout(() => {
        windowElement.style.display = 'none';
        windowElement.classList.remove('minimizing');
        addMinimizedWindowToDock(windowId);
    }, 500);
}

function addMinimizedWindowToDock(windowId) {
    const dock = document.getElementById('dock');

    if (!document.querySelector(`.minimized-window[data-window="${windowId}"]`)) {
        const minimizedWindow = document.createElement('div');
        minimizedWindow.classList.add('dock-item', 'minimized-window');
        minimizedWindow.setAttribute('data-window', windowId);
        minimizedWindow.innerHTML = `<img src="assets/icons/minimized-window-icon.png" alt="Minimized Window" />`;

        dock.insertBefore(minimizedWindow, dock.firstChild);

        minimizedWindow.addEventListener('click', function () {
            restoreMinimizedWindow(this, document.getElementById(windowId));
        });
    }
}

function restoreMinimizedWindow(minimizedWindow, windowElement) {
    const dock = document.getElementById('dock');
    const trashIcon = document.querySelector('.dock-item[data-window="trash-window"]');
    const dockRect = trashIcon.getBoundingClientRect();
    const windowRect = windowElement.getBoundingClientRect();

    windowElement.style.display = 'block';
    const translateX = dockRect.left - windowRect.left;
    const translateY = dockRect.top - windowRect.top;

    windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;
    windowElement.style.opacity = '0';

    windowElement.offsetHeight; // Force reflow

    windowElement.classList.add('restoring');
    windowElement.style.transform = 'translate(0, 0) scale(1, 1)';
    windowElement.style.opacity = '1';

    if (minimizedWindow) minimizedWindow.remove();

    setTimeout(() => {
        windowElement.classList.remove('restoring');
    }, 500);
}

// Handle window close functionality
document.querySelectorAll('.close-button').forEach(button => {
    button.addEventListener('click', function () {
        const windowElement = this.closest('.window');
        if (document.fullscreenElement) {
            document.exitFullscreen().then(() => windowElement.style.display = 'none');
        } else {
            windowElement.style.display = 'none';
        }
    });
});

// Handle fullscreen functionality
document.querySelectorAll('.fullscreen-button').forEach(button => {
    button.addEventListener('click', function () {
        const windowElement = this.closest('.window');
        if (document.fullscreenEnabled) {
            if (!document.fullscreenElement) {
                windowElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        } else {
            alert('Fullscreen mode is not supported by your browser.');
        }
    });
});

// Open the trash window when trash icon is clicked
trash.addEventListener('click', function () {
    openTrashWindow(); // Open the trash window
});

function openTrashWindow() {
    const trashWindow = document.getElementById('trash-window');
    const trashContent = trashWindow.querySelector('.window-content');
    
    // Clear any existing content
    trashContent.innerHTML = '';

    // Loop through trashed folders and display them in the trash window
    if (trashedFolders.length > 0) {
        trashedFolders.forEach(folder => {
            const clonedFolder = folder.cloneNode(true);
            clonedFolder.style.display = 'block'; // Ensure the folder is visible inside the trash
            clonedFolder.classList.remove('in-trash'); // Remove any 'in-trash' class
            trashContent.appendChild(clonedFolder); // Add the cloned folder to the trash window
        });
    } else {
        trashContent.innerHTML = '<p>The trash is empty.</p>'; // Display message if trash is empty
    }

    trashWindow.style.display = 'block'; // Show the trash window
    trashWindow.style.zIndex = '1001';  // Bring the trash window to the front
}
