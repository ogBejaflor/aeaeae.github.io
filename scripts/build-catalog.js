// Kept for old habits — everything is built by scripts/build.js now.
const r = require('./build.js').buildAll();
console.log(`Built: ${r.artists} artists, ${r.albums} albums, ${r.popups} pop-ups, ${r.media} gallery items.`);
