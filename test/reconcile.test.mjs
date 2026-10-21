import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createStore } from '../src/daemon/store.mjs';
import { reconcile } from '../src/daemon/reconcile.mjs';
import { loadStages } from '../src/daemon/stages.mjs';

const run = promisify(execFile);
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const fixtureSession = JSON.parse(readFileSync(new URL('./fixtures/probes/p7a-killed.jsonl', import.meta.url), 'utf8').split('\n')[0]).session_id;

async function oldGroup({ killLeader = false } = {}) {
  const leader = spawn('sh', ['-c', 'sleep 60 & sleep 60'], { detached: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  const lstart = (await run('ps', ['-o', 'lstart=', '-p', String(leader.pid)])).stdout.trim();
  if (killLeader) process.kill(leader.pid, 'SIGKILL');
  return { pid: leader.pid, lstart };
}

function setup(jobExtra = {}) {
  const worktree = tmp('rec-wt-');
  const store = createStore(tmp('rec-data-'));
  const card = { id: 'c1', title: 'Greet', body: 'b' };
  const job = { id: 'j1', cardId: 'c1', stage: 'spec', status: 'running', sessionId: fixtureSession, worktree, pluginRoot: '/plugin', ...jobExtra };
  const state = { projects: [], cards: [card], jobs: [job] };
  const starts = [];
  const supervisor = { start: async (o) => { starts.push({ ...o, groupAliveAtStart: o.job.pgid && alive(o.job.pgid) }); } };
  return { store, state, job, supervisor, starts, worktree };
}

test('F-2-17 S-04 C-03 kills the old group, then resumes the session with the resume mode', async () => {
  const g = await oldGroup();
  const s = setup({ pid: g.pid, pgid: g.pid, startedAtLstart: g.lstart });
  const res = await reconcile({ ...s, sessionExists: () => true, graceMs: 500 });
  assert.deepEqual(res, [{ jobId: 'j1', outcome: 'resumed' }]);
  assert.equal(alive(g.pid), false);
  assert.equal(s.starts.length, 1);
  assert.equal(s.starts[0].mode, 'resume');
  assert.equal(s.starts[0].job.sessionId, fixtureSession);
  assert.equal(s.starts[0].groupAliveAtStart, false, 'no second writer when resume starts');
  assert.equal(s.starts[0].worktree, s.worktree);
  assert.ok(loadStages().stages.spec.resumeMessage);
});

test('p7a orphaned tool: leader killed, tool survives; the group is still killed before resume', async () => {
  const g = await oldGroup({ killLeader: true });
  const s = setup({ pid: g.pid, pgid: g.pid, startedAtLstart: g.lstart });
  const { stdout } = await run('ps', ['-A', '-o', 'pgid=']);
  assert.ok(stdout.split('\n').some((l) => Number(l) === g.pid), 'tool survivor in old group');
  await reconcile({ ...s, sessionExists: () => true, graceMs: 500 });
  const after = (await run('ps', ['-A', '-o', 'pgid='])).stdout.split('\n').some((l) => Number(l) === g.pid);
  assert.equal(after, false);
  assert.equal(s.starts.length, 1);
});

test('a reused pid with a different start time is not killed, and job resumes', async () => {
  const other = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 100));
  try {
    const s = setup({ pid: other.pid, pgid: other.pid, startedAtLstart: 'Mon Jan  1 00:00:00 2001' });
    await reconcile({ ...s, sessionExists: () => true, graceMs: 200 });
    assert.equal(alive(other.pid), true);
    assert.equal(s.starts.length, 1);
  } finally {
    process.kill(other.pid, 'SIGKILL');
  }
});

test('S-04 missing worktree marks the job crashed and starts nothing', async () => {
  const s = setup({ worktree: '/nonexistent/exo-wt' });
  const res = await reconcile({ ...s, sessionExists: () => true });
  assert.equal(res[0].outcome, 'crashed');
  assert.equal(s.job.status, 'crashed');
  assert.equal(s.job.crashReason, 'worktree-missing');
  assert.equal(s.starts.length, 0);
  assert.equal(s.store.load().jobs[0].status, 'crashed');
});

test('S-04 missing session marks the job crashed', async () => {
  const s = setup();
  await reconcile({ ...s, sessionExists: () => false });
  assert.equal(s.job.status, 'crashed');
  assert.equal(s.job.crashReason, 'session-missing');
  assert.equal(s.starts.length, 0);
});

test('final and queued jobs are left alone', async () => {
  const s = setup({ status: 'done' });
  s.state.jobs.push({ id: 'j2', cardId: 'c1', stage: 'spec', status: 'queued' });
  const res = await reconcile({ ...s, sessionExists: () => true });
  assert.deepEqual(res, []);
  assert.equal(s.starts.length, 0);
});

test('a SIGTERM-ignoring group is SIGKILLed after the grace period', async () => {
  const g = await oldGroup();
  const s = setup({ pid: g.pid, pgid: g.pid, startedAtLstart: g.lstart });
  try {
    await reconcile({ ...s, sessionExists: () => true, graceMs: 0 });
    assert.equal(alive(g.pid), false);
  } finally {
    try { process.kill(-g.pid, 'SIGKILL'); } catch {}
  }
});
