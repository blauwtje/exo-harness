import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/daemon/server.mjs';

const root = mkdtempSync(join(tmpdir(), 'srv-'));
const distDir = join(root, 'dist');
mkdirSync(distDir);
writeFileSync(join(distDir, 'index.html'), '<h1>deck</h1>');
writeFileSync(join(root, 'secret.txt'), 'secret');

const TOKEN = 'tok-123';
const app = createServer({
  token: TOKEN,
  distDir,
  routes: { 'GET /api/ping': async () => ({ pong: true }), 'POST /api/echo': async ({ body }) => body },
});
const port = await app.listen(0);
after(() => app.close());

const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
  });
  req.on('error', reject);
  req.end(body);
});
const auth = { 'x-exo-token': TOKEN };

test('binds 127.0.0.1 only', () => {
  assert.equal(app.server.address().address, '127.0.0.1');
});

test('token: missing and wrong are 401, right passes', async () => {
  assert.equal((await call('/api/ping')).status, 401);
  assert.equal((await call('/api/ping', { headers: { 'x-exo-token': 'nope' } })).status, 401);
  const ok = await call('/api/ping', { headers: auth });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text), { pong: true });
});

test('Host check rejects a rebinding name', async () => {
  const r = await call('/api/ping', { headers: { ...auth, host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
});

test('Origin check rejects a foreign page, accepts own origin', async () => {
  const bad = await call('/api/ping', { headers: { ...auth, origin: 'http://evil.example' } });
  assert.equal(bad.status, 403);
  const good = await call('/api/ping', { headers: { ...auth, origin: `http://127.0.0.1:${port}` } });
  assert.equal(good.status, 200);
});

test('POST JSON body round trips; bad JSON is 400', async () => {
  const r = await call('/api/echo', { method: 'POST', headers: auth, body: '{"a":1}' });
  assert.deepEqual(JSON.parse(r.text), { a: 1 });
  assert.equal((await call('/api/echo', { method: 'POST', headers: auth, body: '{' })).status, 400);
});

test('unknown route is 404', async () => {
  assert.equal((await call('/api/none', { headers: auth })).status, 404);
});

test('static files served from dist without token; traversal blocked', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /deck/);
  assert.equal((await call('/../secret.txt')).status, 404);
  assert.equal((await call('/%2e%2e/secret.txt')).status, 404);
});

test('SSE needs the token and streams broadcasts', async () => {
  assert.equal((await call('/events')).status, 401);
  const got = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/events?token=${TOKEN}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      let text = '';
      res.on('data', (c) => {
        text += c;
        if (text.includes('event: job')) { req.destroy(); resolve(text); }
        else if (text.includes(': open')) app.broadcast('job', { id: 1 });
      });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
  assert.match(got, /data: \{"id":1\}/);
});
