import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/daemon/app.mjs';
import { gateLines } from '../src/daemon/run-gate.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 80; i++) { if (await fn()) return; await sleep(100); } assert.fail('timed out'); };
const nowSec = () => Math.floor(Date.now() / 1000);
const gitIn = (dir) => (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]).toString();

const loginClaude = (base, body = '') => {
  const claude = join(base, 'claude');
  writeFileSync(claude, `#!/usr/bin/env node
if (process.argv[2] === 'auth') { console.log(${JSON.stringify(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))}); process.exit(0); }
${body}`);
  chmodSync(claude, 0o755);
  return claude;
};

// why: a claude that emits one rate_limit_event carrying overage and idles, so a running -p job reports overage.
const overageBody = `const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
rl.on('line', () => out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', overageStatus: 'allowed', isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: ${nowSec() + 3600} } } } }));`;

async function boot({ scenario = { id: 'g1', phase: 'build' }, claudeBody = '' } = {}) {
  const base = tmp('gb-dir-');
  const main = tmp('gb-main-');
  const g = gitIn(main);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  writeFileSync(join(main, '.gitignore'), '.claude/exo.local.json\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  mkdirSync(join(main, '.claude'));
  writeFileSync(join(main, '.claude', 'exo.local.json'), JSON.stringify({ budget: 'balanced' }));
  const worktree = join(tmp('gb-wtp-'), 'wt');
  g('worktree', 'add', '-q', '-b', 'feat-x', worktree);
  writeFileSync(join(worktree, 'a.txt'), 'two\n');
  gitIn(worktree)('commit', '-q', '-am', 'feat');
  const brief = join(worktree, 'plan.md');
  writeFileSync(brief, '# Plan\n\n## Plan basis\nBranch: feat-x2\nLand: none\n');
  const scenarioFile = join(base, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const data = join(base, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'state.json'), JSON.stringify({
    projects: [{ key: 'local/p', path: main, origin: null }],
    cards: [{ id: 'c1', projectKey: 'local/p', title: 'T', lane: 'Shaped' }, { id: 'k1', projectKey: 'local/p', title: 'Shape', body: 'x', lane: 'Inbox' }],
    jobs: [{ id: 'shape1', cardId: 'c1', stage: 'spec', status: 'done', worktree, brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } }],
  }));
  process.env.FAKE_EXO_SCENARIO = scenarioFile;
  const log = join(base, 'settings.log');
  writeFileSync(log, '');
  process.env.FAKE_SETTINGS_LOG = log;
  const app = createApp({ dataDir: data, claudePath: loginClaude(base, claudeBody), pluginRoot: fakeRoot, parentEnv: { ...process.env, FAKE_EXO_SCENARIO: scenarioFile, FAKE_SETTINGS_LOG: log }, drainMs: 3600000 });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const writes = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { app, api, state: app.state, writes, data, base, runJob: () => app.state.jobs.find((j) => j.stage === 'run') };
}

const items = (t) => t.state.needs.filter((n) => n.kind === 'budget');

test('F-4-12 a ceiling raised above the default waits for Approve; Reject leaves it; lowering applies at once', async () => {
  const t = await boot();
  try {
    await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 0.5 } });
    assert.equal((await t.api('GET', '/api/settings')).body.ceilings.fiveHour, 0.5);
    assert.equal((await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 0.95 }, maxConcurrent: 3 })).status, 200);
    const s = (await t.api('GET', '/api/settings')).body;
    assert.equal(s.ceilings.fiveHour, 0.5);
    assert.equal(s.maxConcurrent, 3);
    assert.equal(items(t).length, 1);
    assert.deepEqual(items(t)[0].options, ['approve', 'reject']);
    assert.equal((await t.api('POST', `/api/needs/${items(t)[0].id}/reject`)).status, 200);
    assert.equal(items(t).length, 0);
    assert.equal((await t.api('GET', '/api/settings')).body.ceilings.fiveHour, 0.5);
    await t.api('PUT', '/api/settings', { ceilings: { sevenDay: 0.9 } });
    assert.equal((await t.api('POST', `/api/needs/${items(t)[0].id}/approve`)).status, 200);
    assert.equal((await t.api('GET', '/api/settings')).body.ceilings.sevenDay, 0.9);
    assert.equal(items(t).length, 0);
    assert.equal((await t.api('PUT', '/api/settings', { ceilings: { fiveHour: 1.5 } })).status, 400);
    assert.equal(items(t).length, 0);
  } finally { await t.app.close(); }
});

test('F-4-12 a dial raise creates a budget item and writes nothing until Approve; lowering writes at once', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('POST', '/api/budget', { projectKey: 'local/p', value: 'turbo' })).status, 400);
    assert.equal((await t.api('POST', '/api/budget', { projectKey: 'nope', value: 'fast' })).status, 404);
    const up = await t.api('POST', '/api/budget', { projectKey: 'local/p', value: 'quality' });
    assert.equal(up.body.gated.kind, 'budget');
    assert.deepEqual(t.writes(), []);
    assert.equal((await t.api('POST', `/api/needs/${up.body.gated.id}/approve`)).status, 200);
    assert.deepEqual(t.writes(), [{ key: 'budget', value: 'quality', scope: 'local' }]);
    assert.equal(items(t).length, 0);
    assert.deepEqual((await t.api('POST', '/api/budget', { projectKey: 'local/p', value: 'fast' })).body, { applied: true });
    assert.equal(t.writes().length, 2);
    const again = await t.api('POST', '/api/budget', { projectKey: 'local/p', value: 'quality' });
    await t.api('POST', `/api/needs/${again.body.gated.id}/reject`);
    assert.equal(t.writes().length, 2);
  } finally { await t.app.close(); }
});

test('S-15 an overage item appears, only the toggle lifts it and the item is never saved', async () => {
  const t = await boot({ claudeBody: overageBody });
  try {
    assert.equal((await t.api('POST', '/api/cards/k1/shape')).status, 200);
    const j = t.state.jobs.find((x) => x.cardId === 'k1');
    await until(() => existsSync(join(t.data, 'jobs', j.id, 'events.jsonl')) && readFileSync(join(t.data, 'jobs', j.id, 'events.jsonl'), 'utf8').includes('isUsingOverage'));
    await until(() => t.state.needs.some((n) => n.kind === 'overage'));
    assert.deepEqual(t.state.needs.find((n) => n.kind === 'overage').options, ['allow']);
    assert.equal((await t.api('PUT', '/api/settings', { overageAllowed: true })).status, 400);
    assert.equal((await t.api('POST', '/api/overage/allow')).status, 200);
    assert.equal(t.state.needs.some((n) => n.kind === 'overage'), false);
    assert.equal((await t.api('GET', '/api/settings')).body.overageAllowed, true);
    assert.equal(JSON.parse(readFileSync(join(t.data, 'state.json'), 'utf8')).needs.some((n) => n.kind === 'overage'), false);
  } finally { await t.app.close(); }
});

const parked = (gates) => ({ id: 'g1', phase: 'parked', branch: 'feat-x', gates, approve: { phase: 'landed' } });
const limitGate = { source: 'run', action: 'wait for the usage limit to reset', reason: 'usage_limit' };
const otherGate = { source: 'land', action: 'git push', reason: 'needs approval' };

async function parkedCard(gates, kind) {
  const t = await boot({ scenario: parked(gates) });
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    await until(() => j.needsYou?.kind === kind);
    assert.equal(j.needsYou.gates.length, gates.length);
    assert.match(j.needsYou.gates.join('\n'), /usage limit/);
    if (gates.length === 2) assert.match(j.needsYou.gates.join('\n'), /git push/);
    await sleep(600);
    assert.equal(j.run.phase, 'parked');
    assert.equal(j.status, 'waiting');
    assert.deepEqual(j.needsYou.options, ['approve', 'reject']);
  } finally { await t.app.close(); }
}

test('S-16 a limit-only gate is a limit card', () => parkedCard([limitGate], 'limit'));
test('S-16 a mixed gate lists every line and is never approved by itself', () => parkedCard([limitGate, otherGate], 'gate'));

test('S-16 gateLines returns every open line and drops closed ones', () => {
  assert.deepEqual(gateLines('- open: a (x)\n- closed: b (y)\n\n- open: c (z)\n'), ['- open: a (x)', '- open: c (z)']);
});
