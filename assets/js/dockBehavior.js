const dockItems = document.querySelectorAll('.dock-item');

// Hover effect on dock items
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

// Show and hide the dock when the mouse is near the bottom
const dockWrapper = document.getElementById('dock-wrapper');
window.addEventListener('mousemove', (event) => {
    const windowHeight = window.innerHeight;
    const mouseY = event.clientY;

    // Log current mouse Y position for debugging
    console.log("Mouse Y position:", mouseY);

    // Show the dock when the mouse is near the bottom
    if (windowHeight - mouseY < 100) {
        console.log("Adding .show class to dock.");
        dockWrapper.classList.add('show');
    } else {
        console.log("Removing .show class from dock.");
        dockWrapper.classList.remove('show');
    }
});
