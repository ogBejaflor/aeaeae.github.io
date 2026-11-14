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
