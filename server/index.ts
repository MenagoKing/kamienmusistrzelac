// Production server: the API, uploads, the built site (server-rendered with live data) and /admin.
// npm run build && npm start   (PORT, DATA_DIR, ADMIN_PASSWORD from the environment)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { handle } from './app.ts';
import { initAdmin } from './auth.ts';
import { pageData } from './store.ts';

const DIST = path.resolve('dist');
const PORT = Number(process.env.PORT) || 3000;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const { render } = await import(pathToFileURL(path.resolve('dist-ssr/entry-server.js')).href);

async function page(res: http.ServerResponse) {
  const data = pageData();
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('<div id="root"></div>', `<div id="root">${render(data)}</div><script id="sr-data" type="application/json">${json}</script>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function file(res: http.ServerResponse, p: string) {
  const f = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  const ext = path.extname(f).toLowerCase();
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(f).pipe(res);
  return true;
}

http.createServer(async (req, res) => {
  try {
    if (await handle(req, res)) return;
    const { pathname } = new URL(req.url ?? '/', 'http://local');
    if (pathname === '/' || pathname === '/index.html') return void (await page(res));
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return void file(res, '/admin.html');
    if (pathname === '/account' || pathname.startsWith('/account/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return void res.end(template.replace('<title>', '<meta name="robots" content="noindex"><title>'));
    }
    if (file(res, decodeURIComponent(pathname))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => {
  initAdmin();
  console.log(`Space Rocks on http://localhost:${PORT}  (admin: /admin)`);
});
