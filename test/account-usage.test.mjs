import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admit } from '../src/daemon/admission.mjs';
import { createApp } from '../src/daemon/app.mjs';
import { watchHardStop } from '../src/daemon/hard-stop.mjs';
import { createLimitTimer } from '../src/daemon/limit.mjs';
import { createQueue } from '../src/daemon/queue.mjs';
import { reconcile } from '../src/daemon/reconcile.mjs';
import { DEFAULTS, saveSettings } from '../src/daemon/settings.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const nowSec = () => Math.floor(Date.now() / 1000);
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (let v; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if ((v = await fn())) return v;
  throw new Error('timed out');
};
const settings = { ...DEFAULTS, ceilings: { fiveHour: 0.8, sevenDay: 0.7 }, maxConcurrent: 4, overageAllowed: false };
const limitPause = (account) => ({ reason: 'limit', rateLimitType: 'five_hour', resetsAt: nowSec() + 3600, ...(account && { account }) });

test('admission holds only the account a limit pause was hit on; a pause without account is the default one', () => {
  const verdict = (pause, account) => admit({ stage: 'spec', usage: {}, settings, history: {}, running: 0, queue: { pauses: [pause] }, account }).reason ?? 'ok';
  assert.equal(verdict(limitPause('work'), 'work'), 'paused');
  assert.equal(verdict(limitPause('work'), 'default'), 'ok');
  assert.equal(verdict(limitPause('work'), undefined), 'ok');
  assert.equal(verdict(limitPause(), 'default'), 'paused');
  assert.equal(verdict(limitPause(), 'work'), 'ok');
  assert.equal(verdict({ reason: 'offline' }, 'work'), 'paused');
});

test('admission reads the usage it is given per account', () => {
  const over = { five_hour: { utilization: 0.9, resetsAt: nowSec() + 3600 } };
  assert.equal(admit({ stage: 'spec', usage: over, settings, history: {}, running: 0, queue: {}, account: 'work' }).reason, 'ceiling');
  assert.equal(admit({ stage: 'spec', usage: {}, settings, history: {}, running: 0, queue: {}, account: 'default' }).ok, true);
});

test('limit pauses keep apart per account: a default hit has no account field, each resumes on its own timer', () => {
  const timers = [];
  const q = createQueue({ jobs: [], cards: [] });
  const limiter = createLimitTimer({ queue: q, now: () => 0, setTimer: (fn, ms) => timers.push({ fn, ms }), jitterMs: () => 0 });
  limiter.hit({ rateLimitType: 'five_hour', resetsAt: 10 });
  limiter.hit({ rateLimitType: 'five_hour', resetsAt: 20, account: 'work' });
  assert.deepEqual(q.snapshot().pauses, [
    { reason: 'limit', rateLimitType: 'five_hour', resetsAt: 10 },
    { reason: 'limit', rateLimitType: 'five_hour', resetsAt: 20, account: 'work' },
  ]);
  timers[1].fn();
  assert.deepEqual(q.snapshot().pauses, [{ reason: 'limit', rateLimitType: 'five_hour', resetsAt: 10 }]);
  timers[0].fn();
  assert.deepEqual(q.snapshot().pauses, []);
});

test('restore re-arms a persisted non-default pause for its own account', () => {
  const timers = [];
  const q = createQueue({ jobs: [], cards: [], queue: { pauses: [limitPause(), { ...limitPause('work'), resetsAt: 5 }] } });
  createLimitTimer({ queue: q, now: () => 0, setTimer: (fn) => timers.push(fn), jitterMs: () => 0 }).restore();
  timers[1]();
  assert.deepEqual(q.snapshot().pauses.map((p) => p.account ?? 'default'), ['default']);
});

test('hard stop with per-job usage signals only the run whose account is over the limit', () => {
  const runOn = (id) => {
    const root = tmp('acc-hs-');
    mkdirSync(join(root, '.exo', 'run', 'r1'), { recursive: true });
    const job = { id, runRoot: root, run: { id: 'r1' } };
    job.land = (landed) => writeFileSync(join(root, '.exo', 'run', 'r1', 'state.json'), JSON.stringify({ id: 'r1', phase: 'building', pid: id === 'w' ? 4243 : 4242, landed }));
    return job;
  };
  const home = runOn('d');
  const work = runOn('w');
  const kills = [];
  const usageOf = (j) => ({ five_hour: { utilization: j.id === 'w' ? 0.95 : 0.1 } });
  const w = watchHardStop({ getUsage: () => ({}), usageOf, settings: { hardStopFiveHour: 0.9 }, runs: () => [home, work], kill: (p, s) => kills.push([p, s]), intervalMs: 1e6 });
  home.land(1); work.land(1);
  w.tick();
  home.land(2); work.land(2);
  w.tick();
  w.stop();
  assert.deepEqual(kills, [[4243, 'SIGTERM']]);
  assert.equal(work.outcome, 'hard-stop');
  assert.equal(home.outcome, undefined);
});

test('reconcile looks for the session in the config dir of the job account', async () => {
  const worktree = tmp('acc-rec-');
  const job = { id: 'j1', cardId: 'c1', stage: 'spec', status: 'running', worktree, sessionId: 's1', account: 'work' };
  const state = { jobs: [job], cards: [{ id: 'c1' }] };
  const seen = [];
  await reconcile({
    store: { save() {} }, state, supervisor: { start: async () => {} },
    sessionExists: (j, dir) => { seen.push(dir); return true; }, configDirOf: (j) => (j.account === 'work' ? '/acc/work' : null),
  });
  assert.deepEqual(seen, ['/acc/work']);
});

function accountClaude(dir) {
  const bin = join(dir, 'claude-accounts');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const configDir = process.env.CLAUDE_CONFIG_DIR || '';
fs.writeFileSync(${JSON.stringify(dir)} + '/env-' + process.pid, configDir);
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'm', claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }] });
const utilization = configDir ? 0.9 : 0.2;
require('node:readline').createInterface({ input: process.stdin }).on('line', () => out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization, resetsAt: ${nowSec() + 3600} } } } }));
`);
  chmodSync(bin, 0o755);
  return bin;
}

async function bootWithWorkAccount() {
  const base = tmp('acc-app-');
  const data = join(base, 'data');
  const workDir = join(base, 'work');
  mkdirSync(data);
  mkdirSync(workDir);
  const project = tmp('acc-repo-');
  const g = (...a) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  const cards = [1, 2, 3].map((n) => ({ id: `c${n}`, projectKey: 'local/p', title: `Card ${n}`, lane: 'Inbox' }));
  writeFileSync(join(data, 'state.json'), JSON.stringify({ projects: [{ key: 'local/p', path: project, origin: null }], cards, jobs: [] }));
  assert.equal(saveSettings(data, { accounts: [{ id: 'work', name: 'Work', configDir: workDir }], accountByStage: { spec: 'work' }, maxConcurrent: 4 }).error, undefined);
  const parentEnv = { ...process.env };
  delete parentEnv.CLAUDE_CONFIG_DIR;
  const app = createApp({ dataDir: data, claudePath: accountClaude(base), pluginRoot: fakeRoot, parentEnv, drainMs: 3600000 });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const envs = () => readdirSync(base).filter((f) => f.startsWith('env-')).map((f) => readFileSync(join(base, f), 'utf8'));
  return { app, api, base, workDir, envs };
}

test('a session of a stage picked for an account runs with its CLAUDE_CONFIG_DIR and its usage counts only there', async () => {
  const t = await bootWithWorkAccount();
  try {
    const first = await t.api('POST', '/api/cards/c1/shape');
    assert.equal(first.status, 200);
    assert.equal(first.body.account, 'work');
    await until(() => t.envs().includes(t.workDir));
    const accountsOf = async () => (await t.api('GET', '/api/state')).body;
    const worked = await until(async () => { const s = await accountsOf(); return s.accounts.find((a) => a.id === 'work').limits.length && s; });
    assert.equal(worked.accounts.find((a) => a.id === 'work').limits.find((l) => l.id === 'session').percent, 90);
    assert.deepEqual(worked.accounts.find((a) => a.id === 'default').limits, []);
    assert.equal(worked.usage.five_hour, undefined);

    const held = await t.api('POST', '/api/cards/c2/shape');
    assert.equal(held.body.status, 'queued');
    assert.equal(held.body.queued.reason, 'ceiling');

    assert.equal((await t.api('PUT', '/api/settings', { accountByStage: { spec: 'default' } })).status, 200);
    const home = await t.api('POST', '/api/cards/c3/shape');
    assert.equal(home.body.account, 'default');
    assert.notEqual(home.body.status, 'queued');
    await until(() => t.envs().includes(''));
    const after = await until(async () => { const s = await accountsOf(); return s.usage.five_hour && s; });
    assert.equal(after.usage.five_hour.utilization, 0.2);
    assert.equal(after.accounts.find((a) => a.id === 'work').limits.find((l) => l.id === 'session').percent, 90);
    assert.equal(existsSync(join(t.workDir, '.claude.json')), false);
  } finally { await t.app.close(); }
});
