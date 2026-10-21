import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dirname, 'fake-claude/plugin-root/skills/build/scripts/exo-cli.mjs');
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fake-exo-')));
const exo = (cwd, scenario, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FAKE_EXO_SCENARIO: JSON.stringify(scenario) } });
const state = (cwd, id, where = 'run') => JSON.parse(readFileSync(join(cwd, '.exo', where, id, 'state.json'), 'utf8'));

test('F-3-05 run --detach prints the detach line and writes state, report, gates, denied and iter logs', () => {
  const cwd = tmp();
  const iters = { 'iter-1-task-1.log': [{ type: 'system', subtype: 'init' }] };
  const gates = [{ source: 'task 1', action: 'git push', reason: 'needs approval' }];
  const out = exo(cwd, { id: 'r1', phase: 'parked', reason: 'gate', gates, denied: 'Bash(rm)\n', iters, task: { n: 1, subject: 's' }, landed: 0, total: 2 }, 'run', 'brief.md', '--detach', '--max-run-usd', '5');
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^exo: run r1 started in the background \(pid \d+\); exo status r1, log /);
  const s = state(cwd, 'r1');
  assert.equal(s.phase, 'parked');
  assert.equal(s.total, 2);
  const dir = join(cwd, '.exo', 'run', 'r1');
  assert.equal(readFileSync(join(dir, 'gates.md'), 'utf8'), '- open: task 1: git push (needs approval)\n');
  assert.equal(readFileSync(join(dir, 'denied.txt'), 'utf8'), 'Bash(rm)\n');
  assert.ok(existsSync(join(dir, 'report.md')));
  const [stamp] = readdirSync(join(cwd, '.exo', 'run-plan', 'brief'));
  assert.ok(existsSync(join(cwd, '.exo', 'run-plan', 'brief', stamp, 'iter-1-task-1.log')));
});

test('F-3-05 a refusal prints the text on stderr and exits 2', () => {
  const cwd = tmp();
  const text = 'refused: run x is still running in this checkout; exo status shows it';
  const out = exo(cwd, { refuse: text }, 'run', 'brief.md', '--detach');
  assert.equal(out.status, 2);
  assert.equal(out.stderr, `exo: ${text}\n`);
  assert.equal(existsSync(join(cwd, '.exo')), false);
});

test('F-3-07 approve resumes a parked run to its approve phase and rejects a non-parked one', () => {
  const cwd = tmp();
  const scenario = { id: 'r2', phase: 'parked', gates: [{ source: 's', action: 'a', reason: 'r' }], approve: { phase: 'landed', landed: 1, total: 1 } };
  exo(cwd, scenario, 'run', 'brief.md', '--detach');
  assert.equal(exo(cwd, scenario, 'run', '--resume', 'r2').status, 2);
  assert.equal(exo(cwd, scenario, 'approve', 'r2').status, 0);
  assert.equal(state(cwd, 'r2').phase, 'landed');
  assert.equal(readFileSync(join(cwd, '.exo', 'run', 'r2', 'gates.md'), 'utf8'), '');
  assert.match(exo(cwd, scenario, 'approve', 'r2').stderr, /is landed, not parked/);
});

test('F-3-07 run --resume continues a stopped run and a kept run is found in .exo/kept', () => {
  const cwd = tmp();
  const scenario = { id: 'r3', phase: 'stopped', reason: 'budget: x', kept: true, resume: { phase: 'passed' } };
  exo(cwd, scenario, 'run', 'brief.md', '--detach');
  assert.equal(state(cwd, 'r3', 'kept').phase, 'stopped');
  assert.equal(exo(cwd, scenario, 'run', '--resume', 'r3').status, 0);
  assert.equal(state(cwd, 'r3', existsSync(join(cwd, '.exo', 'kept', 'r3')) ? 'kept' : 'run').phase, 'passed');
});

test('run config prints the provider', () => {
  assert.equal(exo(tmp(), {}, 'run', 'config').stdout, 'defaults.provider = "claude" (catalog)\n');
  assert.match(exo(tmp(), { provider: 'x' }, 'run', 'config').stdout, /"x"/);
});

test('remove-worktree --kept copies .exo and removes the worktree', () => {
  const dir = tmp();
  const git = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'i');
  const wt = join(dir, 'wt');
  git('worktree', 'add', '-q', '-b', 'b', wt);
  mkdirSync(join(wt, '.exo'));
  writeFileSync(join(wt, '.exo', 'x.txt'), 'x');
  const script = resolve(import.meta.dirname, 'fake-claude/plugin-root/skills/build/scripts/remove-worktree.mjs');
  const out = spawnSync(process.execPath, [script, '--worktree', wt, '--run', dir, '--kept'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.ok(existsSync(join(dir, '.exo', 'kept', 'wt', 'x.txt')));
  assert.equal(existsSync(wt), false);
});
