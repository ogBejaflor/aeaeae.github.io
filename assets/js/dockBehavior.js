window.attachDockItemHover = function(item) {
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
};

const dockItems = document.querySelectorAll('.dock-item');
dockItems.forEach(item => window.attachDockItemHover(item));

// Show and hide the dock when the mouse is near the bottom
const dockWrapper = document.getElementById('dock-wrapper');

// When the desktop turns on, show the dock for a moment (with a hint above it), then
// let it slide away until the mouse comes near the bottom.
let initialShowDone = false;
const SPOTLIGHT_MS = 4000;

function showDockHint(ms) {
    const hint = document.createElement('div');
    hint.id = 'ae-dock-hint';
    hint.textContent = 'move your mouse here for dock';
    hint.setAttribute('aria-hidden', 'true');
    hint.style.bottom = `${(dockWrapper.offsetHeight || 90) + 14}px`;
    (document.getElementById('desktop-root') || document.body).appendChild(hint);
    requestAnimationFrame(() => hint.classList.add('is-on'));
    setTimeout(() => {
        hint.classList.remove('is-on');
        setTimeout(() => hint.remove(), 900);
    }, ms);
}

function spotlightDock(ms, withHint) {
    initialShowDone = false;
    dockWrapper.classList.add('show');
    if (withHint) showDockHint(ms);
    setTimeout(() => {
        initialShowDone = true;
        dockWrapper.classList.remove('show');
    }, ms);
}

// The startup screen fires 'ae:desktop-on' when the desktop appears (also when it's skipped).
if (window.aeBootPending !== undefined) {
    window.addEventListener('ae:desktop-on', () => spotlightDock(SPOTLIGHT_MS, true), { once: true });
} else {
    spotlightDock(2500, false);
}

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
