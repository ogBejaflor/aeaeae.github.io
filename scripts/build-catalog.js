const fs = require('fs');
const path = require('path');

const catalogDir = path.join(__dirname, '../Catalogo');
const outputFile = path.join(__dirname, '../assets/js/musicData.js');

function formatTitle(filename) {
  // Remova a extensão e substitua
  let name = filename.replace(/\.(mp3|wav|ogg|flac|m4a)$/i, '');
  // Remove números listados no início do ficheiro tipo "01_ ", "01-", "01."
  name = name.replace(/^(\d+[\s_\.\-]+)/, '');
  // Converte underlines para espaços
  name = name.replaceAll('_', ' ');
  return name.trim();
}

function buildCatalog() {
  if (!fs.existsSync(catalogDir)) {
    console.warn(`Aviso: A pasta Catalogo não existe em ${catalogDir}`);
    return;
  }

  const catalog = [];
  const artists = fs.readdirSync(catalogDir).filter(f => fs.statSync(path.join(catalogDir, f)).isDirectory());

  let globalAlbumId = 1;
  let globalTrackId = 1;

  for (const artist of artists) {
    const artistPath = path.join(catalogDir, artist);
    const albums = fs.readdirSync(artistPath).filter(f => fs.statSync(path.join(artistPath, f)).isDirectory());

    for (const album of albums) {
      const albumPath = path.join(artistPath, album);
      const albumFiles = fs.readdirSync(albumPath);

      // Procurar pela capa (tem de se chamar cover.jpg / cover.png)
      const coverFile = albumFiles.find(f => /^cover\.(jpe?g|png)$/i.test(f));
      
      // Construir caminho relativo standard do HTML
      const coverArtPath = coverFile 
        ? `Catalogo/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/${encodeURIComponent(coverFile)}` 
        : 'assets/images/default-album-art.png';

      const tracks = [];
      const audioFiles = albumFiles
        .filter(f => /\.(mp3|wav)$/i.test(f))
        .sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })); // Ordena "10" depois de "2"

      for (const audioFile of audioFiles) {
        tracks.push({
          id: `t_${globalTrackId++}`,
          title: formatTitle(audioFile),
          file: `Catalogo/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/${encodeURIComponent(audioFile)}`,
          duration: "--" // Duração extraída dinamicamente no frontend ou escondida
        });
      }

      // Adicionar à Base de dados apenas se existirem Ficheiros Áudio
      if (tracks.length > 0) {
        catalog.push({
          id: `a_${globalAlbumId++}`,
          artist: artist,
          albumTitle: album,
          coverArt: coverArtPath,
          tracks: tracks
        });
      }
    }
  }

  // Gravar no ficheiro assets/js/musicData.js
  const fileContent = `// assets/js/musicData.js
// GERADO AUTOMATICAMENTE PELO GITHUB ACTION (scripts/build-catalog.js)
// Não edites manualmente se usas o Automação no GitHub!

window.musicCatalog = ${JSON.stringify(catalog, null, 2)};
`;

  fs.writeFileSync(outputFile, fileContent, 'utf8');
  console.log(`Catálogo reconstruído: ${catalog.length} álbuns encontrados.`);
}

buildCatalog();
