import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/daemon/permissions.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/probes/${name}.jsonl`, import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.type === 'control_request' && e.request?.subtype === 'can_use_tool');

const wt = realpathSync(mkdtempSync(join(tmpdir(), 'perm-')));
mkdirSync(join(wt, 'docs', 'specs'), { recursive: true });
const outside = realpathSync(mkdtempSync(join(tmpdir(), 'perm-out-')));
symlinkSync(outside, join(wt, 'docs', 'link'));
symlinkSync(outside, join(wt, 'escape'));
const run = (tool_name, input, extra = {}) => decide({ tool_name, input, ...extra }, 'spec', wt);
const bash = (command, extra) => run('Bash', { command }, extra);

test('F-2-11 S-security p6 Write outside docs is denied with a message', () => {
  const [w] = fixture('p6-allowedtools').filter((e) => e.request.tool_name === 'Write');
  const d = decide(w, 'spec', wt);
  assert.equal(d.behavior, 'deny');
  assert.match(d.message, /docs\//);
});

test('F-2-11 S-security p6b blocked_path Bash is allowed, a read-only compound is a card', () => {
  const reqs = fixture('p6b-allowedtools-contrast');
  const blocked = reqs.find((e) => e.request.blocked_path);
  assert.equal(decide(blocked, 'spec', wt).behavior, 'allow');
  assert.equal(bash('date').behavior, 'ask');
});

test('F-2-11 S-security p9 Write and Edit: allowed in their own worktree docs, denied in another', () => {
  const reqs = fixture('p9-spec').filter((e) => ['Write', 'Edit'].includes(e.request.tool_name));
  assert.ok(reqs.length >= 2);
  for (const e of reqs) {
    assert.equal(decide(e, 'spec', '/private/tmp/exo-harness-probe-9').behavior, 'allow');
    assert.equal(decide(e, 'spec', wt).behavior, 'deny');
  }
});

test('F-2-11 S-security Write and Edit under worktree docs are allowed', () => {
  assert.equal(run('Write', { file_path: join(wt, 'docs/specs/a.md') }).behavior, 'allow');
  assert.equal(run('Edit', { file_path: 'docs/specs/a.md' }).behavior, 'allow');
});

test('F-2-11 S-security path escapes are denied: .., absolute, symlink, sibling prefix', () => {
  for (const file_path of [
    'docs/../src/x.mjs', '../x.md', '/etc/passwd', join(wt, 'docs/link/x.md'), 'docs/link/new/x.md',
    join(wt, 'escape/docs/x.md'), `${wt}-evil/docs/x.md`, 'docs', '', undefined,
  ]) assert.equal(run('Write', { file_path }).behavior, 'deny', String(file_path));
});

test('F-2-11 S-security deny list wins, also inside compound commands', () => {
  for (const c of [
    'git push origin main', 'git commit -m x', 'gh pr create', 'gh', 'ls && git push',
    'echo a; git commit -m x', 'cat x | gh api y', '$(gh auth token)', 'FOO=1 git push', 'git status\ngit reset --hard',
  ]) assert.equal(bash(c).behavior, 'deny', c);
  assert.equal(bash('git push', { blocked_path: '/tmp' }).behavior, 'deny');
});

test('F-2-11 S-security question, blocked_path and other tools', () => {
  assert.deepEqual(run('AskUserQuestion', { questions: [] }), { behavior: 'ask', card: 'question' });
  assert.equal(bash('ls /tmp', { blocked_path: '/private/tmp' }).behavior, 'allow');
  assert.deepEqual(bash('npm test'), { behavior: 'ask', card: 'needs-you' });
  assert.equal(run('WebFetch', { url: 'https://x' }).behavior, 'ask');
});
