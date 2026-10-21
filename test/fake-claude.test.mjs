import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, 'fake-claude');
const bin = join(root, 'bin/claude');
const user = '{"type":"user","message":{"role":"user","content":"hi"}}\n';
const reply = '{"type":"control_response","response":{"subtype":"success"}}\n';

function scenario(dir, steps) {
  const file = join(dir, 'scenario.json');
  writeFileSync(file, JSON.stringify({ steps }));
  return file;
}

function run(dir, steps, input) {
  const child = spawn(bin, ['-p'], {
    cwd: dir,
    env: { ...process.env, FAKE_CLAUDE_SCENARIO: scenario(dir, steps) },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.end(input);
  return new Promise((done) => child.on('close', (code) => done({ code, out })));
}

test('answers auth status --json from the fixture', () => {
  const out = JSON.parse(execFileSync(bin, ['auth', 'status', '--json']));
  assert.equal(out.loggedIn, true);
});

test('replays fixture lines, awaits stdin, writes a file, exits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const { code, out } = await run(
    dir,
    [
      { emit: 'p4c-askuser-allow.jsonl', to: 2 },
      { await: 'user' },
      { emit: 'p4c-askuser-allow.jsonl', from: 2, to: 3 },
      { await: 'control_response' },
      { write: { path: 'out/brief.md', content: 'done' } },
      { exit: 3 },
    ],
    user + reply,
  );
  assert.equal(code, 3);
  assert.equal(out.split('\n').filter(Boolean).length, 3);
  assert.equal(readFileSync(join(dir, 'out/brief.md'), 'utf8'), 'done');
});

test('fails when stdin closes before the awaited message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const { code } = await run(dir, [{ await: 'control_response' }], user);
  assert.equal(code, 1);
});

test('starts a child sleep that outlives the exit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const pidFile = join(dir, 'pid.txt');
  const { code } = await run(dir, [{ spawn: { seconds: 30, pidFile } }, { exit: 0 }], '');
  assert.equal(code, 0);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  process.kill(pid, 0);
  process.kill(pid);
});

test('ships a fake exo plugin root', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'plugin-root/.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'exo');
  assert.ok(existsSync(join(root, 'plugin-root/skills/spec/SKILL.md')));
});
