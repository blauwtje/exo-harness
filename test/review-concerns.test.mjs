import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createServer } from '../src/daemon/server.mjs';
import { killGroup } from '../src/daemon/session.mjs';
import { FINAL_STATUSES } from '../src/daemon/usage.mjs';
import { FINAL } from '../src/ui/derive.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('token: Authorization Bearer on /api/, ?token= only for /events', async () => {
  const app = createServer({ token: 'tok-123', routes: { 'GET /api/ping': async () => ({ ok: true }) } });
  const port = await app.listen(0);
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode);
      if (path.startsWith('/events')) req.destroy();
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
  try {
    assert.equal(await get('/api/ping', { authorization: 'Bearer tok-123' }), 200);
    assert.equal(await get('/api/ping', { authorization: 'Bearer nope' }), 401);
    assert.equal(await get('/api/ping?token=tok-123'), 401);
    assert.equal(await get('/events?token=tok-123'), 200);
  } finally { await app.close(); }
});

test('deck.js does not swallow a failed transcript or health load', () => {
  const deck = src('src/ui/deck.js');
  assert.doesNotMatch(deck, /catch\s*\{\s*loaded/);
  assert.doesNotMatch(deck, /\(\)\s*=>\s*\{\}\)/);
});

test('killGroup ignores ESRCH and reports every other error', () => {
  const real = process.kill;
  const seen = [];
  try {
    process.kill = () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); };
    killGroup(4321, 'SIGTERM', (m) => seen.push(m));
    assert.deepEqual(seen, []);
    process.kill = () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); };
    killGroup(4321, 'SIGTERM', (m) => seen.push(m));
    assert.equal(seen.length, 1);
    assert.match(seen[0], /EPERM/);
  } finally { process.kill = real; }
});

test('one final-status set shared by the daemon, reconcile and the deck', () => {
  assert.equal(FINAL, FINAL_STATUSES);
  for (const f of ['src/daemon/app.mjs', 'src/daemon/reconcile.mjs', 'src/ui/derive.js']) {
    assert.doesNotMatch(src(f), /new Set\(\['done'/, f);
  }
});
