// assets/js/musicData.js
// Esta é a lista manual da tua música. 
// Sempre que adicionares música no GitHub dentro da pasta "Catalogo",
// abre este ficheiro e copia um bloco de álbum para adicionar o novo.

window.musicCatalog = [
  {
    id: "athoms_1",
    artist: "Athoms",
    albumTitle: "Synthetic Dreams",
    // O caminho para a capa do álbum! 
    coverArt: "Catalogo/Athoms/Synthetic Dreams/cover.jpg",
    tracks: [
      { 
        id: "athoms_t1", 
        title: "Neon Horizon", 
        // O caminho para a música
        file: "Catalogo/Athoms/Synthetic Dreams/01_Neon_Horizon.mp3", 
        duration: "3:42" 
      },
      { 
        id: "athoms_t2", 
        title: "Digital Dust", 
        file: "Catalogo/Athoms/Synthetic Dreams/02_Digital_Dust.mp3", 
        duration: "4:15" 
      }
    ]
  },
  
  {
    id: "bejaflor_1",
    artist: "Bejaflor",
    albumTitle: "Nature's Blueprint",
    coverArt: "Catalogo/Bejaflor/Nature's Blueprint/cover.jpg",
    tracks: [
      { 
        id: "bejaflor_t1", 
        title: "Spring Awakening", 
        file: "Catalogo/Bejaflor/Nature's Blueprint/01_Spring_Awakening.mp3", 
        duration: "2:50" 
      }
    ]
  },

  {
    id: "proxyfae_1",
    artist: "Proxy Fae",
    albumTitle: "Soft Armor",
    coverArt: "Catalogo/Proxy Fae/Soft Armor/cover.jpg",
    tracks: [
      { 
        id: "proxyfae_t1", 
        title: "Velvet Shield", 
        file: "Catalogo/Proxy Fae/Soft Armor/01_Velvet_Shield.mp3", 
        duration: "5:01" 
      },
      { 
        id: "proxyfae_t2", 
        title: "Iron Lace", 
        file: "Catalogo/Proxy Fae/Soft Armor/02_Iron_Lace.mp3", 
        duration: "3:30" 
      }
    ]
  }
  
  /* 
  ===========================================
  Para adicionares o próximo, copia este bloco e preenche:
  ===========================================
  ,{
    id: "nomedoartista_2",
    artist: "Nome do Artista",
    albumTitle: "Nome do Album Novo",
    coverArt: "Catalogo/Nome do Artista/Nome do Album Novo/cover.jpg",
    tracks: [
      { id: "nomedoartista_novo1", title: "Música 1", file: "Catalogo/Nome do Artista/Nome do Album Novo/musica_1.mp3", duration: "1:00" },
      { id: "nomedoartista_novo2", title: "Música 2", file: "Catalogo/Nome do Artista/Nome do Album Novo/musica_2.mp3", duration: "2:00" }
    ]
  }
  */
];
