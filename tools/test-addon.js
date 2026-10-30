// Tiny Stremio add-on for end-to-end tests with legal content (Sintel).
// Usage: node tools/test-addon.js [port]
//   default port: 7000
const http = require('http');

const port = parseInt(process.argv[2], 10) || 7000;
const manifest = {
  id: 'couch.test',
  version: '1.0.0',
  name: 'Couch Test',
  description: 'Test add-on for Couch TV',
  resources: ['stream'],
  types: ['movie'],
  idPrefixes: ['tt'],
};

// fileIdx 5 for Sintel.mp4 must match the streaming server's file list (another agent confirms it).
const sintel = {
  streams: [{
    name: 'Test\n1080p',
    description: 'Sintel.2010.1080p.x264\n👤 50 💾 1.2 GB ⚙️ test',
    infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10',
    fileIdx: 5,
  }],
};
const empty = { streams: [] };

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const path = decodeURI((req.url || '').split('?')[0]);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (path === '/manifest.json' || path === '/') {
    res.writeHead(200);
    res.end(JSON.stringify(manifest));
  } else if (path === '/stream/movie/tt1727587.json') {
    res.writeHead(200);
    res.end(JSON.stringify(sintel));
  } else if (path.startsWith('/stream/')) {
    res.writeHead(200);
    res.end(JSON.stringify(empty));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(port, () => {
  console.log('test add-on listening on http://localhost:' + port);
});
