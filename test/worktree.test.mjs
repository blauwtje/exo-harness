import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorktree, slugify } from '../src/daemon/worktree.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function makeRepo({ origin = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one');
  if (origin) {
    const bare = mkdtempSync(path.join(tmpdir(), 'wt-origin-'));
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'remote', 'set-head', 'origin', 'main');
  }
  return dir;
}

test('slug is limited to [a-z0-9-]', () => {
  assert.equal(slugify('Fix "Login"; $(rm -rf /) ../x!'), 'fix-login-rm-rf-x');
  assert.equal(slugify('日本語'), 'card');
  assert.match(slugify('a'.repeat(200)), /^a{1,50}$/);
});

test('local project: detached worktree at local default branch, excluded once', async () => {
  const repo = makeRepo();
  const wt = await createWorktree(repo, 'My Card');
  assert.equal(wt.path, path.join(repo, '.worktrees', 'my-card'));
  assert.equal(git(wt.path, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'main'));
  assert.equal(git(wt.path, 'branch', '--show-current'), '');
  await createWorktree(repo, 'Other');
  const ex = readFileSync(path.join(repo, '.git/info/exclude'), 'utf8').split('\n').filter((l) => l === '.worktrees/');
  assert.equal(ex.length, 1);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('origin project: base is origin/<default>', async () => {
  const repo = makeRepo({ origin: true });
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'local only');
  const wt = await createWorktree(repo, 'x');
  assert.equal(wt.base, 'origin/main');
  assert.equal(git(wt.path, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'origin/main'));
});

test('same title twice gets distinct directories; hostile title stays inside .worktrees', async () => {
  const repo = makeRepo();
  const a = await createWorktree(repo, 'Same');
  const b = await createWorktree(repo, 'Same');
  assert.notEqual(a.path, b.path);
  const c = await createWorktree(repo, '../../etc; touch pwned');
  assert.equal(path.dirname(c.path), path.join(repo, '.worktrees'));
  assert.ok(!existsSync(path.join(repo, 'pwned')));
});
