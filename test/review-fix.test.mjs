import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/daemon/app.mjs';
import { archiveDir, archiveRun } from '../src/daemon/archive.mjs';
import { createStore } from '../src/daemon/store.mjs';
import { watchRun } from '../src/daemon/run-watch.mjs';
import { checkProvider } from '../src/daemon/run-guard.mjs';
import { gateDetails } from '../src/daemon/run-gate.mjs';
import { runSetup } from '../src/daemon/setup.mjs';
import { laneOf } from '../src/ui/derive.js';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 80; i++) { if (await fn()) return; await sleep(100); } assert.fail('timed out'); };
const gitIn = (dir) => (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]).toString();

function repos() {
  const main = tmp('rx-main-');
  const g = gitIn(main);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  const worktree = join(tmp('rx-wtp-'), 'wt');
  g('worktree', 'add', '-q', '-b', 'feat-x', worktree);
  writeFileSync(join(worktree, 'a.txt'), 'two\n');
  gitIn(worktree)('commit', '-q', '-am', 'feat');
  return { main, g, worktree };
}

async function boot(scenario) {
  const base = tmp('rx-dir-');
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

const landGate = [{ source: 'land', action: 'switch', reason: 'cannot switch to main' }];

test('laneOf draws a parked run job in Review, not Running', () => {
  const job = { id: 'j', cardId: 'c', stage: 'run', status: 'waiting', needsYou: { kind: 'gate' } };
  assert.equal(laneOf({ jobs: [job] }, { id: 'c', lane: 'Review' }), 'Review');
  assert.equal(laneOf({ jobs: [{ ...job, status: 'running', needsYou: undefined }] }, { id: 'c', lane: 'Approved' }), 'Running');
});

test('a failed deck land puts the card in Review', async () => {
  const t = await boot({ id: 'p1', phase: 'parked', branch: 'feat-x', gates: landGate });
  try {
    writeFileSync(join(t.main, 'a.txt'), 'dirty\n');
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'land');
    assert.equal(t.card().lane, 'Review');
    await t.api('POST', `/api/jobs/${j.id}/finish-land`);
    assert.equal(t.card().lane, 'Review');
  } finally { await t.app.close(); }
});

test('a resumed run that lands by the deck fast-forward archives its own state first', async () => {
  const t = await boot({ id: 's1', phase: 'stopped', reason: 'budget', branch: 'feat-x' });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'run-failed');
    t.setScenario({ id: 's1', phase: 'stopped', branch: 'feat-x', resume: { phase: 'parked', gates: landGate } });
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/resume-run`)).status, 200);
    await until(() => j.status === 'done');
    const archived = JSON.parse(readFileSync(join(t.data, 'jobs', j.id, 'run', 'state', 'state.json'), 'utf8'));
    assert.equal(archived.phase, 'parked');
  } finally { await t.app.close(); }
});

test('Retry keeps the one automatic resume spent by the first run of the job', async () => {
  const t = await boot({ id: 'd1', phase: 'build', branch: 'feat-x', resume: { phase: 'build' } });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'run-failed');
    assert.equal(j.run.resumed, true);
    t.setScenario({ id: 'd2', phase: 'build', branch: 'feat-x', resume: { phase: 'landed' } });
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/retry`)).status, 200);
    await until(() => j.run?.id === 'd2' && j.needsYou?.kind === 'run-failed');
    assert.match(j.needsYou.reason, /process is gone/);
    assert.notEqual(j.status, 'done');
  } finally { await t.app.close(); }
});

test('a run killed by the init check is stopped and archived, never resumed', async () => {
  const init = { type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY', cwd: '/elsewhere' };
  const t = await boot({ id: 'i1', phase: 'build', branch: 'feat-x', iters: { 'iter-1.log': [init] }, resume: { phase: 'build' } });
  try {
    await t.api('POST', '/api/cards/c1/approve');
    const j = t.runJob();
    await until(() => j.status === 'stopped');
    assert.deepEqual(j.initMismatches, ['apiKeySource', 'cwd']);
    assert.ok(existsSync(join(t.data, 'jobs', j.id, 'run', '.archived')));
    await sleep(300);
    assert.notEqual(j.run.resumed, true);
    assert.equal(j.outcome, 'invariant');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/resume-run`)).status, 409);
    assert.notEqual(j.run.resumed, true);
  } finally { await t.app.close(); }
});

test('a queued job is started again after a daemon restart', async () => {
  const t = await boot({ refuse: 'refused: another run holds the lock (.exo/run/lock)' });
  let second;
  try {
    const holderDir = join(t.worktree, '.exo', 'run', 'holder');
    mkdirSync(holderDir, { recursive: true });
    const holder = (phase) => writeFileSync(join(holderDir, 'state.json'), JSON.stringify({ id: 'holder', phase, pid: process.pid }));
    holder('build');
    await t.api('POST', '/api/cards/c1/approve');
    assert.equal(t.runJob().status, 'queued');
    await t.app.close();
    t.setScenario({ id: 'run-4', phase: 'build', branch: 'feat-x' });
    holder('landed');
    second = t.mk();
    await t.open(second);
    const j = second.state.jobs.find((x) => x.stage === 'run');
    await until(() => j.run?.id === 'run-4');
  } finally { await second?.close(); await t.app.close(); }
});

test('archiveRun keeps the earlier run of a job when a later run is archived', async () => {
  const data = tmp('rx-data-');
  const mkRun = (id) => {
    const dir = join(tmp('rx-run-'), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ id }));
    writeFileSync(join(dir, 'report.md'), `report ${id}`);
    return dir;
  };
  await archiveRun(data, 'j1', { runDir: mkRun('r1') });
  const dest = await archiveRun(data, 'j1', { runDir: mkRun('r2') });
  assert.equal(readFileSync(join(dest, 'state', 'report.md'), 'utf8'), 'report r2');
  const kept = readdirSync(dest).filter((n) => n !== 'state' && n !== '.archived');
  assert.ok(kept.some((n) => existsSync(join(dest, n, 'report.md')) && readFileSync(join(dest, n, 'report.md'), 'utf8') === 'report r1'));
});

test('archiveRun stops on a shelve error other than a missing file', async () => {
  const mkRun = (id) => {
    const dir = join(tmp('rx-run-'), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ id }));
    return dir;
  };
  const data = tmp('rx-data-');
  await archiveRun(data, 'j1', { runDir: mkRun('r1'), runPlanDir: mkRun('p1') });
  const taken = join(archiveDir(data, 'j1'), 'run-plan-r1');
  mkdirSync(taken);
  writeFileSync(join(taken, 'x'), 'x');
  await assert.rejects(archiveRun(data, 'j1', { runDir: mkRun('r2'), runPlanDir: mkRun('p2') }), { code: 'ENOTEMPTY' });
  const bad = tmp('rx-data-');
  mkdirSync(join(archiveDir(bad, 'j1'), 'state', 'state.json'), { recursive: true });
  await assert.rejects(archiveRun(bad, 'j1', { runDir: mkRun('r3') }), { code: 'EISDIR' });
});

test('a log that cannot be read is recorded as an event, once', async () => {
  const root = tmp('rx-w-');
  const startedAt = '2026-01-02T03:04:05.000Z';
  mkdirSync(join(root, '.exo', 'run', 'r1'), { recursive: true });
  const logs = join(root, '.exo', 'run-plan', 'plan', '20260102T030405Z');
  mkdirSync(join(logs, 'iter-1.log'), { recursive: true });
  writeFileSync(join(root, '.exo', 'run', 'r1', 'state.json'), JSON.stringify({ id: 'r1', plan: 'plan.md', startedAt, runRoot: root, phase: 'building' }));
  const store = createStore(tmp('rx-store-'));
  const job = { id: 'j1', run: { id: 'r1' } };
  const w = watchRun({ job, runRoot: root, store, state: { jobs: [job] }, intervalMs: 20 });
  await sleep(200);
  w.stop();
  const errors = store.readEvents(job.id).filter((e) => e.kind === 'watch-error');
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message);
});

test('checkProvider runs exo with the scrubbed env of the given parentEnv', async () => {
  const root = tmp('rx-plug-');
  const dir = join(root, 'skills', 'build', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'exo-cli.mjs'), 'const bad = process.env.ANTHROPIC_API_KEY || process.env.CLAUDECODE;\nconsole.log(`defaults.provider = "${bad ? "leaked" : "claude"}"`);\n');
  const parentEnv = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1' };
  const r = await checkProvider(root, root, parentEnv);
  assert.equal(r.ok, true);
});

test('runSetup runs the command with the scrubbed env of the given parentEnv', async () => {
  const wt = tmp('rx-setup-');
  writeFileSync(join(wt, 's.mjs'), 'console.log(`FOO=${process.env.FOO} KEY=${process.env.ANTHROPIC_API_KEY}`);\n');
  const r = await runSetup({ setup: `${process.execPath} s.mjs` }, wt, tmp('rx-main-'), { FOO: 'bar', ANTHROPIC_API_KEY: 'k' });
  assert.equal(r.ok, true);
  assert.match(r.tail, /FOO=bar KEY=undefined/);
});

test('gateDetails takes one options object', async () => {
  const { main, worktree } = repos();
  const runDir = tmp('rx-rd-');
  const d = await gateDetails({ runDir, runRoot: worktree, base: 'main', branch: 'feat-x' });
  assert.deepEqual(d.files, ['a.txt']);
  void main;
});

test('one exported final-phase list and one exo cli path serve every module', async () => {
  const exoRun = await import('../src/daemon/exo-run.mjs');
  const stages = await import('../src/daemon/stages.mjs');
  assert.ok(exoRun.FINAL_PHASES.includes('parked'));
  assert.equal(stages.cliOf('/p'), '/p/skills/build/scripts/exo-cli.mjs');
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  for (const f of ['src/daemon/run-watch.mjs', 'scripts/probe-p3.mjs', 'src/daemon/app.mjs']) assert.doesNotMatch(src(f), /'passed', 'landed'/, f);
  for (const f of ['src/daemon/run-guard.mjs', 'src/daemon/exo-run.mjs']) assert.doesNotMatch(src(f), /exo-cli\.mjs/, f);
  assert.doesNotMatch(src('src/daemon/run-watch.mjs'), /function alive|const alive/);
});
