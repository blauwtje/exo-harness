import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/daemon/app.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const until = async (fn) => { for (let i = 0; i < 80; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail('timed out'); };

function fakeClaude(dir) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const out = (o) => console.log(JSON.stringify(o));
fs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
require('node:readline').createInterface({ input: process.stdin }).once('line', () => {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Cause: a.txt diverged. See docs/specs/cause.md' }] } });
  out({ type: 'result', subtype: 'success' });
  setInterval(() => {}, 1000);
});
`);
  chmodSync(bin, 0o755);
  return bin;
}

async function boot() {
  const dir = tmp('fc-dir-');
  const wt = tmp('fc-wt-');
  const other = tmp('fc-other-');
  const data = join(dir, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'state.json'), JSON.stringify({
    projects: [{ key: 'local/p', path: wt, origin: null }],
    cards: [{ id: 'c1', projectKey: 'local/p', title: 'T', lane: 'Review' }, { id: 'c2', projectKey: 'local/p', title: 'U', lane: 'Review' }],
    jobs: [
      { id: 'gate', cardId: 'c1', stage: 'run', status: 'waiting', worktree: wt, needsYou: { kind: 'conflict', options: ['find-cause'] } },
      { id: 'plain', cardId: 'c2', stage: 'run', status: 'waiting', worktree: other, needsYou: { kind: 'gate', options: ['approve'] } },
    ],
  }));
  const app = createApp({ dataDir: data, claudePath: fakeClaude(dir), pluginRoot: fakeRoot, parentEnv: { ...process.env } });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { app, api, wt };
}

test('F-3-10 a find-cause job runs read-only on sonnet in the worktree and ends done with its last text as summary', async () => {
  const t = await boot();
  try {
    const res = await t.api('POST', '/api/cards/c1/find-cause');
    assert.equal(res.status, 200);
    const j = t.app.state.jobs.find((x) => x.id === res.body.id);
    assert.equal(j.stage, 'find-cause');
    await until(() => j.status === 'done');
    assert.match(j.summary, /Cause: a\.txt diverged/);
    const argv = JSON.parse(readFileSync(join(t.wt, 'argv.json'), 'utf8'));
    assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
    assert.ok(argv.includes('Bash(git push *)') && argv.includes('Bash(gh *)'));
  } finally { await t.app.close(); }
});

test('F-3-11 S-06 Find cause from a conflict gate uses that job worktree and refuses a job that is not a conflict gate of the card', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/find-cause', { jobId: 'plain' })).status, 409);
    assert.equal((await t.api('POST', '/api/cards/c2/find-cause', { jobId: 'gate' })).status, 409);
    assert.equal((await t.api('POST', '/api/cards/c1/find-cause', { jobId: 'nope' })).status, 404);
    const res = await t.api('POST', '/api/cards/c1/find-cause', { jobId: 'gate' });
    assert.equal(res.status, 200);
    assert.equal(res.body.worktree, t.wt);
    await until(() => t.app.state.jobs.find((x) => x.id === res.body.id).status === 'done');
    assert.equal(t.app.state.jobs.find((x) => x.id === 'gate').needsYou.kind, 'conflict');
  } finally { await t.app.close(); }
});
