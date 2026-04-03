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

// Initial 1-second visibility
let initialShowDone = false;
dockWrapper.classList.add('show');

setTimeout(() => {
    initialShowDone = true;
    dockWrapper.classList.remove('show');
}, 1500); // 1.5s total to allow for a clearer visibility window before sliding down

window.addEventListener('mousemove', (event) => {
    // Prevent mouse moves from hiding the dock during its initial spotlight
    if (!initialShowDone) return;

    const windowHeight = window.innerHeight;
    const mouseY = event.clientY;

    // Show the dock when the mouse is near the bottom
    if (windowHeight - mouseY < 100) {
        dockWrapper.classList.add('show');
    } else {
        dockWrapper.classList.remove('show');
    }
});
