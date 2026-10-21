import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalDir, gradeCase, gradeFixtures, gradeRun, loadCases, wrapperHash } from '../scripts/eval-wrappers.mjs';

const script = join(import.meta.dirname, '..', 'scripts', 'eval-wrappers.mjs');
const asst = (content) => ({ type: 'assistant', message: { content } });
const dispatch = asst([{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'exo:build' } }]);
const reached = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'started' }] } };
const handoff = [asst([{ type: 'text', text: 'Brief: docs/specs/x.md' }]), { type: 'result' }];
const [, , handoffCase] = loadCases().cases;

test('F-2-24 wrapper hash matches the stored fixtures (Decision 22)', () => {
  const manifest = JSON.parse(readFileSync(join(evalDir, 'fixtures', 'manifest.json'), 'utf8'));
  assert.equal(manifest.wrapper.sha256, wrapperHash(),
    'wrapper changed: rerun `eval-wrappers --live` and re-record');
});

test('F-2-24 grader test: stored fixtures pass every case', () => {
  for (const r of gradeFixtures()) assert.equal(r.pass, true, r.id);
});

test('F-2-24 grader test: attempted dispatch fails prompt but not guard; a tool result fails guard', () => {
  assert.deepEqual(gradeRun(handoffCase, [...handoff, dispatch]), { turn: true, guard: true, prompt: false });
  assert.equal(gradeRun(handoffCase, [...handoff, dispatch, reached]).guard, false);
});

test('F-2-24 grader test: hand-off needs 3 of 3 on guard, other cases 2 of 3', () => {
  const [vague] = loadCases().cases;
  const ok = { turn: true, guard: true, prompt: true };
  assert.equal(gradeCase(handoffCase, [ok, ok, { ...ok, guard: false }]).pass, false);
  assert.equal(gradeCase(handoffCase, [ok, ok, { ...ok, prompt: false }]).pass, true);
  assert.equal(gradeCase(vague, [ok, ok, { ...ok, turn: false }]).pass, true);
  assert.equal(gradeCase(vague, [ok, { ...ok, turn: false }, { ...ok, turn: false }]).pass, false);
});

test('F-2-24 --live refuses under CLAUDECODE', () => {
  const r = spawnSync(process.execPath, [script, '--live'], { env: { ...process.env, CLAUDECODE: '1' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing live mode under CLAUDECODE/);
});
