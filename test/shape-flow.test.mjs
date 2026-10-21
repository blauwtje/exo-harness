import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/daemon/app.mjs';

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (let v; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if ((v = await fn())) return v;
  throw new Error('timed out');
};

function fakeClaude(dir, steps) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const out = (o) => console.log(JSON.stringify(o));
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const next = async (type) => { for (;;) { const { value, done } = await rl.next(); if (done) process.exit(0); if (JSON.parse(value).type === type) return JSON.parse(value); } };
const say = (t) => out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
(async () => {
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
  fs.appendFileSync(${JSON.stringify(join(dir, 'spawns.txt'))}, 'x');
  await next('user');
  for (const step of ${JSON.stringify(steps)}) {
    if (step === 'ask') {
      out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', options: [{ label: 'A' }, { label: 'B' }] }] } } });
      const resp = await next('control_response');
      fs.writeFileSync('answer.json', JSON.stringify(resp));
    } else if (step === 'text-question') {
      say('**1/1 Pick**\\n- **(A) One**: first\\n- **(B) Two**: second\\nRecommended: (A)');
      out({ type: 'result', subtype: 'success' });
      fs.writeFileSync('reply.txt', (await next('user')).message.content);
    } else if (step === 'brief') {
      fs.mkdirSync('docs/specs', { recursive: true });
      fs.writeFileSync('docs/specs/greet.md', '# Greet\\n');
      say('Brief written: docs/specs/greet.md');
      out({ type: 'result', subtype: 'success' });
    }
  }
  await next('never');
})();
`);
  chmodSync(bin, 0o755);
  return bin;
}

function plugin() {
  const root = tmp('flow-plugin-');
  mkdirSync(join(root, 'skills', 'spec', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.136.0' }));
  writeFileSync(join(root, 'skills', 'spec', 'scripts', 'plan-check.mjs'), 'process.exit(0);');
  return root;
}

function repo() {
  const dir = tmp('flow-repo-');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

async function boot(steps) {
  const dir = tmp('flow-dir-');
  const app = createApp({ dataDir: join(dir, 'data'), claudePath: fakeClaude(dir, steps), pluginRoot: plugin(), parentEnv: { ...process.env } });
  mkdirSync(join(dir, 'data'), { recursive: true });
  const { port, url } = await app.start();
  const token = new URL(url).searchParams.get('token');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'x-exo-token': token, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const project = (await api('POST', '/api/projects', { path: repo() })).body;
  const card = (await api('POST', '/api/cards', { projectKey: project.key, title: 'Greet', body: 'add greeting' })).body;
  return { app, api, dir, port, token, card };
}

const jobOf = async (api, id) => (await api('GET', '/api/state')).body.jobs.find((j) => j.id === id);

test('F-2-13 F-2-14 S-01 Shape asks, takes the answer by permission route, then moves the card to Shaped', async () => {
  const t = await boot(['ask', 'brief']);
  try {
    const sse = await fetch(`http://127.0.0.1:${t.port}/events?token=${t.token}`);
    const reader = sse.body.getReader();
    const shaped = await t.api('POST', `/api/cards/${t.card.id}/shape`);
    assert.equal(shaped.status, 200);
    const jobId = shaped.body.id;
    const ask = await until(async () => (await t.api('GET', '/api/state')).body.pending[0]);
    assert.equal(ask.requestId, 'r1');
    assert.equal((await jobOf(t.api, jobId)).status, 'waiting');
    const bad = await t.api('POST', `/api/jobs/${jobId}/permission`, { requestId: 'nope', allow: true });
    assert.equal(bad.status, 404);
    await t.api('POST', `/api/jobs/${jobId}/permission`, { requestId: 'r1', allow: true, answers: { 'A or B?': 'A' } });
    await until(async () => (await jobOf(t.api, jobId)).status === 'done');
    const state = (await t.api('GET', '/api/state')).body;
    assert.equal(state.cards[0].lane, 'Shaped');
    assert.match(state.jobs[0].brief, /docs\/specs\/greet\.md$/);
    const answer = JSON.parse(readFileSync(join(state.jobs[0].worktree, 'answer.json'), 'utf8'));
    assert.deepEqual(answer.response.response.updatedInput.answers, { 'A or B?': 'A' });
    const transcript = (await t.api('GET', `/api/jobs/${jobId}/transcript`)).body;
    assert.ok(transcript.some((e) => e.type === 'result'));
    let seen = '';
    while (!seen.includes('event: event')) seen += new TextDecoder().decode((await reader.read()).value);
    assert.match(seen, /event: event/);
    await reader.cancel();
  } finally {
    await t.app.close();
  }
});

test('F-2-13 a plain-text question turn waits for a reply, which reaches the warm session', async () => {
  const t = await boot(['text-question', 'brief']);
  try {
    const { body: job } = await t.api('POST', `/api/cards/${t.card.id}/shape`);
    await until(async () => (await jobOf(t.api, job.id)).status === 'waiting');
    assert.equal((await jobOf(t.api, job.id)).question[0].options.length, 2);
    assert.equal((await t.api('POST', `/api/jobs/${job.id}/reply`, {})).status, 400);
    await t.api('POST', `/api/jobs/${job.id}/reply`, { text: 'A' });
    await until(async () => (await jobOf(t.api, job.id)).status === 'done');
    assert.equal(readFileSync(join(job.worktree, 'reply.txt'), 'utf8'), 'A');
  } finally {
    await t.app.close();
  }
});

test('F-2-16 S-12 Stop and Stop all end the live children and mark the jobs stopped', async () => {
  const t = await boot(['ask']);
  try {
    const { body: job } = await t.api('POST', `/api/cards/${t.card.id}/shape`);
    await until(async () => (await t.api('GET', '/api/state')).body.pending.length);
    const pid = (await jobOf(t.api, job.id)).pgid;
    const stopped = await t.api('POST', `/api/jobs/${job.id}/stop`);
    assert.equal(stopped.body.status, 'stopped');
    await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    assert.equal((await t.api('GET', '/api/state')).body.cards[0].lane, 'Inbox');
    const again = await t.api('POST', `/api/cards/${t.card.id}/shape`);
    assert.equal(again.status, 200);
    await until(async () => (await t.api('GET', '/api/state')).body.pending.length);
    await t.api('POST', '/api/stop-all');
    assert.ok((await t.api('GET', '/api/state')).body.jobs.every((j) => j.status === 'stopped'));
    assert.ok(existsSync(join(t.dir, 'spawns.txt')));
  } finally {
    await t.app.close();
  }
});
