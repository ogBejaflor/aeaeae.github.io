let isDraggingWindow = false;
let isResizingWindow = false;
let currentWindow = null;  // Track the current window being dragged or resized

// Function to make windows draggable
function makeWindowsDraggable() {
    const windows = document.querySelectorAll('.window');
    windows.forEach(window => {
        const header = window.querySelector('.window-header');
        let offsetX, offsetY;

        header.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;

            isDraggingWindow = true;
            currentWindow = window;  // Track the window being dragged
            offsetX = event.clientX - window.getBoundingClientRect().left;
            offsetY = event.clientY - window.getBoundingClientRect().top;
            window.style.zIndex = '1001';
            window.classList.add('dragging');
        });

        document.addEventListener('mousemove', (event) => {
            if (isDraggingWindow && currentWindow === window) {
                window.style.left = `${event.clientX - offsetX}px`;
                window.style.top = `${event.clientY - offsetY}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingWindow && currentWindow === window) {
                isDraggingWindow = false;
                currentWindow = null;
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

        resizer.addEventListener('mousedown', (event) => {
            event.preventDefault();
            isResizingWindow = true;
            currentWindow = window;  // Track the window being resized

            startX = event.clientX;
            startY = event.clientY;
            startWidth = parseInt(document.defaultView.getComputedStyle(window).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(window).height, 10);

            document.documentElement.addEventListener('mousemove', doResize, false);
            document.documentElement.addEventListener('mouseup', stopResize, false);
        });

        function doResize(event) {
            if (!isResizingWindow || currentWindow !== window) return;
            window.style.width = (startWidth + event.clientX - startX) + 'px';
            window.style.height = (startHeight + event.clientY - startY) + 'px';
        }

        function stopResize() {
            if (isResizingWindow && currentWindow === window) {
                isResizingWindow = false;
                currentWindow = null;
                document.documentElement.removeEventListener('mousemove', doResize, false);
                document.documentElement.removeEventListener('mouseup', stopResize, false);
            }
        }
    });
}

// Initialize draggable and resizable windows after the page loads
window.addEventListener('load', function () {
    makeWindowsDraggable();
    makeWindowsResizable();
});
