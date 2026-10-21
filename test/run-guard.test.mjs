import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readPlan, checkCollision, checkProvider, runCwd } from '../src/daemon/run-guard.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' });
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'rg-')));
const pluginRoot = resolve('test/fake-claude/plugin-root');

function repo() {
  const origin = tmp();
  git(origin, 'init', '--bare', '-b', 'main');
  const dir = tmp();
  git(dir, 'init', '-b', 'main');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'i');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', 'origin', 'main');
  return { dir, origin };
}

test('F-3-03 S-19 readPlan reads Branch and Land', async () => {
  const f = join(tmp(), 'b.md');
  writeFileSync(f, '# Plan\nBranch: feat/x\nLand: local\n');
  assert.deepEqual(await readPlan(f), { branch: 'feat/x', land: 'local' });
});

test('F-3-03 S-19 checkCollision finds local, origin and worktree collisions and none', async () => {
  const { dir, origin } = repo();
  assert.equal(await checkCollision(dir, 'fresh'), null);
  git(dir, 'branch', 'loc');
  assert.match(await checkCollision(dir, 'loc'), /local/);
  git(dir, 'branch', 'rem');
  git(dir, 'push', 'origin', 'rem');
  git(dir, 'branch', '-D', 'rem');
  git(dir, 'update-ref', '-d', 'refs/remotes/origin/rem');
  assert.match(await checkCollision(dir, 'rem'), /origin/);
  const wt = join(tmp(), 'w');
  git(dir, 'worktree', 'add', '-b', 'wtb', wt);
  git(dir, 'branch', '-m', 'wtb', 'wtb2');
  assert.ok(await checkCollision(dir, 'wtb2'));
  assert.equal(await checkCollision(dir, '$(touch pwned)'), null);
  void origin;
});

test('F-3-02 checkProvider accepts claude and refuses another provider', async () => {
  const cwd = tmp();
  assert.equal((await checkProvider(pluginRoot, cwd)).ok, true);
  process.env.FAKE_EXO_SCENARIO = '{"provider":"codex"}';
  try {
    const r = await checkProvider(pluginRoot, cwd);
    assert.equal(r.ok, false);
    assert.match(r.text, /codex/);
  } finally {
    delete process.env.FAKE_EXO_SCENARIO;
  }
});

test('F-3-13 runCwd uses the worktree, or the main checkout for the exo repo with Land: local', async () => {
  const wt = tmp();
  assert.deepEqual(await runCwd({ project: tmp(), pluginRoot, worktree: wt, plan: { land: 'none' } }), { cwd: wt });
  const link = join(tmp(), 'link');
  symlinkSync(pluginRoot, link);
  assert.deepEqual(await runCwd({ project: link, pluginRoot, worktree: wt, plan: { land: 'local' } }), { cwd: link });
  const r = await runCwd({ project: pluginRoot, pluginRoot, worktree: wt, plan: { land: 'none' } });
  assert.equal(r.refusal, 'land');
  assert.equal(r.cwd, undefined);
});
