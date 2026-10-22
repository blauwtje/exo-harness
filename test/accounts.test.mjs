import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ACCOUNT, accountEnv, accountView, createAccountAuth, defaultClaudeJsonPath, limitsOf, loginCommand, pickClaudeJson,
  planOf, readClaudeJson, renewal, slugId, windowsFromClaudeJson,
} from '../src/daemon/accounts.mjs';
import { createApp } from '../src/daemon/app.mjs';
import { loadSettings } from '../src/daemon/settings.mjs';

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const NOW = Date.parse('2026-10-22T12:00:00Z');
const S = (iso) => Math.floor(Date.parse(iso) / 1000);

const claudeJson = (over = {}) => ({
  numStartups: 4,
  projects: { '/x': { allowedTools: [] } },
  oauthAccount: {
    emailAddress: 'me@example.com', organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x',
    billingType: 'stripe_subscription', subscriptionCreatedAt: '2026-01-31T07:03:43.059Z', accountUuid: 'u-1',
  },
  cachedUsageUtilization: {
    fetchedAtMs: NOW - 60_000,
    utilization: { five_hour: { utilization: 9, resets_at: '2026-10-22T15:00:00+00:00' } },
    limits: [
      { kind: 'session', group: 'session', percent: 9, resets_at: '2026-10-22T15:00:00.250743+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 5, resets_at: '2026-10-25T01:00:00+00:00', scope: null },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-10-25T01:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' } } },
    ],
  },
  ...over,
});

test('plan label maps any tier generically and falls back to the auth subscription type', () => {
  assert.deepEqual(planOf({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' }),
    { label: 'Max (5x)', type: 'claude_max', tier: 'default_claude_max_5x' });
  assert.equal(planOf({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }).label, 'Max (20x)');
  assert.equal(planOf({ organizationRateLimitTier: 'default_claude_max_20x' }).label, 'Max (20x)');
  assert.equal(planOf({ organizationType: 'claude_pro' }).label, 'Pro');
  assert.equal(planOf({ organizationRateLimitTier: 'claude_pro' }).label, 'Pro');
  assert.equal(planOf({ organizationType: 'claude_team', organizationRateLimitTier: 'default_claude_team' }).label, 'Team');
  assert.deepEqual(planOf(null, { subscriptionType: 'max' }), { label: 'Max', type: 'max', tier: null });
  assert.equal(planOf(null, null), null);
  assert.equal(planOf({}, { subscriptionType: null }), null);
});

test('renewal is the next monthly anniversary after now, day clamped, and estimated', () => {
  assert.deepEqual(renewal('2026-10-09T07:03:43.059Z', NOW), { renewsAt: '2026-11-09T07:03:43.059Z', renewsEstimated: true });
  assert.equal(renewal('2026-01-31T07:03:43.059Z', NOW).renewsAt, '2026-10-31T07:03:43.059Z');
  assert.equal(renewal('2026-01-31T00:00:00.000Z', Date.parse('2026-02-10T00:00:00Z')).renewsAt, '2026-02-28T00:00:00.000Z');
  assert.equal(renewal('2024-01-31T00:00:00.000Z', Date.parse('2024-02-10T00:00:00Z')).renewsAt, '2024-02-29T00:00:00.000Z');
  assert.equal(renewal('2025-03-22T12:00:00.000Z', NOW).renewsAt, '2026-11-22T12:00:00.000Z', 'same instant rolls to the next month');
  assert.equal(renewal('2025-03-22T13:00:00.000Z', NOW).renewsAt, '2026-10-22T13:00:00.000Z');
  assert.equal(renewal('2026-10-22T11:00:00.000Z', NOW).renewsAt, '2026-11-22T11:00:00.000Z', 'a start today renews next month');
  assert.deepEqual(renewal(null, NOW), { renewsAt: null, renewsEstimated: false });
  assert.deepEqual(renewal('not a date', NOW), { renewsAt: null, renewsEstimated: false });
});

test('.claude.json keeps only plan fields and limits, labelled per the contract', () => {
  const picked = pickClaudeJson(claudeJson());
  assert.deepEqual(Object.keys(picked).sort(), ['limits', 'oauth']);
  assert.equal('accountUuid' in picked.oauth, false);
  assert.equal(JSON.stringify(picked).includes('/x'), false);
  assert.deepEqual(picked.limits.map((l) => [l.id, l.label, l.group, l.percent]), [
    ['session', 'Current session', 'session', 9],
    ['weekly_all', 'This week', 'weekly', 5],
    ['weekly_scoped:fable', 'Fable', 'weekly', 0],
  ]);
  assert.equal(picked.limits[0].resetsAt, S('2026-10-22T15:00:00Z'));
  assert.equal(picked.limits[0].observedAt, NOW - 60_000);
  const noList = pickClaudeJson(claudeJson({ cachedUsageUtilization: { fetchedAtMs: 5, utilization: { seven_day_opus: { utilization: 40, resets_at: null }, five_hour: null } } }));
  assert.deepEqual(noList.limits, [{ id: 'weekly_scoped:opus', label: 'Opus', group: 'weekly', percent: 40, resetsAt: null, observedAt: 5 }]);
  assert.deepEqual(pickClaudeJson({}).limits, []);
});

test('window usage and .claude.json merge freshest-wins; a passed reset is stale with no percent', () => {
  const cj = pickClaudeJson(claudeJson());
  const windows = {
    five_hour: { utilization: 0.42, resetsAt: S('2026-10-22T15:00:00Z'), observedAt: NOW - 1000 },
    seven_day: { utilization: 0.9, resetsAt: S('2026-10-25T01:00:00Z'), observedAt: NOW - 120_000 },
    seven_day_sonnet: { utilization: 0.1, resetsAt: S('2026-10-22T11:00:00Z'), observedAt: NOW - 1000 },
    overage: null,
  };
  const limits = limitsOf({ windows, claudeJson: cj, now: NOW });
  assert.deepEqual(limits.map((l) => l.id), ['session', 'weekly_all', 'weekly_scoped:sonnet', 'weekly_scoped:fable']);
  const by = Object.fromEntries(limits.map((l) => [l.id, l]));
  assert.equal(by.session.percent, 42, 'the event is fresher than .claude.json');
  assert.equal(by.weekly_all.percent, 5, '.claude.json is fresher than the old event');
  assert.deepEqual(by['weekly_scoped:sonnet'], { id: 'weekly_scoped:sonnet', label: 'Sonnet', group: 'weekly', percent: null, resetsAt: S('2026-10-22T11:00:00Z'), observedAt: NOW - 1000, stale: true });
  assert.equal(by.session.stale, false);
  assert.deepEqual(limitsOf({ now: NOW }), []);
  assert.deepEqual(windowsFromClaudeJson(cj), {
    five_hour: { utilization: 0.09, resetsAt: S('2026-10-22T15:00:00Z'), status: null, observedAt: NOW - 60_000 },
    seven_day: { utilization: 0.05, resetsAt: S('2026-10-25T01:00:00Z'), status: null, observedAt: NOW - 60_000 },
  });
});

test('readClaudeJson re-reads only on change and gives null for a missing file', () => {
  const path = join(tmp('acct-cj-'), '.claude.json');
  assert.equal(readClaudeJson(path), null);
  assert.equal(readClaudeJson(null), null);
  writeFileSync(path, JSON.stringify(claudeJson()));
  assert.equal(readClaudeJson(path).limits.length, 3);
  assert.equal(readClaudeJson(path), readClaudeJson(path), 'cached');
  writeFileSync(path, JSON.stringify(claudeJson({ cachedUsageUtilization: null })));
  utimesSync(path, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(readClaudeJson(path).limits, []);
});

test('the env of a non-default account only adds CLAUDE_CONFIG_DIR; the default env is untouched', () => {
  const parent = { HOME: '/h', PATH: '/bin', CLAUDE_CONFIG_DIR: '/sys' };
  assert.equal(accountEnv(parent, DEFAULT_ACCOUNT), parent);
  assert.deepEqual(accountEnv(parent, { id: 'work', name: 'Work', configDir: '/a/work' }), { HOME: '/h', PATH: '/bin', CLAUDE_CONFIG_DIR: '/a/work' });
  assert.deepEqual(parent, { HOME: '/h', PATH: '/bin', CLAUDE_CONFIG_DIR: '/sys' });
  assert.equal(loginCommand(DEFAULT_ACCOUNT), 'claude auth login --claudeai');
  assert.equal(loginCommand({ id: 'w', configDir: "/a/it's" }), `CLAUDE_CONFIG_DIR='/a/it'\\''s' claude auth login --claudeai`);
  assert.equal(defaultClaudeJsonPath({}, '/home/me'), '/home/me/.claude.json');
  assert.equal(defaultClaudeJsonPath({ CLAUDE_CONFIG_DIR: '/c' }, '/home/me'), '/c/.claude.json');
});

test('slugId makes a free valid id', () => {
  assert.equal(slugId('Work Account'), 'work-account');
  assert.equal(slugId('Work', ['work']), 'work-2');
  assert.equal(slugId('Default'), 'default-2');
  assert.equal(slugId('***'), 'account');
  assert.match(slugId('x'.repeat(80), ['x'.repeat(27)]), /^[a-z0-9-]{1,32}$/);
});

test('account auth runs the check with the account env, caches it and keeps only safe fields', async () => {
  const seen = [];
  const check = async (o) => { seen.push(o); return { ok: true, reason: 'ok', fix: '', email: 'w@x', subscriptionType: 'pro', authMethod: 'claude.ai', accessToken: 'nope' }; };
  const auth = createAccountAuth({ claudePath: '/c', parentEnv: { A: '1' }, check });
  assert.equal(auth.get('work'), null);
  const work = { id: 'work', name: 'Work', configDir: '/a/work' };
  const v = await auth.refresh(work);
  assert.deepEqual(seen[0].parentEnv, { A: '1', CLAUDE_CONFIG_DIR: '/a/work' });
  assert.equal(seen[0].claudePath, '/c');
  assert.match(seen[0].login, /^CLAUDE_CONFIG_DIR='\/a\/work' /);
  assert.deepEqual(Object.keys(v).sort(), ['checkedAt', 'email', 'reason', 'signedIn', 'subscriptionType']);
  assert.equal(auth.get('work'), v);
  assert.equal(auth.remember('default', { ok: false, reason: 'logged out' }).signedIn, false);
  auth.forget('work');
  assert.equal(auth.get('work'), null);
});

test('accountView puts plan, renewal, limits and login together', () => {
  const view = accountView({ account: DEFAULT_ACCOUNT, auth: { signedIn: true, email: 'a@b', subscriptionType: 'max' }, claudeJson: pickClaudeJson(claudeJson()), now: NOW });
  assert.deepEqual({ ...view, limits: view.limits.length }, {
    id: 'default', name: 'Main', configDir: null, isDefault: true, signedIn: true, email: 'a@b',
    plan: { label: 'Max (5x)', type: 'claude_max', tier: 'default_claude_max_5x' }, renewsAt: '2026-10-31T07:03:43.059Z', renewsEstimated: true,
    loginCommand: 'claude auth login --claudeai', limits: 3,
  });
  const bare = accountView({ account: { id: 'w', name: 'W', configDir: '/w' }, now: NOW });
  assert.equal(bare.signedIn, null);
  assert.equal(bare.plan, null);
  assert.deepEqual(bare.limits, []);
});

function claudeBin(dir) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
if (process.argv[2] === 'auth') {
  const d = process.env.CLAUDE_CONFIG_DIR;
  require('node:fs').appendFileSync(${JSON.stringify(join(dir, 'auth-calls'))}, (d ?? '-') + '\\n');
  const out = d && d.endsWith('/off') ? { loggedIn: false } : { loggedIn: true, authMethod: 'claude.ai', email: d ? require('node:path').basename(d) + '@x' : 'main@x', subscriptionType: 'pro' };
  console.log(JSON.stringify(out));
  process.exit(0);
}
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  return bin;
}

async function boot() {
  const dir = tmp('acct-app-');
  const data = join(dir, 'data');
  mkdirSync(data);
  const cj = join(dir, 'home.claude.json');
  writeFileSync(cj, JSON.stringify(claudeJson()));
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  const app = createApp({ dataDir: data, claudePath: claudeBin(dir), pluginRoot: dir, parentEnv: env, claudeJsonPath: cj });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const calls = () => (existsSync(join(dir, 'auth-calls')) ? readFileSync(join(dir, 'auth-calls'), 'utf8').trim().split('\n') : []);
  return { app, api, dir, data, calls };
}

test('GET /api/state lists the default account first with its plan and .claude.json limits', async () => {
  const t = await boot();
  try {
    const { body } = await t.api('GET', '/api/state');
    assert.equal(body.accounts.length, 1);
    const [main] = body.accounts;
    assert.equal(main.id, 'default');
    assert.equal(main.isDefault, true);
    assert.equal(main.signedIn, true);
    assert.equal(main.email, 'main@x');
    assert.equal(main.plan.label, 'Max (5x)');
    assert.equal(main.renewsEstimated, true);
    assert.deepEqual(main.limits.map((l) => l.id), ['session', 'weekly_all', 'weekly_scoped:fable']);
  } finally { await t.app.close(); }
});

test('POST /api/accounts makes a 0700 config dir under the data dir and checks auth with that dir', async () => {
  const t = await boot();
  try {
    const r = await t.api('POST', '/api/accounts', { name: 'Work' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const dir = join(t.data, 'accounts', 'work');
    assert.equal(r.body.id, 'work');
    assert.equal(r.body.configDir, dir);
    assert.equal(r.body.signedIn, true);
    assert.equal(r.body.email, 'work@x');
    assert.equal(r.body.loginCommand, `CLAUDE_CONFIG_DIR='${dir}' claude auth login --claudeai`);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.ok(t.calls().includes(dir));
    assert.deepEqual(loadSettings(t.data).accounts, [{ id: 'work', name: 'Work', configDir: dir }]);
    writeFileSync(join(dir, '.claude.json'), JSON.stringify(claudeJson({ oauthAccount: { organizationType: 'claude_pro' } })));
    const s = (await t.api('GET', '/api/state')).body;
    assert.deepEqual(s.accounts.map((a) => a.id), ['default', 'work']);
    assert.equal(s.accounts[1].plan.label, 'Pro');
    assert.equal(s.accounts[1].limits.length, 3);
    const again = await t.api('POST', '/api/accounts', { name: 'Work' });
    assert.equal(again.body.id, 'work-2');
  } finally { await t.app.close(); }
});

test('POST /api/accounts takes an absolute configDir, refuses a relative or reused one and a missing name', async () => {
  const t = await boot();
  try {
    const own = join(t.dir, 'own', 'off');
    const r = await t.api('POST', '/api/accounts', { name: 'Side', configDir: `${own}/` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.configDir, own);
    assert.equal(r.body.signedIn, false);
    assert.ok(existsSync(own));
    assert.equal((await t.api('POST', '/api/accounts', { name: 'Other', configDir: own })).status, 409);
    assert.equal((await t.api('POST', '/api/accounts', { name: 'Rel', configDir: 'rel/dir' })).status, 400);
    assert.equal((await t.api('POST', '/api/accounts', { name: '  ' })).status, 400);
    assert.equal((await t.api('POST', '/api/accounts', { name: 'x'.repeat(65) })).status, 400);
    assert.equal(loadSettings(t.data).accounts.length, 1);
  } finally { await t.app.close(); }
});

test('POST /api/accounts/:id/check reruns auth status for that account', async () => {
  const t = await boot();
  try {
    const { body } = await t.api('POST', '/api/accounts', { name: 'Work' });
    const before = t.calls().filter((c) => c === body.configDir).length;
    const r = await t.api('POST', '/api/accounts/work/check');
    assert.equal(r.status, 200);
    assert.equal(r.body.signedIn, true);
    assert.equal(t.calls().filter((c) => c === body.configDir).length, before + 1);
    const d = await t.api('POST', '/api/accounts/default/check');
    assert.equal(d.body.isDefault, true);
    assert.equal(t.calls().at(-1), '-', 'the default account runs without CLAUDE_CONFIG_DIR');
    assert.equal((await t.api('POST', '/api/accounts/nope/check')).status, 404);
  } finally { await t.app.close(); }
});

test('POST /api/accounts/:id/remove moves its stages to default and refuses default or a live job', async () => {
  const t = await boot();
  t.app.state.jobs.push({ id: 'j1', stage: 'build', status: 'running', account: 'busy' });
  try {
    await t.api('POST', '/api/accounts', { name: 'Work' });
    await t.api('POST', '/api/accounts', { name: 'Busy' });
    const put = await t.api('PUT', '/api/settings', { accountByStage: { build: 'work', spec: 'busy' } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.deepEqual(put.body.accountByStage, { build: 'work', spec: 'busy' });
    assert.equal((await t.api('POST', '/api/accounts/default/remove')).status, 400);
    assert.equal((await t.api('POST', '/api/accounts/busy/remove')).status, 409);
    assert.equal((await t.api('POST', '/api/accounts/nope/remove')).status, 404);
    const r = await t.api('POST', '/api/accounts/work/remove');
    assert.equal(r.status, 200);
    const s = loadSettings(t.data);
    assert.deepEqual(s.accounts.map((a) => a.id), ['busy']);
    assert.deepEqual(s.accountByStage, { build: 'default', spec: 'busy' });
    assert.ok(existsSync(join(t.data, 'accounts', 'work')), 'the login dir is kept');
  } finally { await t.app.close(); }
});

test('PUT /api/settings refuses accounts and an unknown stage or account id', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('PUT', '/api/settings', { accounts: [] })).status, 400);
    assert.equal((await t.api('PUT', '/api/settings', { accountByStage: { build: 'ghost' } })).status, 400);
    assert.equal((await t.api('PUT', '/api/settings', { accountByStage: { nostage: 'default' } })).status, 400);
    assert.equal((await t.api('PUT', '/api/settings', { accountByStage: { build: 'default' } })).status, 200);
  } finally { await t.app.close(); }
});

test('boot checks auth of every saved account with its own config dir', async () => {
  const dir = tmp('acct-boot-');
  const data = join(dir, 'data');
  mkdirSync(data);
  const work = join(dir, 'work');
  mkdirSync(work);
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ accounts: [{ id: 'work', name: 'Work', configDir: work }] }));
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  const app = createApp({ dataDir: data, claudePath: claudeBin(dir), pluginRoot: dir, parentEnv: env });
  try {
    await app.start();
    const end = Date.now() + 5000;
    const seen = () => (existsSync(join(dir, 'auth-calls')) ? readFileSync(join(dir, 'auth-calls'), 'utf8') : '');
    while (!seen().includes(work) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    assert.ok(seen().includes(work));
  } finally { await app.close(); }
});
