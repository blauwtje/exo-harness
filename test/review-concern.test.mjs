import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rolldown } from 'rolldown';
import * as admission from '../src/daemon/admission.mjs';
import { createApp } from '../src/daemon/app.mjs';
import { createLimitTimer } from '../src/daemon/limit.mjs';
import { createQueue } from '../src/daemon/queue.mjs';
import { createSupervisor } from '../src/daemon/supervisor.mjs';
import { needsYou } from '../src/ui/derive.js';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const lim = (rateLimitType, resetsAt) => ({ reason: 'limit', rateLimitType, resetsAt });

async function boot(seed) {
  const data = join(tmp('rc-'), 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'state.json'), JSON.stringify({ projects: [], cards: [], jobs: [], ...seed }));
  const app = createApp({
    dataDir: data, pluginRoot: fakeRoot, drainMs: 3600000,
    offlineOptions: { fetch: async () => { throw new Error('offline'); }, intervalMs: 3600000 },
  });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { app, api };
}

test('Decision 9 a window-scoped limit pause still lets next() hand out a job admit allows', () => {
  const q = createQueue({ jobs: [], cards: [] });
  q.enqueue('a');
  q.pause(lim('seven_day_opus', 9e9));
  assert.equal(q.next(() => true), 'a');
});

test('Decision 9 a second limit on another window keeps the first window paused', () => {
  const q = createQueue({ jobs: [], cards: [] });
  q.pause(lim('seven_day_opus', 100));
  q.pause(lim('five_hour', 50));
  assert.equal(q.snapshot().pauses.length, 2);
});

test('Decision 9 the limit timer of the earlier-resetting window does not lift the other window', () => {
  const q = createQueue({ jobs: [], cards: [] });
  const timers = [];
  const timer = createLimitTimer({ queue: q, now: () => 0, setTimer: (fn, ms) => timers.push({ fn, ms }), jitterMs: () => 0 });
  timer.hit({ rateLimitType: 'seven_day_opus', resetsAt: 100 });
  timer.hit({ rateLimitType: 'five_hour', resetsAt: 50 });
  timers.sort((a, b) => a.ms - b.ms)[0].fn();
  assert.deepEqual(q.snapshot().pauses.map((p) => p.rateLimitType), ['seven_day_opus']);
});

test('Decision 7 the overage allow route refuses while no overage is active', async () => {
  const t = await boot({});
  try {
    assert.equal((await t.api('POST', '/api/overage/allow')).status, 409);
    assert.equal((await t.api('GET', '/api/settings')).body.overageAllowed, false);
  } finally { await t.app.close(); }
});

test('Decision 16 reorder answers 200 for the queued ids while a stopped job keeps a stale id', async () => {
  const t = await boot({
    cards: [{ id: 'c', projectKey: 'p', title: 't', lane: 'Inbox' }],
    jobs: [{ id: 'a', cardId: 'c', stage: 'spec', status: 'stopped' }, { id: 'b', cardId: 'c', stage: 'spec', status: 'queued' }, { id: 'd', cardId: 'c', stage: 'spec', status: 'queued' }],
    queue: { order: ['a', 'b', 'd'], pauses: [{ reason: 'stopped' }] },
  });
  try {
    const r = await t.api('POST', '/api/queue/reorder', { ids: ['d', 'b'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.order.filter((id) => id !== 'a'), ['d', 'b']);
  } finally { await t.app.close(); }
});

test('Task 4 admission exports the one overage rule the app reuses', () => {
  assert.equal(typeof admission.overageActive, 'function');
  assert.equal(admission.overageActive({ isUsingOverage: true }), true);
});

test('Task 15 a seven_day_opus pause shows a gauge with its resume time', async () => {
  const out = join(tmp('rc-ui-'), 'gauges.cjs');
  const req = createRequire(import.meta.url);
  const entry = join(tmp('rc-ui-'), 'entry.jsx');
  writeFileSync(entry, `import { renderToString } from ${JSON.stringify(req.resolve('react-dom/server'))}; import { createElement } from ${JSON.stringify(req.resolve('react'))}; import Gauges from ${JSON.stringify(new URL('../src/ui/Gauges.jsx', import.meta.url).pathname)}; export const render = (p) => renderToString(createElement(Gauges, p));`);
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'cjs' });
  const html = createRequire(import.meta.url)(out).render({ rate: { windows: {} }, offline: false, state: { queue: { pauses: [lim('seven_day_opus', Math.floor(Date.now() / 1000) + 3600)] }, jobs: [], needs: [] }, api: null });
  assert.match(html, /data-gauge="seven_day_opus"/);
  assert.match(html, /resumes in/);
});

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (let v; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if ((v = await fn())) return v;
  throw new Error('timed out');
};

// why: a claude that logs in, rewrites the statusline cache a step higher and emits one result per user line, so the window rises per turn.
async function bootUtil() {
  const base = tmp('rc-util-');
  const data = join(base, 'data');
  mkdirSync(data);
  const cache = join(base, 'statusline.json');
  const log = join(base, 'results.log');
  const write = (pct) => writeFileSync(cache, JSON.stringify({ five_hour: { used_percentage: pct, resets_at: Math.floor(Date.now() / 1000) + 7200 } }));
  write(10);
  const bin = join(base, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
let n = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', () => {
  n += 1;
  fs.writeFileSync(${JSON.stringify(cache)}, JSON.stringify({ five_hour: { used_percentage: 10 + 10 * n, resets_at: Math.floor(Date.now() / 1000) + 7200 } }));
  out({ type: 'result', subtype: 'success', num_turns: 1 });
  fs.appendFileSync(${JSON.stringify(log)}, 'x\\n');
});
`);
  chmodSync(bin, 0o755);
  const project = tmp('rc-repo-');
  const g = (...a) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  writeFileSync(join(data, 'state.json'), JSON.stringify({ projects: [{ key: 'local/p', path: project, origin: null }], cards: [{ id: 'k1', projectKey: 'local/p', title: 'Shape me', body: 'x', lane: 'Inbox' }], jobs: [] }));
  const app = createApp({ dataDir: data, claudePath: bin, pluginRoot: fakeRoot, statuslinePath: cache, drainMs: 3600000, offlineOptions: { fetch: async () => {}, intervalMs: 3600000 } });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const results = () => { try { return readFileSync(log, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  return { app, api, results };
}

test('Decision 6 a directly shaped job adds a utilization sample from its own start', async () => {
  const t = await bootUtil();
  try {
    assert.equal((await t.api('POST', '/api/cards/k1/shape')).status, 200);
    const j = t.app.state.jobs[0];
    await until(() => t.results() >= 1);
    await t.api('POST', `/api/jobs/${j.id}/stop`);
    await until(() => t.app.state.utilizationHistory?.spec?.length === 1);
    assert.ok(Math.abs(t.app.state.utilizationHistory.spec[0] - 0.1) < 1e-9);
  } finally { await t.app.close(); }
});

test('Decision 6 a multi-turn job adds one utilization sample, not one per turn', async () => {
  const t = await bootUtil();
  try {
    assert.equal((await t.api('POST', '/api/cards/k1/shape')).status, 200);
    const j = t.app.state.jobs[0];
    await until(() => t.results() >= 1 && j.status === 'waiting');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/reply`, { text: 'a' })).status, 200);
    await until(() => t.results() >= 2 && j.status === 'waiting');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/reply`, { text: 'b' })).status, 200);
    await until(() => t.results() >= 3);
    await t.api('POST', `/api/jobs/${j.id}/stop`);
    await until(() => t.app.state.utilizationHistory?.spec?.length >= 1);
    assert.equal(t.app.state.utilizationHistory.spec.length, 1);
    assert.ok(Math.abs(t.app.state.utilizationHistory.spec[0] - 0.3) < 1e-9);
  } finally { await t.app.close(); }
});

test('Decision 9 queue.next reuses the admission hold rule for every pause shape', () => {
  assert.equal(typeof admission.holds, 'function');
  for (const p of [lim('seven_day_opus', 1), lim(undefined, 1), { reason: 'offline' }, { reason: 'stopped' }]) {
    const q = createQueue({ jobs: [], cards: [] });
    q.enqueue('a');
    q.pause(p);
    assert.equal(q.next(() => true) === null, Boolean(admission.holds(p, [])));
  }
});

test('S-16 a limit-only gate, a budget raise and the overage item reach the deck as Needs-you items', () => {
  const state = {
    cards: [{ id: 'c', title: 'T' }],
    jobs: [{ id: 'j', cardId: 'c', stage: 'run', status: 'waiting', needsYou: { kind: 'limit', gates: ['- limit'], options: ['approve', 'reject'] } }, { id: 'k', cardId: 'c', stage: 'spec', status: 'done' }],
    needs: [{ id: 'need-1', kind: 'budget', title: 'Raise budget ceilings', change: { ceilings: { fiveHour: 0.9 } }, options: ['approve', 'reject'] }, { id: 'overage', kind: 'overage', resetsAt: 5, options: ['allow'] }],
  };
  const kinds = needsYou(state, {}).map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['budget', 'limit', 'overage']);
});

async function renderNeeds(items) {
  const out = join(tmp('rc-ny-'), 'needs.cjs');
  const req = createRequire(import.meta.url);
  const entry = join(tmp('rc-ny-'), 'entry.jsx');
  writeFileSync(entry, `import { renderToString } from ${JSON.stringify(req.resolve('react-dom/server'))}; import { createElement } from ${JSON.stringify(req.resolve('react'))}; import NeedsYou from ${JSON.stringify(new URL('../src/ui/NeedsYou.jsx', import.meta.url).pathname)}; export const render = (p) => renderToString(createElement(NeedsYou, p));`);
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'cjs' });
  return createRequire(import.meta.url)(out).render({ items, deck: { act() {} }, openJob() {} });
}

test('S-16 the deck card of a limit gate, a budget raise and overage carries its actions', async () => {
  const job = { id: 'jobjob', run: { branch: 'b' }, needsYou: { kind: 'limit', gates: ['- limit'], options: ['approve', 'reject'] } };
  const html = await renderNeeds([
    { kind: 'limit', key: 'limit:j', job, card: { id: 'c', title: 'Limit card' } },
    { kind: 'budget', key: 'need:n1', need: { id: 'n1', kind: 'budget', title: 'Raise budget ceilings', change: { ceilings: { fiveHour: 0.9 } } } },
    { kind: 'overage', key: 'need:overage', need: { id: 'overage', kind: 'overage', resetsAt: 5, options: ['allow'] } },
  ]);
  assert.match(html, /Limit card/);
  assert.match(html, /Raise budget ceilings/);
  assert.equal((html.match(/>Approve</g) ?? []).length, 2);
  assert.equal((html.match(/>Reject</g) ?? []).length, 2);
  assert.match(html, />Allow</);
});

function retrySetup(attempts, waits = [1, 1]) {
  const job = { id: 'j1', cardId: 'c1', stage: 'spec', retryWaitsMs: waits };
  const calls = [];
  const sessionStarter = async ({ store }) => {
    const events = attempts[calls.length];
    calls.push(1);
    for (const e of events) store.appendEvent('j1', e);
    return { pid: 1, done: Promise.resolve({ reason: null }), send() {}, answer() {}, end() {}, stop() {} };
  };
  const store = { save() {}, appendEvent() {} };
  const sup = createSupervisor({ store, state: { jobs: [job] }, spawnCaffeinate: () => null, sessionStarter });
  return { job, calls, sup };
}

test('F-4-10 the supervisor retries a stream that ended with no result, then settles', async () => {
  const s = retrySetup([[{ type: 'system', subtype: 'init' }], [{ type: 'system', subtype: 'init' }, { type: 'result', is_error: false }]]);
  const sess = await s.sup.start({ job: s.job, card: {}, worktree: '/tmp', mode: 'start' });
  await sess.done;
  assert.equal(s.calls.length, 2);
  assert.equal(s.job.failures.length, 1);
  assert.equal(s.job.bugCard, undefined);
});

test('S-09 the supervisor stops at a repeated failing line and leaves a bug card with it', async () => {
  const noResult = [{ type: 'system', subtype: 'init' }];
  const s = retrySetup([noResult, noResult, noResult]);
  const sess = await s.sup.start({ job: s.job, card: {}, worktree: '/tmp', mode: 'start' });
  await sess.done;
  assert.equal(s.calls.length, 2);
  assert.equal(s.job.bugCard.line, 'stream ended with no result event');
});

test('F-4-10 the supervisor never retries a model error', async () => {
  const s = retrySetup([[{ type: 'result', is_error: true }], []]);
  const sess = await s.sup.start({ job: s.job, card: {}, worktree: '/tmp', mode: 'start' });
  await sess.done;
  assert.equal(s.calls.length, 1);
});
