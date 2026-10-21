import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/daemon/store.mjs';
import { createSupervisor } from '../src/daemon/supervisor.mjs';

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };
const init = (cwd) => JSON.stringify({
  type: 'system', subtype: 'init', cwd, apiKeySource: 'none', permissionMode: 'default', model: 'm',
  claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }],
});
const result = (n) => JSON.stringify({ type: 'result', subtype: 'success', num_turns: n });

function setup(mk, { stdinLog = true } = {}) {
  const dir = tmp('sup-');
  const worktree = tmp('sup-wt-');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const d = ${JSON.stringify(dir)};
const g = spawn('sleep', ['60'], { stdio: 'ignore' });
fs.writeFileSync(d + '/sleep.pid', String(g.pid));
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => { fs.appendFileSync(d + '/stdin.txt', l + '\\n'); console.log(JSON.stringify({ type: 'user', echo: true })); });
for (const l of ${JSON.stringify(mk(worktree))}) console.log(l);
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const store = createStore(tmp('sup-data-'));
  const card = { id: 'c1', title: 'Greet', body: 'b' };
  const job = { id: 'j1', cardId: 'c1', stage: 'spec' };
  const state = { projects: [], cards: [card], jobs: [job] };
  const fake = { starts: 0, kills: 0 };
  const sup = createSupervisor({
    store, state, onNeedsYou: (j, n) => { fake.card = n; },
    spawnCaffeinate: () => { fake.starts++; return { kill: () => { fake.kills++; }, on() {} }; },
  });
  const start = (extra = {}) => sup.start({
    job, card, worktree, pluginRoot: '/plugin', claudePath: bin, parentEnv: process.env, ...extra,
  });
  return { dir, sup, start, job, fake, worktree };
}
const stdin = (s) => (existsSync(join(s.dir, 'stdin.txt')) ? readFileSync(join(s.dir, 'stdin.txt'), 'utf8').split('\n').filter(Boolean) : []);

test('F-2-16 S-20 Stop kills the whole group after the grace, leaving no process', async () => {
  const s = setup((wt) => [init(wt)]);
  await s.start();
  await until(() => existsSync(join(s.dir, 'sleep.pid')));
  const sleepPid = Number(readFileSync(join(s.dir, 'sleep.pid'), 'utf8'));
  assert.ok(alive(sleepPid));
  await s.sup.stop('j1');
  await until(() => !alive(sleepPid));
  assert.equal(alive(sleepPid), false);
  assert.equal(s.sup.caffeinated(), false);
});

test('F-2-16 Stop all stops every job', async () => {
  const s = setup((wt) => [init(wt)]);
  await s.start();
  await until(() => existsSync(join(s.dir, 'sleep.pid')));
  const sleepPid = Number(readFileSync(join(s.dir, 'sleep.pid'), 'utf8'));
  await s.sup.stopAll();
  await until(() => !alive(sleepPid));
  assert.equal(alive(sleepPid), false);
});

test('F-2-20 S-20 quiet job is flagged stalled, not killed; caffeinate released then retaken on next event', async () => {
  const s = setup((wt) => [init(wt)]);
  const sess = await s.start({ stallMs: 200 });
  assert.equal(s.fake.starts, 1);
  assert.equal(s.job.stalled, undefined);
  await until(() => s.job.stalled === true);
  assert.equal(s.job.stalled, true);
  assert.equal(s.fake.kills, 1);
  assert.equal(s.sup.caffeinated(), false);
  assert.ok(alive(sess.pgid));
  s.sup.send('j1', 'wake');
  await until(() => s.job.stalled === false);
  assert.equal(s.job.stalled, false);
  assert.equal(s.fake.starts, 2);
  assert.equal(s.sup.caffeinated(), true);
  await s.sup.stop('j1');
});

test('Decision 25 total turns at the cap hold the next user message and open Needs-you, never kill', async () => {
  const s = setup((wt) => [init(wt), result(120), result(80)]);
  const sess = await s.start({ maxTotalTurns: 200 });
  await until(() => s.fake.card);
  assert.deepEqual(s.fake.card.options, ['continue', 'stop']);
  assert.equal(s.job.needsYou.turns, 200);
  assert.ok(alive(sess.pgid));
  s.sup.send('j1', 'next');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(stdin(s).filter((l) => l.includes('next')).length, 0);
  assert.equal(s.sup.continue('j1'), true);
  await until(() => stdin(s).some((l) => l.includes('next')));
  assert.equal(stdin(s).filter((l) => l.includes('next')).length, 1);
  assert.equal(s.job.needsYou, undefined);
  await s.sup.stop('j1');
});
