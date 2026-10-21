import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSetup } from '../src/daemon/setup.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function fixture(envSetting) {
  const main = mkdtempSync(path.join(tmpdir(), 'setup-main-'));
  const wt = mkdtempSync(path.join(tmpdir(), 'setup-wt-'));
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(main, '.gitignore'), '.env*\n!.env.tracked\n');
  writeFileSync(path.join(main, '.env'), 'TOKEN=s3cr3t-value\n');
  writeFileSync(path.join(main, '.env.tracked'), 'A=tracked-value\n');
  if (envSetting) {
    mkdirSync(path.join(main, '.claude'));
    writeFileSync(path.join(main, '.claude', 'exo.json'), JSON.stringify({ env: envSetting }));
  }
  return { main, wt };
}

test('F-3-04 S-18 env copy copies git-ignored .env files, never overwrites, never tails the values', async () => {
  const { main, wt } = fixture('copy');
  writeFileSync(path.join(main, '.env.local'), 'X=keep-main\n');
  writeFileSync(path.join(wt, '.env.local'), 'X=worktree\n');
  const r = await runSetup({ setup: 'node -e console.log(process.argv[1])' }, wt, main);
  assert.equal(readFileSync(path.join(wt, '.env'), 'utf8'), 'TOKEN=s3cr3t-value\n');
  assert.equal(readFileSync(path.join(wt, '.env.local'), 'utf8'), 'X=worktree\n');
  assert.equal(existsSync(path.join(wt, '.env.tracked')), false);
  const leak = await runSetup({ setup: 'node -e throw(new Error("s3cr3t-value"))' }, wt, main);
  assert.equal(leak.ok, false);
  assert.ok(!leak.tail.includes('s3cr3t-value'));
  assert.ok(r.ok);
});

test('F-3-04 S-18 env ask or other values copy nothing', async () => {
  for (const setting of [undefined, 'ask', 'yes']) {
    const { main, wt } = fixture(setting);
    await runSetup({}, wt, main);
    assert.equal(existsSync(path.join(wt, '.env')), false);
  }
});

test('F-3-04 S-18 failing setup reports ok false with the tail; no lockfile skips', async () => {
  const { main, wt } = fixture();
  assert.deepEqual(await runSetup({}, wt, main), { ok: true, command: null, tail: '' });
  const r = await runSetup({ setup: 'node -e console.error("boom");process.exit(3)' }, wt, main);
  assert.equal(r.ok, false);
  assert.match(r.tail, /boom/);
});

test('F-3-04 S-18 setup runs as argv without a shell and with the exo-run env', async () => {
  const { main, wt } = fixture();
  process.env.CLAUDE_CODE_TESTVAR = 'x';
  writeFileSync(path.join(wt, 'e.mjs'), 'console.log(process.env.CLAUDE_CODE_TESTVAR ?? "scrubbed")');
  const r = await runSetup({ setup: 'node e.mjs ; touch pwned' }, wt, main);
  delete process.env.CLAUDE_CODE_TESTVAR;
  assert.match(r.tail, /scrubbed/);
  assert.equal(existsSync(path.join(wt, 'pwned')), false);
});
