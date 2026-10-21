import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/daemon/app.mjs';
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

test('F-2-17 S-04 two overlapping health calls start one resume session', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'overlap-')));
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/usr/bin/env node\nif (process.argv[2] === "auth") console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));\n');
  chmodSync(bin, 0o755);
  const plugin = join(dir, 'plugin');
  mkdirSync(join(plugin, 'skills', 'configure', 'scripts'), { recursive: true });
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ version: '0.136.0' }));
  writeFileSync(join(plugin, 'skills', 'configure', 'scripts', 'settings.mjs'), 'console.log("docs");');
  const worktree = join(dir, 'wt');
  mkdirSync(worktree);
  const config = join(dir, 'config');
  const projectDir = join(config, 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'sid.jsonl'), '');
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  const app = createApp({ dataDir: join(dir, 'data'), claudePath: bin, pluginRoot: plugin, parentEnv: { ...process.env } });
  try {
    app.state.cards.push({ id: 'c1', lane: 'Shaping' });
    app.state.jobs.push({ id: 'j1', cardId: 'c1', status: 'running', worktree, sessionId: 'sid' });
    const starts = [];
    app.supervisor.start = (o) => { starts.push(o.mode); return Promise.resolve({ done: new Promise(() => {}) }); };
    const port = await app.start();
    assert.equal(starts.length, 1, 'start resumes once');
    app.state.jobs[0].status = 'running';
    starts.length = 0;
    app.state.jobs.length = 0;
    const old = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    old.unref();
    app.state.jobs.push({ id: 'j2', cardId: 'c1', status: 'running', worktree, sessionId: 'sid', pid: old.pid, pgid: old.pid });
    const url = `http://127.0.0.1:${port.port}/api/health`;
    const get = () => fetch(url, { headers: { authorization: `Bearer ${app.token}` } }).then((r) => r.status);
    assert.deepEqual(await Promise.all([get(), get()]), [200, 200]);
    assert.deepEqual(starts, ['resume']);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    await app.close();
  }
});
