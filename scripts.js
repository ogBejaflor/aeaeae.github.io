window.addEventListener('load', function () {
    // Start the clock
    updateClock();
    setInterval(updateClock, 1000); // Update the clock every second

    // Battery status or simulation
    if (navigator.getBattery) {
        navigator.getBattery().then(function (battery) {
            updateBatteryStatus(battery);
            battery.addEventListener('levelchange', function () {
                updateBatteryStatus(battery);
            });
            battery.addEventListener('chargingchange', function () {
                updateBatteryStatus(battery);
            });
        });
    } else {
        simulateBattery();
    }

    // Call the functions to make windows draggable and resizable
    makeWindowsDraggable();
    makeWindowsResizable();
});

// Global flags
let isDraggingWindow = false;
// Global flag to track window resizing
let isResizingWindow = false;

// Function to update the clock with real-time data
function updateClock() {
    const now = new Date();
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    const formattedDate = now.toLocaleString('en-US', options).replace(',', '');
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedDateTime = `${formattedDate} ${formattedTime}`;
    document.getElementById('date-time').innerText = formattedDateTime; // Set formatted date/time
}

// Function to update the battery icon
function updateBatteryStatus(battery) {
    let batteryLevel = Math.floor(battery.level * 100);
    let batteryCharging = battery.charging ? '⚡' : '🔋';
    document.getElementById('battery-icon').innerText = `${batteryCharging} ${batteryLevel}%`;
}

// Function to simulate battery level decrease
function simulateBattery() {
    let batteryLevel = 80;
    let chargingIcon = '🔋';
    document.getElementById('battery-icon').innerText = `${chargingIcon} ${batteryLevel}%`;
    let batteryInterval = setInterval(function () {
        batteryLevel = Math.max(0, batteryLevel - 1);
        document.getElementById('battery-icon').innerText = `${chargingIcon} ${batteryLevel}%`;
        if (batteryLevel === 0) {
            clearInterval(batteryInterval);
        }
    }, 60000);
}

// Prevent selection box while dragging or resizing windows
let isSelecting = false;
let isDraggingFolder = false;
let startX, startY;

const selectionBoxDiv = document.createElement('div');
selectionBoxDiv.id = 'selection-box';
selectionBoxDiv.style.display = 'none';
document.body.appendChild(selectionBoxDiv);

document.getElementById('desktop').addEventListener('mousedown', function (event) {
    // Prevent selection box if dragging a window or resizing
    if (isDraggingWindow || isResizingWindow || event.target.closest('.window')) {
        return;
    }

    if (event.button === 0) {
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

document.getElementById('desktop').addEventListener('mousemove', function (event) {
    if (selectionBoxDiv.style.display === 'block' && !isDraggingFolder) {
        const endX = event.clientX;
        const endY = event.clientY;
        selectionBoxDiv.style.left = Math.min(startX, endX) + 'px';
        selectionBoxDiv.style.top = Math.min(startY, endY) + 'px';
        selectionBoxDiv.style.width = Math.abs(endX - startX) + 'px';
        selectionBoxDiv.style.height = Math.abs(endY - startY) + 'px';
        const folders = document.querySelectorAll('.folder');
        folders.forEach(folder => {
            const folderRect = folder.getBoundingClientRect();
            if (selectionBoxDiv.getBoundingClientRect().left < folderRect.right &&
                selectionBoxDiv.getBoundingClientRect().right > folderRect.left &&
                selectionBoxDiv.getBoundingClientRect().top < folderRect.bottom &&
                selectionBoxDiv.getBoundingClientRect().bottom > folderRect.top) {
                folder.classList.add('selected');
            } else {
                folder.classList.remove('selected');
            }
        });
    }
});

document.addEventListener('mouseup', function () {
    selectionBoxDiv.style.display = 'none';
    isDraggingFolder = false;
});

// Folder click and drag functionality
const folders = document.querySelectorAll('.folder');
folders.forEach(folder => {
    let clickTimer;
    let offsetX, offsetY;

    folder.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            isDraggingFolder = true;
            offsetX = event.clientX - folder.getBoundingClientRect().left;
            offsetY = event.clientY - folder.getBoundingClientRect().top;
            const rect = folder.getBoundingClientRect();
            folder.style.position = 'absolute';
            folder.style.left = `${rect.left}px`;
            folder.style.top = `${rect.top}px`;
            clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                if (!isDraggingFolder) {
                    folders.forEach(f => f.classList.remove('selected'));
                    folder.classList.add('selected');
                }
            }, 300);
        }
    });

    folder.addEventListener('mousemove', function (event) {
        if (isDraggingFolder) {
            folder.style.left = (event.clientX - offsetX) + 'px';
            folder.style.top = (event.clientY - offsetY) + 'px';
        }
    });

    folder.addEventListener('mouseup', function () {
        isDraggingFolder = false;
    });

    folder.addEventListener('dblclick', function () {
        clearTimeout(clickTimer);
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
            windowElement.style.zIndex = '1001';
        }
    }
}

// Function to make windows draggable
function makeWindowsDraggable() {
    const windows = document.querySelectorAll('.window');
    windows.forEach(window => {
        const header = window.querySelector('.window-header');
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', function (event) {
            if (event.button !== 0) return;

            isDragging = true;
            isDraggingWindow = true;
            offsetX = event.clientX - window.getBoundingClientRect().left;
            offsetY = event.clientY - window.getBoundingClientRect().top;
            window.classList.add('dragging');
            window.style.zIndex = '1001';
        });

        document.addEventListener('mousemove', function (event) {
            if (isDragging) {
                const x = event.clientX - offsetX;
                const y = event.clientY - offsetY;
                window.style.left = `${x}px`;
                window.style.top = `${y}px`;
            }
        });

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                isDraggingWindow = false;
                window.classList.remove('dragging');
            }
        });
    });
}

// Function to make windows resizable on the bottom corners
function makeWindowsResizable() {
    const windows = document.querySelectorAll('.window');
    windows.forEach(window => {
        const resizer = document.createElement('div');
        resizer.classList.add('resizer');
        window.appendChild(resizer);

        let startX, startY, startWidth, startHeight;

        // Mouse down on the resizer
        resizer.addEventListener('mousedown', function (e) {
            e.preventDefault();
            isResizingWindow = true;

            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseInt(document.defaultView.getComputedStyle(window).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(window).height, 10);

            document.documentElement.addEventListener('mousemove', doDrag, false);
            document.documentElement.addEventListener('mouseup', stopDrag, false);
        });

        // Function to handle the dragging (resizing)
        function doDrag(e) {
            if (!isResizingWindow) return;

            window.style.width = (startWidth + e.clientX - startX) + 'px';
            window.style.height = (startHeight + e.clientY - startY) + 'px';
        }

        // Function to stop the dragging
        function stopDrag() {
            isResizingWindow = false;
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
        }
    });
}

// Call the resizable function after the page loads
window.addEventListener('load', function () {
    makeWindowsResizable();
});

// Minimize button functionality with vertical stretch animation and fullscreen handling
document.querySelectorAll('.minimize-button').forEach(button => {
    button.addEventListener('click', function () {
        const windowElement = this.closest('.window');
        const windowId = windowElement.id;

        // Check if the window is in fullscreen mode
        if (document.fullscreenElement) {
            document.exitFullscreen().then(() => {
                minimizeWindow(windowElement, windowId);
            }).catch(err => {
                console.error("Error exiting fullscreen:", err);
            });
        } else {
            // If not in fullscreen, directly minimize the window
            minimizeWindow(windowElement, windowId);
        }
    });
});

// Function to minimize the window with animation
function minimizeWindow(windowElement, windowId) {
    windowElement.classList.add('minimizing');
    const dock = document.getElementById('dock');
    const trashIcon = document.querySelector('.dock-item[data-window="trash-window"]');
    const dockRect = trashIcon.getBoundingClientRect();
    const windowRect = windowElement.getBoundingClientRect();
    const translateX = dockRect.left - windowRect.left;
    const translateY = dockRect.top - windowRect.top;

    // Apply transform to animate window moving to the dock
    windowElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.2, 1.5)`;

    // Wait for the animation to finish, then hide the window
    setTimeout(() => {
        windowElement.style.display = 'none';
        windowElement.classList.remove('minimizing');
        addMinimizedWindowToDock(windowId);
    }, 500); // Matches the CSS transition duration
}

// Function to add a minimized window icon to the dock
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

// Function to restore minimized window with a reverse minimize animation
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

    if (minimizedWindow) {
        minimizedWindow.remove();
    }

    setTimeout(() => {
        windowElement.classList.remove('restoring');
    }, 500);
}

// Close button and other functionalities remain unchanged
document.querySelectorAll('.close-button').forEach(button => {
    button.addEventListener('click', function () {
        const windowElement = this.closest('.window');
        if (document.fullscreenElement) {
            document.exitFullscreen().then(() => {
                windowElement.style.display = 'none';
            });
        } else {
            windowElement.style.display = 'none';
        }
    });
});

// Dock items hover effect
const dockItems = document.querySelectorAll('.dock-item');
dockItems.forEach(item => {
    item.addEventListener('mouseenter', () => {
        item.classList.add('hovered');
        const prevSibling = item.previousElementSibling;
        const nextSibling = item.nextElementSibling;
        if (prevSibling) prevSibling.classList.add('adjacent');
        if (nextSibling) nextSibling.classList.add('adjacent');
    });
    item.addEventListener('mouseleave', () => {
        item.classList.remove('hovered');
        const prevSibling = item.previousElementSibling;
        const nextSibling = item.nextElementSibling;
        if (prevSibling) prevSibling.classList.remove('adjacent');
        if (nextSibling) nextSibling.classList.remove('adjacent');
    });
});

// Dock show/hide based on mouse movement
const dockWrapper = document.getElementById('dock-wrapper');
window.addEventListener('mousemove', (event) => {
    const windowHeight = window.innerHeight;
    const mouseY = event.clientY;
    if (windowHeight - mouseY < 100) {
        dockWrapper.classList.add('show');
    } else {
        dockWrapper.classList.remove('show');
    }
});

// Fullscreen functionality
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

// Folder dragging z-index management
folders.forEach(folder => {
    folder.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            isDraggingFolder = true;
            folder.style.zIndex = '1000';
        }
    });

    folder.addEventListener('mouseup', function () {
        isDraggingFolder = false;
        folder.style.zIndex = '';
    });
});
