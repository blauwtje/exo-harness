import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/daemon/app.mjs';

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const binPath = new URL('../bin/exo-harness.mjs', import.meta.url).pathname;

function plugin() {
  const root = tmp('app-plugin-');
  mkdirSync(join(root, 'skills', 'configure', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.136.0' }));
  writeFileSync(join(root, 'skills', 'configure', 'scripts', 'settings.mjs'), 'console.log("docs");');
  return root;
}

function claude(dir, auth) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
if (process.argv[2] === 'auth') { console.log(${JSON.stringify(JSON.stringify(auth))}); process.exit(0); }
require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'spawned'))}, 'yes');
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  return bin;
}

function repo() {
  const dir = tmp('app-repo-');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

async function boot(auth = { loggedIn: true, authMethod: 'claude.ai' }, seed) {
  const dir = tmp('app-dir-');
  const data = join(dir, 'data');
  mkdirSync(data);
  if (seed) writeFileSync(join(data, 'state.json'), JSON.stringify(seed));
  const app = createApp({ dataDir: data, claudePath: claude(dir, auth), pluginRoot: plugin(), parentEnv: { ...process.env } });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const call = async (method, path, { body, headers }) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const api = (method, path, body) => call(method, path, { body, headers: { authorization: `Bearer ${token}` } });
  const raw = (method, path, headers) => call(method, path, { headers });
  return { app, api, raw, dir, port, token };
}

test('S-01 F-2-07 a failed auth check blocks Shape before any spawn or worktree', async () => {
  const t = await boot({ loggedIn: false });
  try {
    const project = repo();
    const p = (await t.api('POST', '/api/projects', { path: project })).body;
    const card = (await t.api('POST', '/api/cards', { projectKey: p.key, title: 'Greet' })).body;
    const res = await t.api('POST', `/api/cards/${card.id}/shape`);
    assert.equal(res.status, 412);
    assert.match(res.body.error, /not logged in.*claude auth login/);
    assert.equal(existsSync(join(t.dir, 'spawned')), false);
    assert.equal(existsSync(join(project, '.worktrees')), false);
    assert.equal((await t.api('GET', '/api/state')).body.jobs.length, 0);
  } finally {
    await t.app.close();
  }
});

test('F-2-01 every route needs the token and a loopback Host', async () => {
  const t = await boot();
  try {
    for (const [m, path] of [['GET', '/api/state'], ['GET', '/api/health'], ['POST', '/api/stop-all'], ['GET', '/api/jobs/x/transcript']]) {
      assert.equal((await t.raw(m, path, {})).status, 401, path);
      assert.equal((await t.raw(m, path, { authorization: 'Bearer wrong' })).status, 401, path);
    }
    assert.equal((await t.raw('GET', '/api/state', { authorization: `Bearer ${t.token}`, origin: 'http://evil.example' })).status, 403);
    assert.equal((await t.api('GET', '/api/jobs/x/transcript')).status, 404);
  } finally {
    await t.app.close();
  }
});

test('F-2-03 F-2-21 projects and cards persist, bad input is refused, health reports the four checks', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('POST', '/api/projects', { path: tmp('app-notgit-') })).status, 400);
    assert.equal((await t.api('POST', '/api/projects', {})).status, 400);
    const p = (await t.api('POST', '/api/projects', { path: repo() })).body;
    assert.match(p.key, /^local\//);
    assert.equal((await t.api('POST', '/api/cards', { projectKey: 'nope', title: 'x' })).status, 400);
    assert.equal((await t.api('POST', '/api/cards', { projectKey: p.key, title: '' })).status, 400);
    const card = (await t.api('POST', '/api/cards', { projectKey: p.key, title: 'Greet' })).body;
    assert.equal(card.lane, 'Inbox');
    const state = (await t.api('GET', '/api/state')).body;
    assert.equal(state.cards.length, 1);
    const health = (await t.api('GET', '/api/health')).body;
    assert.deepEqual(Object.keys(health).sort(), ['claude', 'exo', 'specs', 'tree']);
    assert.equal(health.claude.ok, true);
    assert.equal(health.specs.ok, true);
  } finally {
    await t.app.close();
  }
});

test('F-2-15 C-03 start reconciles a job left running: a missing worktree marks it crashed', async () => {
  const seed = {
    projects: [], cards: [{ id: 'c1', projectKey: 'local/x', title: 't', lane: 'Inbox' }],
    jobs: [{ id: 'j1', cardId: 'c1', stage: 'spec', status: 'running', sessionId: 's', worktree: '/nonexistent/wt' }],
  };
  const t = await boot(undefined, seed);
  try {
    const job = (await t.api('GET', '/api/state')).body.jobs[0];
    assert.equal(job.status, 'crashed');
    assert.equal(job.crashReason, 'worktree-missing');
  } finally {
    await t.app.close();
  }
});

test('F-2-01 the entry prints the token URL and serves it', async () => {
  const dir = tmp('app-bin-');
  const env = { ...process.env, EXO_HARNESS_DATA: join(dir, 'data'), EXO_HARNESS_CLAUDE: claude(dir, { loggedIn: true, authMethod: 'claude.ai' }), EXO_PLUGIN_ROOT: plugin() };
  const child = spawn(process.execPath, [binPath, '--fixtures'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise((resolve, reject) => {
      child.stdout.once('data', (d) => resolve(String(d)));
      child.once('exit', (c) => reject(new Error(`exited ${c}`)));
    });
    const url = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]+/.exec(line)?.[0];
    assert.ok(url, line);
    const u = new URL(url);
    const res = await fetch(`${u.origin}/api/state`, { headers: { authorization: `Bearer ${u.hash.replace(/^#token=/, '')}` } });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${u.origin}/api/state`)).status, 401);
  } finally {
    child.kill('SIGTERM');
  }
});

test('F-3-14 S-05 the failure inbox lists exo-run jobs with their outcome', async () => {
  const seed = {
    projects: [{ key: 'local/p', path: '/x', origin: null }],
    cards: [{ id: 'c1', projectKey: 'local/p', title: 'T', lane: 'Review' }],
    jobs: [
      { id: 'r1', cardId: 'c1', stage: 'run', status: 'waiting', run: { id: 'x', phase: 'parked' } },
      { id: 'r2', cardId: 'c1', stage: 'run', status: 'crashed', outcome: 'setup' },
      { id: 'r3', cardId: 'c1', stage: 'run', status: 'done', run: { id: 'y', phase: 'passed' } },
    ],
  };
  const t = await boot(undefined, seed);
  try {
    const res = await t.api('GET', '/api/inbox');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((i) => [i.jobId, i.outcome]), [['r1', 'question'], ['r2', 'setup']]);
    assert.equal((await t.raw('GET', '/api/inbox')).status, 401);
  } finally { await t.app.close(); }
});
