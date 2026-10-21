import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { watchHardStop } from '../src/daemon/hard-stop.mjs';

function setup(pid = 4242) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hs-')));
  mkdirSync(join(root, '.exo', 'run', 'r1'), { recursive: true });
  const setState = (s) => writeFileSync(join(root, '.exo', 'run', 'r1', 'state.json'),
    JSON.stringify({ id: 'r1', phase: 'building', pid, landed: 0, ...s }));
  const job = { id: 'j1', runRoot: root, run: { id: 'r1' } };
  const kills = [];
  const usage = { five_hour: { utilization: 0.5 } };
  const w = watchHardStop({ getUsage: () => usage, settings: { hardStopFiveHour: 0.9 }, runs: () => [job], kill: (p, s) => kills.push([p, s]), intervalMs: 1e6 });
  return { setState, job, kills, usage, w };
}

test('F-4-05 waits for the landed count to rise, then signals the group once and records hard-stop', () => {
  const t = setup();
  t.setState({ landed: 1 });
  t.usage.five_hour.utilization = 0.93;
  t.w.tick();
  t.w.tick();
  assert.deepEqual(t.kills, []);
  t.setState({ landed: 2 });
  t.w.tick();
  t.w.tick();
  assert.deepEqual(t.kills, [[4242, 'SIGTERM']]);
  assert.equal(t.job.outcome, 'hard-stop');
  t.w.stop();
});

test('F-4-05 does nothing under the hard stop, even as tasks land', () => {
  const t = setup();
  t.setState({ landed: 1 });
  t.w.tick();
  t.setState({ landed: 2 });
  t.w.tick();
  assert.deepEqual(t.kills, []);
  assert.equal(t.job.outcome, undefined);
  t.w.stop();
});

test('F-4-05 refuses an unsafe pid and skips a finished run', () => {
  const t = setup(1);
  t.usage.five_hour.utilization = 0.95;
  t.setState({ landed: 0, pid: 1 });
  t.w.tick();
  t.setState({ landed: 1, pid: 1 });
  t.w.tick();
  t.setState({ landed: 2, pid: 4242, phase: 'passed' });
  t.w.tick();
  assert.deepEqual(t.kills, []);
  t.w.stop();
});
