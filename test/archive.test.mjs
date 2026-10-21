import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveRun, archiveDir, removeWorktree } from '../src/daemon/archive.mjs';

const pluginRoot = join(import.meta.dirname, 'fake-claude', 'plugin-root');

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'archive-'));
  const checkout = join(tmp, 'repo');
  mkdirSync(checkout);
  const git = (...a) => execFileSync('git', ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  const worktree = join(tmp, 'wt');
  git('worktree', 'add', '-q', '--detach', worktree);
  const runDir = join(worktree, '.exo', 'run', 'r1');
  const planDir = join(worktree, '.exo', 'run-plan', 'p', 't');
  mkdirSync(runDir, { recursive: true });
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(runDir, 'report.md'), 'the report');
  writeFileSync(join(planDir, 'iter-1.log'), 'log');
  return { tmp, checkout, worktree, runDir, planDir, data: join(tmp, 'data') };
}

test('F-3-09 archiveRun copies run evidence under jobs/<id>/run', async () => {
  const s = setup();
  const dest = await archiveRun(s.data, 'j1', { runDir: s.runDir, runPlanDir: s.planDir });
  assert.equal(dest, archiveDir(s.data, 'j1'));
  assert.equal(readFileSync(join(dest, 'state', 'report.md'), 'utf8'), 'the report');
  assert.equal(readFileSync(join(dest, 'run-plan', 'iter-1.log'), 'utf8'), 'log');
});

test('F-3-09 removeWorktree refuses until the archive exists', async () => {
  const s = setup();
  await assert.rejects(removeWorktree(pluginRoot, s.worktree, { checkout: s.checkout, archived: archiveDir(s.data, 'j1') }), /not archived/);
  await assert.rejects(removeWorktree(pluginRoot, s.worktree, { checkout: s.checkout }), /not archived/);
  assert.ok(existsSync(s.worktree));
});

test('F-3-09 removeWorktree removes through --kept once archived', async () => {
  const s = setup();
  const dest = await archiveRun(s.data, 'j1', { runDir: s.runDir, runPlanDir: s.planDir });
  await removeWorktree(pluginRoot, s.worktree, { checkout: s.checkout, archived: dest });
  assert.ok(!existsSync(s.worktree));
  assert.ok(existsSync(join(s.checkout, '.exo', 'kept', 'wt', 'run', 'r1', 'report.md')));
});
