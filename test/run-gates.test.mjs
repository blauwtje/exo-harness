import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/daemon/app.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 80; i++) { if (await fn()) return; await sleep(100); } assert.fail('timed out'); };
const gitIn = (dir) => (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]).toString();

// why: a main checkout on main plus a linked worktree on feat-x with one changed file, as Shape leaves them.
function repos() {
  const main = tmp('rg-main-');
  const g = gitIn(main);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  const worktree = join(tmp('rg-wtp-'), 'wt');
  g('worktree', 'add', '-q', '-b', 'feat-x', worktree);
  writeFileSync(join(worktree, 'a.txt'), 'two\n');
  gitIn(worktree)('commit', '-q', '-am', 'feat');
  return { main, g, worktree };
}

async function boot(scenario) {
  const base = tmp('rg-dir-');
  const claude = join(base, 'claude');
  writeFileSync(claude, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))});\n`);
  chmodSync(claude, 0o755);
  const r = repos();
  const brief = join(r.worktree, 'plan.md');
  writeFileSync(brief, '# Plan\n\n## Plan basis\nBranch: feat-x2\nLand: none\n');
  const scenarioFile = join(base, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const data = join(base, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'state.json'), JSON.stringify({
    projects: [{ key: 'local/p', path: r.main, origin: null }],
    cards: [{ id: 'c1', projectKey: 'local/p', title: 'T', lane: 'Shaped' }],
    jobs: [{ id: 'shape1', cardId: 'c1', stage: 'spec', status: 'done', worktree: r.worktree, brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } }],
  }));
  process.env.FAKE_EXO_SCENARIO = scenarioFile;
  const mk = () => createApp({ dataDir: data, claudePath: claude, pluginRoot: fakeRoot, parentEnv: { ...process.env, FAKE_EXO_SCENARIO: scenarioFile } });
  const open = async (app) => {
    const { port, url } = await app.start();
    const token = new URL(url).hash.replace(/^#token=/, '');
    return async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
  };
  const app = mk();
  const api = await open(app);
  const setScenario = (s) => writeFileSync(scenarioFile, JSON.stringify(s));
  return { app, api, data, setScenario, mk, open, ...r, state: app.state, runJob: () => app.state.jobs.find((j) => j.stage === 'run'), card: () => app.state.cards[0] };
}

const parkedScenario = { id: 'g1', phase: 'parked', branch: 'feat-x', gates: [{ source: 'land', action: 'review the diff', reason: 'needs review' }], denied: 'rm -rf /\n', report: '# Report\nline\n', approve: { phase: 'landed' } };

test('F-3-07 S-05 a parked run is a gate card with details, a guarded per-file diff, and Approve calls exo approve', async () => {
  const t = await boot(parkedScenario);
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'gate');
    assert.match(j.needsYou.gates[0], /review the diff/);
    assert.match(j.needsYou.diffStat, /a\.txt/);
    assert.deepEqual(j.needsYou.files, ['a.txt']);
    assert.equal(j.needsYou.denied, 'rm -rf /\n');
    assert.match(j.needsYou.reportHead, /# Report/);
    assert.equal(t.card().lane, 'Review');
    assert.match((await t.api('GET', `/api/jobs/${j.id}/diff?file=a.txt`)).body.diff, /\+two/);
    for (const bad of ['../a.txt', '/etc/passwd', 'nope.txt', '']) {
      assert.equal((await t.api('GET', `/api/jobs/${j.id}/diff?file=${encodeURIComponent(bad)}`)).status, 400);
    }
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/approve-gate`)).status, 200);
    await until(() => j.status === 'done');
    assert.equal(t.card().lane, 'Done');
  } finally { await t.app.close(); }
});

test('F-3-07 S-05 Reject at a gate puts the card back to Shaped and leaves the run parked', async () => {
  const t = await boot(parkedScenario);
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'gate');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/reject-gate`)).status, 200);
    assert.equal(t.card().lane, 'Shaped');
    assert.equal(j.needsYou, undefined);
    assert.equal(j.run.phase, 'parked');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/approve-gate`)).status, 409);
  } finally { await t.app.close(); }
});

test('F-3-08 S-05 a stopped run is a run-failed card with Reason; Resume continues it, Discard removes the archived worktree', async () => {
  const t = await boot({ id: 'f1', phase: 'stopped', reason: 'budget: spent', branch: 'feat-x' });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'run-failed');
    assert.equal(j.needsYou.reason, 'budget: spent');
    assert.deepEqual(j.needsYou.options, ['resume', 'retry', 'discard']);
    assert.ok(existsSync(join(t.data, 'jobs', j.id, 'run', '.archived')));
    t.setScenario({ id: 'f1', phase: 'stopped', reason: 'budget: spent', branch: 'feat-x', resume: { phase: 'stopped', reason: 'again' } });
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/resume-run`)).status, 200);
    await until(() => j.needsYou?.reason === 'again');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/discard`)).status, 200);
    assert.equal(existsSync(t.worktree), false);
    assert.equal(t.card().lane, 'Shaped');
    assert.ok(existsSync(join(t.data, 'jobs', j.id, 'run', '.archived')));
  } finally { await t.app.close(); }
});

test('F-3-08 a non-final phase with a dead pid gets one automatic resume, the second time a run-failed card', async () => {
  const t = await boot({ id: 'd1', phase: 'build', branch: 'feat-x', resume: { phase: 'build' } });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'run-failed');
    assert.equal(j.run.resumed, true);
    assert.match(j.needsYou.reason, /process is gone/);
  } finally { await t.app.close(); }
});

test('F-3-09 every final phase archives into the data dir; landed also removes the worktree after the archive', async () => {
  const t = await boot({ id: 'l1', phase: 'landed', branch: 'feat-x' });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.worktreeRemoved === true);
    assert.equal(t.card().lane, 'Done');
    assert.equal(j.status, 'done');
    assert.ok(existsSync(join(t.data, 'jobs', j.id, 'run', '.archived')));
    assert.ok(existsSync(join(t.data, 'jobs', j.id, 'run', 'state', 'state.json')));
    assert.equal(existsSync(t.worktree), false);
    assert.ok(existsSync(join(t.main, '.exo', 'kept')));
  } finally { await t.app.close(); }
});

test('F-3-11 S-06 a rebase-conflict gate lists the conflicting files and offers Find cause or Manual', async () => {
  const t = await boot({ id: 'k1', phase: 'parked', branch: 'feat-x', gates: [{ source: 'land', action: 'rebase feat-x onto main yourself', reason: 'rebase conflict' }] });
  try {
    writeFileSync(join(t.main, 'a.txt'), 'three\n');
    t.g('commit', '-q', '-am', 'main change');
    const before = t.g('status', '--porcelain');
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'conflict');
    assert.deepEqual(j.needsYou.conflicts, ['a.txt']);
    assert.deepEqual(j.needsYou.options, ['find-cause', 'manual', 'approve', 'reject']);
    assert.equal(j.needsYou.worktree, t.worktree);
    assert.equal(t.g('status', '--porcelain'), before);
  } finally { await t.app.close(); }
});

test('F-3-12 a run parked at cannot switch is landed by the deck fast-forward; a dirty main checkout is a land card with Retry', async () => {
  const t = await boot({ id: 'p1', phase: 'parked', branch: 'feat-x', gates: [{ source: 'land', action: 'switch', reason: 'cannot switch to main' }] });
  try {
    writeFileSync(join(t.main, 'a.txt'), 'dirty\n');
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'land');
    assert.match(j.needsYou.action, /clean .* and switch it to main/);
    assert.equal(t.g('show', 'HEAD:a.txt'), 'one\n');
    t.g('checkout', '--', 'a.txt');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/finish-land`)).status, 200);
    await until(() => j.status === 'done');
    assert.match(j.run.landed, /^[0-9a-f]+\.\.[0-9a-f]+$/);
    assert.equal(t.g('show', 'HEAD:a.txt'), 'two\n');
    assert.equal(t.card().lane, 'Done');
  } finally { await t.app.close(); }
});

test('F-3-06 after a restart the app re-attaches the run watch: the run job is not crashed and a finished run is handled', async () => {
  const t = await boot({ id: 'r1', phase: 'build', branch: 'feat-x' });
  try {
    await t.app.close();
    const runDir = join(t.worktree, '.exo', 'run', 'r1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'state.json'), JSON.stringify({ id: 'r1', phase: 'landed', runRoot: t.worktree, branch: 'feat-x', plan: 'plan.md', startedAt: new Date().toISOString() }));
    const file = join(t.data, 'state.json');
    const seed = JSON.parse(readFileSync(file, 'utf8'));
    seed.jobs.push({ id: 'run1', cardId: 'c1', stage: 'run', status: 'running', worktree: t.worktree, runRoot: t.worktree, run: { id: 'r1', phase: 'build', branch: 'feat-x', alive: true } });
    writeFileSync(file, JSON.stringify(seed));
    const second = t.mk();
    await t.open(second);
    try {
      const j = second.state.jobs.find((x) => x.id === 'run1');
      await until(() => j.status === 'done');
      assert.equal(j.sessionId, undefined);
      assert.equal(second.state.cards[0].lane, 'Done');
    } finally { await second.close(); }
  } finally { await t.app.close(); }
});
