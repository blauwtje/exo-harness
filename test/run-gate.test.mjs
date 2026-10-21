import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateDetails, fileDiff, finishLand } from '../src/daemon/run-gate.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'pipe' }).toString();
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'rgt-')));
const commit = (dir, file, ...[body, msg]) => { writeFileSync(join(dir, file), body); git(dir, 'add', '.'); git(dir, 'commit', '-m', msg); };

function repo() {
  const dir = tmp();
  git(dir, 'init', '-b', 'main');
  commit(dir, 'a.txt', 'one\n', 'init');
  git(dir, 'checkout', '-b', 'feat');
  commit(dir, 'a.txt', 'two\n', 'feat');
  git(dir, 'checkout', 'main');
  return dir;
}

test('F-3-07 gateDetails reads gates, stat, files, report head and denied; fileDiff is allowlisted', async () => {
  const dir = repo();
  const runDir = tmp();
  writeFileSync(join(runDir, 'gates.md'), 'gate one\ngate two\n');
  writeFileSync(join(runDir, 'report.md'), Array.from({ length: 20 }, (_, i) => `r${i}`).join('\n'));
  writeFileSync(join(runDir, 'denied.txt'), 'rm -rf\n');
  const d = await gateDetails(runDir, dir, 'main', 'feat');
  assert.deepEqual(d.gates, ['gate one', 'gate two']);
  assert.match(d.diffStat, /a\.txt/);
  assert.deepEqual(d.files, ['a.txt']);
  assert.equal(d.reportHead.split('\n').length, 15);
  assert.equal(d.denied, 'rm -rf\n');
  assert.deepEqual(d.conflicts, []);
  assert.match(await fileDiff(dir, 'main', 'feat', 'a.txt'), /\+two/);
  for (const bad of ['../a.txt', '/etc/passwd', 'b.txt', '', '-p']) {
    await assert.rejects(fileDiff(dir, 'main', 'feat', bad), /not in the branch diff/);
  }
});

test('F-3-11 S-06 gateDetails lists conflicting files and touches no worktree', async () => {
  const dir = repo();
  commit(dir, 'a.txt', 'three\n', 'main change');
  const before = git(dir, 'status', '--porcelain');
  const d = await gateDetails(tmp(), dir, 'main', 'feat');
  assert.deepEqual(d.conflicts, ['a.txt']);
  assert.equal(git(dir, 'status', '--porcelain'), before);
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
});

test('F-3-12 finishLand fast-forwards a clean checkout and refuses a dirty or off-base one', async () => {
  const dir = repo();
  git(dir, 'checkout', 'feat');
  const off = await finishLand(dir, 'main', 'feat');
  assert.equal(off.ok, false);
  assert.match(off.action, /switch it to main/);
  git(dir, 'checkout', 'main');
  writeFileSync(join(dir, 'a.txt'), 'dirty\n');
  const dirty = await finishLand(dir, 'main', 'feat');
  assert.equal(dirty.ok, false);
  assert.equal(git(dir, 'show', 'HEAD:a.txt'), 'one\n');
  git(dir, 'checkout', '--', 'a.txt');
  const old = git(dir, 'rev-parse', 'HEAD').trim();
  const ok = await finishLand(dir, 'main', 'feat');
  assert.equal(ok.ok, true);
  assert.equal(ok.range, `${old}..${git(dir, 'rev-parse', 'HEAD').trim()}`);
  assert.equal(git(dir, 'show', 'HEAD:a.txt'), 'two\n');
});
