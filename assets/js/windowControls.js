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
        openFolder(folder);
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
            windowElement.style.display = 'block';
            windowElement.style.zIndex = '1001';  // Bring to front
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

    windowElement.offsetHeight;

    windowElement.classList.add('restoring');
    windowElement.style.transform = 'translate(0, 0) scale(1, 1)';
    windowElement.style.opacity = '1';

    if (minimizedWindow) minimizedWindow.remove();

    setTimeout(() => {
        windowElement.classList.remove('restoring');
    }, 500);
}

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
