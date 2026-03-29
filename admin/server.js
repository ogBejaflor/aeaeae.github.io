const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up Paths
const rootDir = path.join(__dirname, '..');
const catalogDir = path.join(rootDir, 'Catalogo');

// ----------------------------------------
// Get Catalog Structure
// ----------------------------------------
app.get('/api/catalog', (req, res) => {
  if (!fs.existsSync(catalogDir)) {
    return res.json([]);
  }

  const artists = [];
  const artistFolders = fs.readdirSync(catalogDir);
  
  for (const artist of artistFolders) {
    if (artist.startsWith('.') || !fs.statSync(path.join(catalogDir, artist)).isDirectory()) continue;
    
    const albums = [];
    const albumFolders = fs.readdirSync(path.join(catalogDir, artist));
    for (const album of albumFolders) {
      if (album.startsWith('.') || !fs.statSync(path.join(catalogDir, artist, album)).isDirectory()) continue;
      albums.push(album);
    }
    
    artists.push({ name: artist, albums });
  }

  res.json(artists);
});

// ----------------------------------------
// Upload Music/Cover Configuration
// ----------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let artist = req.body.artist;
    let album = req.body.album;
    
    // Create folders if they don't exist
    const targetDir = path.join(catalogDir, artist, album);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname); // Retains exact native filename
  }
});
const upload = multer({ storage });

app.post('/api/upload-track', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  try {
    res.json({ success: true, message: 'Upload complete!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Upload failed.', error: err.message });
  }
});

// ----------------------------------------
// Upload General Media (Galery / Archive)
// ----------------------------------------
const archiveDir = path.join(rootDir, 'Archive');

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let targetDir = archiveDir;
    if (req.body.mediafolder) {
      targetDir = path.join(archiveDir, req.body.mediafolder.trim());
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const uploadMedia = multer({ storage: mediaStorage });

app.post('/api/upload-media', uploadMedia.single('mediafile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    res.json({ success: true, message: 'Media uploaded to Archive!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Media upload failed.', error: err.message });
  }
});

// ----------------------------------------
// Trigger Scripts
// ----------------------------------------
app.post('/api/build-catalog', (req, res) => {
  exec('node scripts/build-catalog.js && node scripts/build-gallery.js', { cwd: rootDir }, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, output: stderr });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/api/publish', (req, res) => {
  const cmd = 'git add . && git commit -m "CMS Content Update" && git push';
  exec(cmd, { cwd: rootDir }, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, output: stderr });
    }
    res.json({ success: true, output: stdout });
  });
});

// ----------------------------------------
// Notifications Management
// ----------------------------------------
const notificationsFile = path.join(rootDir, 'data', 'notifications.json');

app.get('/api/notifications', (req, res) => {
  if (!fs.existsSync(notificationsFile)) {
    return res.json([]);
  }
  try {
    const data = JSON.parse(fs.readFileSync(notificationsFile, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notifications', (req, res) => {
  try {
    const newNotifications = req.body.notifications; // Expects an array
    fs.writeFileSync(notificationsFile, JSON.stringify(newNotifications, null, 2), 'utf8');
    
    // Rebuild the JS file immediately
    exec('node scripts/build-notifications.js', { cwd: rootDir }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ success: false, output: stderr });
      res.json({ success: true, message: 'Notifications saved and rebuilt!' });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`CMS Backend running at http://localhost:${PORT}`);
});
