# ae-boot — the startup screen

"turn on computer" → ripple → heavenly light, flare, chrome logo → the desktop.
Runtime copied from the ae-boot-source package (v4.1). It's wired into
`index.html` (head styles, the `#ae-boot` overlay, the `#desktop-root` wrapper and
the controller script at the end of the page).

- Change the look: paste a preset's `options` into `site-options.js`.
- Skip it for one load: add `?boot=off` to the address. The admin's preview also
  skips it when it refreshes itself after an edit.
- Don't edit, convert or optimise `assets/*.png` — they hold distance data.
- Pop-ups wait for the `ae:desktop-on` event, fired when the desktop turns on.

## Sound (ambient.js)

While waiting, a generative granular cloud plays, made from excerpts of the label's
songs (prepared by the admin → `ambient/`, listed in `ambient/bank.json`). Every song
is tuned to one shared key inside the grains. The pointer steers it: angle around the
button picks songs, distance sets reverb/echo/clarity, x moves through the excerpts,
y sets grain size and octave shimmer. A string sound rises near the button.
On click: bubble; when the animation starts: the boot sound (in sync).

- Sound files: `ambient/sounds/bubble|string|boot.*`, uploaded on the admin's Startup
  page. Without them, built-in stand-ins play.
- Browsers need a click/tap/key before any sound: the first click on the black area
  wakes the cloud; clicking the button first goes straight to the bubble + boot.
- The boot sound starts when the animation does (after the ripple) and is made to
  match its length (9.2 s by default; change both together if you change `duration`).
