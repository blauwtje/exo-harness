import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { approveRun, holderDone, resumeRun, startRun } from '../src/daemon/exo-run.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const scenarioEnv = (s) => ({ ...process.env, FAKE_EXO_SCENARIO: JSON.stringify(s) });
const cwdDir = () => mkdtempSync(join(tmpdir(), 'exo-run-'));

test('F-3-02 start spawns the Decision 7 argv and the child sees no CLAUDECODE', async () => {
  const root = cwdDir();
  const out = join(root, 'seen.json');
  const dir = join(root, 'skills/build/scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'exo-cli.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ANTHROPIC_API_KEY') }));
console.log('exo: run r-1 started in the background (pid 1)');`);
  const cwd = cwdDir();
  const res = await startRun({ pluginRoot: root, cwd, brief: '/b/plan.md', parentEnv: { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(res, { runId: 'r-1' });
  const seen = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(seen.argv.slice(0, 3), ['run', '/b/plan.md', '--detach']);
  assert.ok(seen.argv.includes('--detach') && seen.argv.includes('--max-run-usd') && seen.argv.includes('--max-budget-usd'));
  assert.equal(seen.env.length, 0);
});

test('F-3-05 S-07 lock and dirty refusals are classified with exo text; holderDone', async () => {
  const mk = async (refuse) => startRun({ pluginRoot: fakeRoot, cwd: cwdDir(), brief: 'plan.md', parentEnv: scenarioEnv({ refuse }) });
  assert.deepEqual(await mk('refused: another run holds the lock (.exo/run/lock)'), { refusal: 'lock', text: 'exo: refused: another run holds the lock (.exo/run/lock)' });
  assert.equal((await mk('refused: tracked working tree is dirty')).refusal, 'dirty');
  assert.equal((await mk('refused: branch is main')).refusal, 'other');
  assert.deepEqual(await startRun({ pluginRoot: fakeRoot, cwd: cwdDir(), brief: 'plan.md', parentEnv: scenarioEnv({ id: 'ok-1' }) }), { runId: 'ok-1' });
  assert.equal(holderDone({ phase: 'landed', pid: process.pid }), true);
  assert.equal(holderDone({ phase: 'build', pid: process.pid }), false);
  assert.equal(holderDone({ phase: 'build', pid: 2 ** 22 + 12345 }), true);
});

test('F-3-05 approve and resume call exo for a parked run', async () => {
  const cwd = cwdDir();
  const parentEnv = scenarioEnv({ id: 'p-1', phase: 'parked', gates: [{ source: 'a', action: 'b', reason: 'c' }], approve: { phase: 'landed' } });
  assert.deepEqual(await startRun({ pluginRoot: fakeRoot, cwd, brief: 'plan.md', parentEnv }), { runId: 'p-1' });
  assert.equal((await resumeRun({ pluginRoot: fakeRoot, cwd, runId: 'p-1', parentEnv })).ok, false);
  assert.equal((await approveRun({ pluginRoot: fakeRoot, cwd, runId: 'p-1', parentEnv })).ok, true);
});
