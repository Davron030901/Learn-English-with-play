#!/usr/bin/env node
/**
 * Serves the exported web build (`npm run export:web` → dist/) as a single-page app: any path
 * that is not a file gets index.html, so deep links like /lesson/S01U01N1.t1 load the app.
 * Used by the Playwright e2e suite and for a quick local look. Not a production server.
 *
 *   node scripts/serve-web.mjs [dir=dist]   (PORT=8081 by default — an origin the backend's CORS allows)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 8081);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.lep': 'application/octet-stream',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`${root}/index.html not found — run \`npm run export:web\` first`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    // Content-hashed files (bundles, fonts, the packed course) never change under one name: cache
    // them for good, so a unit fetched once still opens offline. The page itself is always fresh.
    const hashed = /^\/(assets|_expo\/static)\//.test(pathname) && file !== path.join(root, 'index.html');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} at http://localhost:${port}`));
