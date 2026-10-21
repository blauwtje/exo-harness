import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const HOST = '127.0.0.1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const MAX_BODY = 1_000_000;

const sameToken = (given, token) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) return reject(Object.assign(new Error('body too large'), { status: 413 }));
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { reject(Object.assign(new Error('bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function serveFile(req, res, { distDir, pathname }) {
  if (req.method !== 'GET' || !distDir) return sendJson(res, 404, { error: 'not found' });
  return sendStatic(res, distDir, pathname);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function sendStatic(res, distDir, pathname) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const file = join(distDir, rel);
  if (!file.startsWith(distDir + sep)) return sendJson(res, 404, { error: 'not found' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

export function createServer({ routes = {}, token, distDir = null }) {
  if (!token) throw new Error('createServer needs a token');
  const clients = new Set();
  let allowed = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowed.has(req.headers.host)) return sendJson(res, 403, { error: 'bad Host' });
      if (req.headers.origin !== undefined && !allowed.has(req.headers.origin?.replace(/^http:\/\//, ''))) {
        return sendJson(res, 403, { error: 'bad Origin' });
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const guarded = url.pathname.startsWith('/api/') || url.pathname === '/events';
      if (!guarded) return await serveFile(req, res, { distDir, pathname: url.pathname });
      if (!sameToken(req.headers['x-exo-token'] ?? url.searchParams.get('token'), token)) {
        return sendJson(res, 401, { error: 'bad token' });
      }
      if (url.pathname === '/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': open\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return sendJson(res, 404, { error: 'not found' });
      const body = req.method === 'GET' ? {} : await readJson(req);
      sendJson(res, 200, await handler({ body, url }));
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.message });
      else res.end();
    }
  });

  return {
    server,
    listen: (port = 0) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, () => {
        const actual = server.address().port;
        allowed = new Set([`${HOST}:${actual}`, `localhost:${actual}`]);
        resolve(actual);
      });
    }),
    broadcast(event, data) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) c.write(frame);
    },
    close() {
      for (const c of clients) c.end();
      clients.clear();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
