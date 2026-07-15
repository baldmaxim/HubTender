// Этап 2.4 (§13/§14): раздача PRODUCTION bundle (dist/) + same-origin proxy
// /api, /health и WebSocket /api/v1/ws на backend — браузерный smoke идёт
// против production-сборки, а не dev-сервера.
//
//   node scripts/readiness/e2e-static-server.mjs <listenPort> <backendPort>
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , listenPortRaw, backendPortRaw] = process.argv;
const LISTEN = Number(listenPortRaw ?? 8010);
const BACKEND = Number(backendPortRaw ?? 8011);
const DIST = normalize(join(process.cwd(), 'dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function proxy(req, res) {
  const up = http.request(
    { host: '127.0.0.1', port: BACKEND, path: req.url, method: req.method, headers: req.headers },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'backend unavailable' }));
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url.startsWith('/api/') || url.startsWith('/health')) {
    proxy(req, res);
    return;
  }
  let file = normalize(join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, 'index.html'); // SPA fallback
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// WebSocket upgrade → backend (realtime-хаб). Все sockets получают
// error-handlers: разрыв соединения браузером не должен ронять процесс.
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  const up = http.request({
    host: '127.0.0.1', port: BACKEND, path: req.url, method: req.method, headers: req.headers,
  });
  up.on('upgrade', (upRes, upSocket, upHead) => {
    upSocket.on('error', () => { upSocket.destroy(); socket.destroy(); });
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [k, v] of Object.entries(upRes.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead?.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  up.on('error', () => socket.destroy());
  if (head?.length) up.write(head);
  up.end();
});

server.on('clientError', (_err, socket) => socket.destroy());
process.on('uncaughtException', (err) => {
  console.error('static-server uncaught:', err?.message ?? err);
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`e2e static server: http://127.0.0.1:${LISTEN} → backend :${BACKEND}, dist=${DIST}`);
});
