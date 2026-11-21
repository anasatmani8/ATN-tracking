#!/usr/bin/env node
// Serves the exported web build (dist/) with the cross-origin isolation headers that
// expo-sqlite needs on web, and an SPA fallback. Used by the e2e suite. Usage: node scripts/serve-web.js [port] [dir]
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] ?? process.env.PORT ?? 8081);
const root = path.resolve(__dirname, '..', process.argv[3] ?? 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const html = path.join(root, url, 'index.html');
    file = fs.existsSync(html) ? html : fs.existsSync(`${file}.html`) ? `${file}.html` : path.join(root, 'index.html');
  }
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
