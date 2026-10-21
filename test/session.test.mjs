import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/daemon/store.mjs';
import { startSession } from '../src/daemon/session.mjs';

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const init = (cwd, extra = {}) => JSON.stringify({
  type: 'system', subtype: 'init', cwd, apiKeySource: 'none', permissionMode: 'default', model: 'm',
  claude_code_version: '1', plugins: [{ name: 'exo', version: '0.136.0' }], ...extra,
});
const buildCall = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'exo:build' } }] } });
const resultLine = JSON.stringify({ type: 'result', subtype: 'success' });
const text = (t) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };

function setup(mk, { gap = 800 } = {}) {
  const dir = tmp('session-');
  const worktree = tmp('session-wt-');
  const lines = mk(worktree);
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const d = ${JSON.stringify(dir)};
const g = spawn('sleep', ['60'], { stdio: 'ignore' });
fs.writeFileSync(d + '/sleep.pid', String(g.pid));
fs.writeFileSync(d + '/argv.json', JSON.stringify({ argv: process.argv.slice(2), env: process.env, pgid: process.pid }));
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => fs.appendFileSync(d + '/stdin.txt', l + '\\n'));
for (const l of ${JSON.stringify(lines)}) console.log(l);
setTimeout(() => console.log(JSON.stringify({ type: 'user', late: true })), ${gap});
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const store = createStore(tmp('session-data-'));
  const card = { id: 'c1', title: 'Greet', body: 'add greeting' };
  const job = { id: 'j1', cardId: 'c1', stage: 'spec' };
  const state = { projects: [], cards: [card], jobs: [job] };
  return { dir, worktree, bin, store, card, job, state };
}
const start = (s, extra = {}) => startSession({
  store: s.store, state: s.state, job: s.job, card: s.card, worktree: s.worktree,
  pluginRoot: '/plugin', claudePath: s.bin, parentEnv: { ...process.env, ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_X: '1' }, ...extra,
});
const read = (s, f) => JSON.parse(readFileSync(join(s.dir, f), 'utf8'));

test('F-2-12 S-14 spawns a detached group leader with scrubbed env, recorded job and first message', async () => {
  const s = setup(() => []);
  const sess = await start(s);
  await until(() => existsSync(join(s.dir, 'stdin.txt')) && existsSync(join(s.dir, 'argv.json')));
  const { argv, env, pgid } = read(s, 'argv.json');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_X, undefined);
  assert.equal(argv[0], '--session-id');
  assert.equal(argv[1], s.job.sessionId);
  assert.equal(pgid, sess.pgid);
  const saved = s.state.jobs[0];
  assert.equal(saved.pid, sess.pid);
  assert.equal(saved.pgid, sess.pid);
  assert.match(saved.startedAtLstart, /\d{4}/);
  assert.equal(saved.status, 'running');
  const first = JSON.parse(readFileSync(join(s.dir, 'stdin.txt'), 'utf8').split('\n')[0]);
  assert.equal(first.message.content, '/exo:spec Greet\n\nadd greeting');
  sess.stop();
  await sess.done;
});

test('F-2-08 S-14 init mismatch kills the whole group before the next line arrives', async () => {
  const t = setup(() => [init('/somewhere/else')], { gap: 600 });
  const sess = await start(t);
  const out = await sess.done;
  assert.equal(out.reason, 'init-mismatch');
  assert.deepEqual(t.job.initMismatches, ['cwd']);
  await until(() => existsSync(join(t.dir, 'sleep.pid')));
  assert.equal(alive(Number(readFileSync(join(t.dir, 'sleep.pid'), 'utf8'))), false);
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!t.store.readEvents('j1').some((e) => e.late));
});

test('F-2-08 a result already buffered when the init check kills the session runs no turn', async () => {
  const t = setup(() => [init('/somewhere/else'), text('Brief written: docs/specs/greet.md'), resultLine], { gap: 600 });
  const turns = [];
  const sess = await start(t, { onTurn: (turn) => turns.push(turn) });
  const out = await sess.done;
  assert.equal(out.reason, 'init-mismatch');
  assert.deepEqual(turns, []);
});

test('F-2-12 S-14 a build dispatch kills the group, outcome refused', async () => {
  const t = setup(() => [buildCall], { gap: 600 });
  const sess = await start(t);
  const out = await sess.done;
  assert.equal(out.reason, 'refused');
  assert.equal(alive(Number(readFileSync(join(t.dir, 'sleep.pid'), 'utf8'))), false);
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!t.store.readEvents('j1').some((e) => e.late));
});

test('F-2-13 S-11 good init passes, every line is stored, turns classify only with no open task', async () => {
  const lines = (wt) => [
    init(wt), 'not json', JSON.stringify({ type: 'brand-new', x: 1 }),
    JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 'a' }),
    text('**1/1 Which?**\n- **(A) One**: x\n'), resultLine,
    JSON.stringify({ type: 'system', subtype: 'task_notification', task_id: 'a' }),
    text('**1/1 Which?**\n- **(A) One**: x\n'), resultLine,
  ];
  const u = setup(lines);
  const n = lines(u.worktree).length;
  const turns = [];
  const sess = await start(u, { onTurn: (x) => turns.push(x) });
  await until(() => turns.length > 0 && u.store.readEvents('j1').length >= n);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].class, 'question');
  const events = u.store.readEvents('j1');
  assert.equal(events.length, n);
  assert.deepEqual(events[1], { kind: 'malformed', raw: 'not json' });
  assert.equal(u.job.exoVersion, '0.136.0');
  assert.equal(sess.pid > 0, true);
  sess.stop();
  assert.equal((await sess.done).reason, 'stopped');
});

test('F-2-12 stop sends SIGTERM to the group and leaves no live process', async () => {
  const t = setup(() => []);
  const sess = await start(t);
  await until(() => existsSync(join(t.dir, 'sleep.pid')));
  const sleepPid = Number(readFileSync(join(t.dir, 'sleep.pid'), 'utf8'));
  assert.equal(alive(sleepPid), true);
  sess.stop();
  await sess.done;
  await until(() => !alive(sleepPid));
  assert.equal(alive(sleepPid), false);
});
