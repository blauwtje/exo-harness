import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/daemon/app.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const fakeClaudeBin = new URL('./fake-claude/bin/claude', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (let v; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if ((v = await fn())) return v;
  throw new Error('timed out');
};
const nowSec = () => Math.floor(Date.now() / 1000);

function repo() {
  const dir = tmp('qa-repo-');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

// why: a claude that logs in, then emits one rate_limit_event carrying overage and idles, so a running -p job reports overage.
function overageClaude(dir) {
  const bin = join(dir, 'claude-overage');
  writeFileSync(bin, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
rl.on('line', () => out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', overageStatus: 'allowed', isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: ${nowSec() + 3600} } } } }));
`);
  chmodSync(bin, 0o755);
  return bin;
}

async function boot({ claude = fakeClaudeBin, env = {}, cache = null, limitOptions, setup } = {}) {
  const base = tmp('qa-dir-');
  const data = join(base, 'data');
  mkdirSync(data);
  const cachePath = join(base, 'statusline.json');
  if (cache !== null) writeFileSync(cachePath, JSON.stringify({ five_hour: { used_percentage: cache, resets_at: nowSec() + 7200 } }));
  const scenarioFile = join(base, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify({ id: 'run-1', phase: 'build' }));
  const parentEnv = { ...process.env, FAKE_EXO_SCENARIO: scenarioFile, ...env };
  process.env.FAKE_EXO_SCENARIO = scenarioFile;
  const seed = { projects: [], cards: [], jobs: [] };
  const project = repo();
  seed.projects.push({ key: 'local/p', path: project, origin: null });
  for (const n of [1, 2]) {
    const worktree = tmp('qa-wt-');
    const brief = join(worktree, 'plan.md');
    writeFileSync(brief, `# Plan\n\n## Plan basis\nBranch: feat-${n}\nLand: none\n`);
    seed.cards.push({ id: `c${n}`, projectKey: 'local/p', title: `T${n}`, lane: 'Shaped' });
    seed.jobs.push({ id: `shape${n}`, cardId: `c${n}`, stage: 'spec', status: 'done', worktree, brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } });
  }
  writeFileSync(join(data, 'state.json'), JSON.stringify(seed));
  await setup?.(data);
  const app = createApp({
    dataDir: data, claudePath: claude, pluginRoot: fakeRoot, parentEnv, statuslinePath: cachePath, drainMs: 3600000, limitOptions,
  });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const runs = () => app.state.jobs.filter((j) => j.stage === 'run');
  return { app, api, state: app.state, runs, parentEnv, base };
}

test('C-05 the queue never starts a run past the ceiling, and restoring it starts at most maxConcurrent', async () => {
  const t = await boot({ cache: 60 });
  try {
    assert.equal((await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 0.5 }, maxConcurrent: 1 })).status, 200);
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    assert.equal((await t.api('POST', '/api/cards/c2/approve')).status, 200);
    for (const j of t.runs()) {
      assert.equal(j.status, 'queued');
      assert.equal(j.queued.reason, 'ceiling');
      assert.equal(j.queued.rateLimitType, 'five_hour');
      assert.ok(j.queued.resetsAt > nowSec());
      assert.equal(j.run, undefined);
    }
    const queue = (await t.api('GET', '/api/queue')).body;
    assert.equal(queue.order.length, 2);
    assert.equal((await t.api('POST', '/api/queue/reorder', { ids: [queue.order[0], 'nope'] })).status, 400);
    assert.equal((await t.api('POST', '/api/queue/reorder', { ids: [...queue.order].reverse() })).status, 200);
    assert.equal((await t.api('POST', '/api/queue/priority', { ids: 'local/p' })).status, 400);
    assert.equal((await t.api('POST', '/api/queue/priority', { ids: ['local/p'] })).status, 200);
    assert.deepEqual((await t.api('GET', '/api/state')).body.queue.projectPriority, ['local/p']);

    assert.equal((await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 0.9 } })).status, 200);
    const started = t.runs().filter((j) => j.status !== 'queued');
    assert.equal(started.length, 1);
    assert.equal(started[0].id, [...queue.order].reverse()[0]);
    const waiting = t.runs().find((j) => j.status === 'queued');
    assert.equal(waiting.queued.reason, 'concurrency');
  } finally { await t.app.close(); }
});

test('C-05 settings out of range answer 400 and change nothing', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 1.5 } })).status, 400);
    assert.equal((await t.api('PUT', '/api/settings', { maxConcurrent: 0 })).status, 400);
    const got = (await t.api('GET', '/api/settings')).body;
    assert.deepEqual(got.ceilings, { fiveHour: 0.8, sevenDay: 0.7 });
    assert.equal(got.maxConcurrent, 2);
  } finally { await t.app.close(); }
});

test('S-03 a limit hit in a -p job pauses the queue with its reset time and resumes after it', async () => {
  const resetsAt = nowSec() + 2;
  const env = { FAKE_CLAUDE_LIMIT: JSON.stringify({ type: 'rejected', resetsAt, afterTurns: 0, rateLimitType: 'five_hour' }) };
  const t = await boot({ env, limitOptions: { jitterMs: () => 0 } });
  try {
    t.state.cards.push({ id: 'k1', projectKey: 'local/p', title: 'Shape me', body: 'x', lane: 'Inbox' });
    t.state.cards.push({ id: 'k2', projectKey: 'local/p', title: 'Shape me too', body: 'x', lane: 'Inbox' });
    assert.equal((await t.api('POST', '/api/cards/k1/shape')).status, 200);
    const j1 = t.state.jobs.find((j) => j.cardId === 'k1');
    await until(() => j1.limitHit);
    assert.equal(j1.status, 'queued');
    const state = (await t.api('GET', '/api/state')).body;
    assert.deepEqual(state.queue.paused, { reason: 'limit', rateLimitType: 'five_hour', resetsAt });

    assert.equal((await t.api('POST', '/api/cards/k2/shape')).status, 200);
    const j2 = t.state.jobs.find((j) => j.cardId === 'k2');
    assert.equal(j2.status, 'queued');
    assert.equal(j2.queued.reason, 'paused');
    assert.equal(j2.queued.resetsAt, resetsAt);

    delete t.parentEnv.FAKE_CLAUDE_LIMIT;
    await until(() => t.state.queue.paused === null, 10000);
    assert.equal(j1.limitHit, undefined);
    assert.notEqual(j1.status, 'queued');
    assert.notEqual(j2.status, 'queued');
  } finally { await t.app.close(); }
});

test('S-03 a restart reads the limit pause back and keeps the job queued', async () => {
  const resetsAt = nowSec() + 3600;
  const t = await boot({
    setup(data) {
      const file = join(data, 'state.json');
      const s = JSON.parse(execFileSync('cat', [file]));
      s.queue = { order: ['shape1'], projectPriority: [], pauses: [{ reason: 'limit', rateLimitType: 'five_hour', resetsAt }], paused: { reason: 'limit', rateLimitType: 'five_hour', resetsAt } };
      Object.assign(s.jobs[0], { status: 'queued', limitHit: { rateLimitType: 'five_hour', resetsAt } });
      delete s.jobs[0].needsYou;
      writeFileSync(file, JSON.stringify(s));
    },
  });
  try {
    assert.equal(t.state.queue.paused.resetsAt, resetsAt);
    assert.equal(t.state.jobs[0].status, 'queued');
    assert.equal((await t.api('POST', '/api/queue/resume')).body.paused, null);
    assert.notEqual(t.state.jobs[0].status, 'queued');
  } finally { await t.app.close(); }
});

test('S-15 overage admits nothing, running jobs drain, and settings cannot lift it', async () => {
  const dir = tmp('qa-claude-');
  const t = await boot({ claude: overageClaude(dir) });
  try {
    t.state.cards.push({ id: 'k1', projectKey: 'local/p', title: 'First', body: 'x', lane: 'Inbox' });
    t.state.cards.push({ id: 'k2', projectKey: 'local/p', title: 'Second', body: 'x', lane: 'Inbox' });
    assert.equal((await t.api('POST', '/api/cards/k1/shape')).status, 200);
    const j1 = t.state.jobs.find((j) => j.cardId === 'k1');
    const events = join(t.base, 'data', 'jobs', j1.id, 'events.jsonl');
    await until(() => existsSync(events) && readFileSync(events, 'utf8').includes('isUsingOverage'));
    const second = await t.api('POST', '/api/cards/k2/shape');
    assert.equal(second.body.status, 'queued');
    assert.equal(second.body.queued.reason, 'overage');
    assert.notEqual(j1.status, 'stopped');
    assert.equal((await t.api('PUT', '/api/settings', { overageAllowed: true })).status, 400);
    assert.equal((await t.api('GET', '/api/settings')).body.overageAllowed, false);
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).body.queued.reason, 'overage');
    await t.api('POST', '/api/queue/resume');
    assert.equal(t.state.jobs.find((j) => j.id === second.body.id).status, 'queued');
  } finally { await t.app.close(); }
});
