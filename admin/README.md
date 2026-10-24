# æ admin

Edit the site without touching code: artists, releases and tracks, pop-ups, the desktop background, and the gallery.

## Start it

1. Install [Node.js](https://nodejs.org) (LTS) once.
2. Double-click **`admin/start.command`**. The first time it sets itself up (needs internet for a minute).
3. The admin opens at <http://localhost:3000/admin>. Keep the Terminal window open while you edit; close it to stop.

From a terminal instead: `cd admin && npm install && npm start`.

## How it works

- Every edit saves straight away and rebuilds the site's data. The preview at <http://localhost:3000> refreshes by itself.
- **Publish** (bottom left) sends your changes to GitHub. The live site updates a minute or two later.
- Deleting anything moves it to **Deleted**, where you can restore it. Deleted items are never published.

| In the admin | Where it's stored |
| --- | --- |
| Artists (order, bio, hidden) | `data/roster.json`, photos in `Catalogo/<Artist>/photo.jpg` |
| Releases and tracks | `Catalogo/<Artist>/<Release>/` (cover, audio, `album.json` for order/titles/year) |
| Pop-ups | `data/notifications.json`, timing + welcome in `data/settings.json` |
| Desktop background, tab title | `data/settings.json`, uploads in `assets/uploads/` |
| Gallery | `Archive/` |

The site never reads those files directly: `scripts/build.js` turns them into `assets/js/*Data.js` + `siteSettings.js`, which is why the site keeps working as a plain static site on GitHub Pages. You can also run `node scripts/build.js` by hand after editing files yourself.

### Large audio

GitHub refuses files over 100 MB and big WAVs make the site slow. Each release with WAV-only tracks shows **Make MP3s** (needs ffmpeg: `brew install ffmpeg`). The site plays the MP3 when both exist.

## Later: running it on a real host

The same server can run on a host (Render, Railway, Fly.io, a VPS…) so the admin is part of the website:

```bash
cd admin && npm install
SITE_MODE=hosted ADMIN_PASSWORD='choose-a-long-one' PORT=8080 node server.js
```

- Serves the site at `/` and the admin at `/admin`, behind the password.
- Edits are live immediately (no Publish step).
- The host needs a **persistent disk** for the repo folder, since content is stored as files.
- If you'd rather keep GitHub as the source of truth, keep using the admin locally and Publish — nothing changes.

Everything that reads or writes content lives in `admin/lib/content.js`, so moving to a database or cloud storage later means replacing that one file; the admin page and the site stay the same.

## Files

- `server.js` — the server and API routes
- `lib/content.js` — all content changes (artists, releases, pop-ups, settings, gallery, deleted items)
- `lib/publish.js` — Publish (git commit + push)
- `lib/auth.js` — password login for hosted mode
- `public/` — the admin page (plain HTML/CSS/JS, no build step)
