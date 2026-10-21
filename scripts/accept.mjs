import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../bin/exo-harness.mjs', import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'exo-accept-')));
const until = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error('accept: timed out');
};

const CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const out = (o) => console.log(JSON.stringify(o));
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const next = async (type) => { for (;;) { const { value, done } = await rl.next(); if (done) process.exit(0); if (JSON.parse(value).type === type) return; } };
(async () => {
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
  await next('user');
  out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', options: [{ label: 'A' }, { label: 'B' }] }] } } });
  await next('control_response');
  fs.mkdirSync('docs/specs', { recursive: true });
  fs.writeFileSync('docs/specs/greet.md', '# Greet\\n');
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Brief written: docs/specs/greet.md' }] } });
  out({ type: 'result', subtype: 'success' });
  await next('never');
})();
`;

function setup() {
  const bin = join(root, 'claude');
  writeFileSync(bin, CLAUDE);
  chmodSync(bin, 0o755);
  const plugin = join(root, 'plugin');
  cpSync(fileURLToPath(new URL('../test/fake-claude/plugin-root', import.meta.url)), plugin, { recursive: true });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return { bin, plugin, repo };
}

function startDaemon({ bin, plugin }) {
  const env = { ...process.env, EXO_HARNESS_DATA: join(root, 'data'), EXO_HARNESS_CLAUDE: bin, EXO_PLUGIN_ROOT: plugin };
  const child = spawn(process.execPath, [entry, '--fixtures'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const url = new Promise((resolve, reject) => {
    let seen = '';
    child.stdout.on('data', (d) => { seen += d; const m = seen.match(/exo-harness: (\S+)/); if (m) resolve(m[1]); });
    child.on('exit', () => reject(new Error('accept: daemon exited before printing its URL')));
  });
  return { child, url };
}

const daemon = startDaemon(setup());
let pgid;
try {
  const url = new URL(await daemon.url);
  const api = async (method, path, body) => {
    const res = await fetch(`${url.origin}${path}`, {
      method, headers: { authorization: `Bearer ${url.hash.replace(/^#token=/, '')}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const state = async () => (await api('GET', '/api/state')).body;

  const project = (await api('POST', '/api/projects', { path: join(root, 'repo') })).body;
  const card = (await api('POST', '/api/cards', { projectKey: project.key, title: 'Greet', body: 'add greeting' })).body;
  const shaped = await api('POST', `/api/cards/${card.id}/shape`);
  assert.equal(shaped.status, 200, 'Shape accepted');
  const ask = await until(async () => (await state()).pending[0]);
  assert.equal(ask.requestId, 'r1');
  await api('POST', `/api/jobs/${shaped.body.id}/permission`, { requestId: 'r1', allow: true, answers: { 'A or B?': 'A' } });
  await until(async () => (await state()).jobs[0].status === 'done');

  const final = await state();
  assert.equal(final.cards[0].lane, 'Shaped');
  assert.match(final.jobs[0].brief, /docs\/specs\/greet\.md$/);
  pgid = final.jobs[0].pgid;
  assert.ok(pgid, 'job records its process group');

  assert.equal((await api('POST', '/api/stop-all')).status, 200);
  await until(() => {
    try { process.kill(-pgid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
  });
  console.log('accept: pass (Shaped, brief checked, no live child after Stop all)');
} finally {
  daemon.child.kill('SIGTERM');
  if (pgid) try { process.kill(-pgid, 'SIGKILL'); } catch { pgid = null; }
  rmSync(root, { recursive: true, force: true });
}
