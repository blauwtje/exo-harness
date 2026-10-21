import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyTurn } from '../src/daemon/turns.mjs';

const read = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');

test('real probe turn 1 is one question with a recommendation', () => {
  const r = classifyTurn(read('probes/p9-turn1-last-text.txt'));
  assert.equal(r.class, 'question');
  assert.equal(r.questions.length, 1);
  const [q] = r.questions;
  assert.deepEqual([q.n, q.total, q.title], [1, 1, 'What should the greeting feature do?']);
  assert.deepEqual(q.options.map((o) => o.letter), ['A', 'B', 'C']);
  assert.equal(q.options[0].label, 'Function');
  assert.equal(q.options[0].text, '`greet(name)` returns "Hello, name!" for other code.');
  assert.equal(q.recommended, 'A');
});

test('two questions parse separately', () => {
  const r = classifyTurn(read('questions/two-questions.txt'));
  assert.equal(r.questions.length, 2);
  assert.deepEqual(r.questions.map((q) => [q.n, q.total, q.recommended, q.options.length]), [[1, 2, 'B', 2], [2, 2, 'A', 2]]);
});

test('1/3 prefix is kept', () => {
  const [q] = classifyTurn(read('questions/prefix-1-of-3.txt')).questions;
  assert.deepEqual([q.n, q.total], [1, 3]);
});

test('non-English text parses; only the English Recommended line counts', () => {
  const [q] = classifyTurn(read('questions/non-english.txt')).questions;
  assert.equal(q.title, 'Welke taal moet de begroeting hebben?');
  assert.equal(q.options[0].label, 'Nederlands');
  assert.equal(q.recommended, 'B');
});

test('no recommendation line gives null', () => {
  const r = classifyTurn(read('questions/no-recommendation.txt'));
  assert.equal(r.class, 'question');
  assert.equal(r.questions[0].recommended, null);
});

test('done and other', () => {
  assert.equal(classifyTurn(read('probes/p9-turn3-last-text.txt')).class, 'done');
  assert.equal(classifyTurn(read('probes/p9-turn2-last-text.txt')).class, 'other');
  assert.equal(classifyTurn('').class, 'other');
});
