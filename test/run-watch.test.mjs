import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/daemon/store.mjs';
import { watchRun } from '../src/daemon/run-watch.mjs';

const startedAt = '2026-01-02T03:04:05.000Z';
const logsOf = (root) => join(root, '.exo', 'run-plan', 'plan', '20260102T030405Z');

function setup(extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rw-')));
  mkdirSync(join(root, '.exo', 'run', 'r1'), { recursive: true });
  mkdirSync(logsOf(root), { recursive: true });
  const setState = (s) => writeFileSync(join(root, '.exo', 'run', 'r1', 'state.json'),
    JSON.stringify({ id: 'r1', plan: 'plan.md', startedAt, runRoot: root, phase: 'building', stage: 'build', ...extra, ...s }));
  const store = createStore(mkdtempSync(join(tmpdir(), 'rw-store-')));
  const job = { id: 'j1', run: { id: 'r1' } };
  return { root, setState, store, job, state: { jobs: [job] } };
}
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };

test('F-3-05 polls state.json into job.run with pid liveness', async () => {
  const t = setup({ pid: 2 ** 22 - 1 });
  t.setState({ task: { n: 1 }, landed: 0, total: 2 });
  const w = watchRun({ ...t, runRoot: t.root, intervalMs: 20 });
  await until(() => t.job.run.phase === 'building');
  assert.deepEqual([t.job.run.landed, t.job.run.total, t.job.run.alive], [0, 2, false]);
  t.setState({ phase: 'parked', reason: 'gate' });
  await until(() => t.job.run.phase === 'parked');
  assert.equal(t.job.run.reason, 'gate');
  w.stop();
});

test('F-3-06 tails iter logs with their log name and accepts a matching init', async () => {
  const t = setup();
  t.setState({});
  const init = { type: 'system', subtype: 'init', apiKeySource: 'none', cwd: t.root };
  writeFileSync(join(logsOf(t.root), 'iter-1-task-1.log'), `${JSON.stringify(init)}\nnot json\n`);
  const w = watchRun({ ...t, runRoot: t.root, intervalMs: 20 });
  await until(() => t.store.readEvents('j1').length === 2);
  const [a, b] = t.store.readEvents('j1');
  assert.equal(a.log, 'iter-1-task-1.log');
  assert.deepEqual([b.kind, b.log], ['malformed', 'iter-1-task-1.log']);
  appendFileSync(join(logsOf(t.root), 'iter-1-task-1.log'), `${JSON.stringify({ type: 'result' })}\n`);
  await until(() => t.store.readEvents('j1').length === 3);
  assert.equal(t.job.initMismatches, undefined);
  w.stop();
});

test('F-3-06 an init mismatch sends SIGTERM to the run group and flags the job', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  const exited = new Promise((r) => child.on('exit', (_c, sig) => r(sig)));
  const t = setup({ pid: child.pid });
  t.setState({});
  const init = { type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY', cwd: '/elsewhere' };
  writeFileSync(join(logsOf(t.root), 'iter-1-task-1.log'), `${JSON.stringify(init)}\n`);
  const w = watchRun({ ...t, runRoot: t.root, intervalMs: 20 });
  assert.equal(await exited, 'SIGTERM');
  assert.deepEqual(t.job.initMismatches, ['apiKeySource', 'cwd']);
  assert.equal(t.job.outcome, 'invariant');
  w.stop();
});
