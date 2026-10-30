// Copy to js/secrets.js (git-ignored) and fill in before ./build.sh install. Couch TV ships no stream
// sources: everything below except tmdbKey is optional, and you choose what to point it at.
window.COUCH_SECRETS = {
  // TMDB v3 API key (free at themoviedb.org): the catalog, artwork and search.
  tmdbKey: '',

  // Stremio add-ons: manifest URLs. Torrent results play through the TV's torrent engine, http ones directly.
  addons: [
    // 'https://example-addon.example/manifest.json'
  ],

  // A stream server for films and episodes, speaking the API in docs/streaming-provider.md.
  // provider: 'http://192.168.1.10:8788',

  // M3U playlists: their cricket and football channels appear on the Sports screen (default: iptv-org's free sports channels).
  // playlists: ['https://iptv-org.github.io/iptv/categories/sports.m3u'],

  // A sports relay serving /sports.json and /sports/health (docs/streaming-provider.md).
  // sportsRelay: 'http://192.168.1.10:8790',

  // The torrent engine runs on the TV; set this only to use another one.
  // torrentServer: 'http://192.168.1.10:11470'
};
