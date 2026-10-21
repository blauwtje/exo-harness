import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OUTCOMES, classifyOutcome, captureLimitStream, failureInbox, isLimitStream, runOutcome, runSummary } from '../src/daemon/outcomes.mjs';
import { createStore } from '../src/daemon/store.mjs';

const result = (extra) => ({ type: 'result', is_error: false, subtype: 'success', ...extra });
const rate = (status) => ({ type: 'rate_limit_event', rate_limit_info: { status } });

test('enum lists the ten outcomes', () => {
  assert.deepEqual(OUTCOMES, ['done', 'question', 'max_turns', 'budget', 'limit', 'auth', 'crashed', 'refused', 'invariant', 'setup']);
});

test('classifies from the stream', () => {
  assert.equal(classifyOutcome({}, [rate('allowed'), result()]), 'done');
  assert.equal(classifyOutcome({}, [result({ is_error: true, subtype: 'error_max_budget_usd' })]), 'budget');
  assert.equal(classifyOutcome({}, [result({ is_error: true, subtype: 'error_max_turns' })]), 'max_turns');
  assert.equal(classifyOutcome({}, [rate('rejected'), result({ is_error: true })]), 'limit');
  assert.equal(classifyOutcome({ status: 'crashed' }, []), 'crashed');
  assert.equal(classifyOutcome({ outcome: 'auth' }, [result()]), 'auth');
  assert.equal(classifyOutcome({ status: 'waiting' }, []), 'question');
});

test('limit detection', () => {
  assert.equal(isLimitStream([rate('allowed')]), false);
  assert.equal(isLimitStream([rate('allowed_warning')]), true);
  assert.equal(isLimitStream([{ type: 'assistant', api_error: 'usage_limit_reached' }]), true);
  assert.equal(isLimitStream([{ type: 'result', api_error_status: 429 }]), true);
});

test('inbox lists non-done jobs with their last 20 events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outcomes-'));
  const store = createStore(dir);
  for (let i = 0; i < 30; i++) store.appendEvent('bad', { type: 'x', i });
  store.appendEvent('bad', result({ is_error: true, subtype: 'error_max_turns' }));
  store.appendEvent('ok', result());
  const items = failureInbox({ jobs: [{ id: 'bad', cardId: 'c' }, { id: 'ok', cardId: 'c' }] }, store);
  assert.equal(items.length, 1);
  assert.equal(items[0].outcome, 'max_turns');
  assert.equal(items[0].events.length, 20);
  assert.equal(items[0].events.at(-1).subtype, 'error_max_turns');
});

test('limit stream is copied to EXO_HARNESS_INBOX, clean stream is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-'));
  const env = { EXO_HARNESS_INBOX: dir };
  assert.equal(captureLimitStream('j1', [rate('allowed')], env), null);
  const events = [rate('rejected'), { type: 'assistant', api_error_status: 429 }];
  const file = captureLimitStream('j1', events, env);
  assert.deepEqual(readdirSync(dir), ['j1.jsonl']);
  assert.deepEqual(readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), events);
});

test('F-3-14 S-05 run outcomes follow the phase and reason', () => {
  assert.equal(runOutcome({ phase: 'parked' }), 'question');
  assert.equal(runOutcome({ phase: 'stopped', reason: 'budget: spent $5' }), 'budget');
  assert.equal(runOutcome({ phase: 'stopped', reason: 'hit --max-turns' }), 'max_turns');
  assert.equal(runOutcome({ phase: 'stopped', reason: 'other' }), 'crashed');
  assert.equal(runOutcome({ phase: 'refused' }), 'refused');
  assert.equal(runOutcome({ phase: 'crashed' }), 'crashed');
  assert.equal(runOutcome({ phase: 'landed' }), null);
  assert.equal(runOutcome({ phase: 'passed' }), null);
});

test('F-3-14 S-05 inbox lists run jobs, not landed ones', () => {
  const store = createStore(mkdtempSync(join(tmpdir(), 'outcomes-')));
  store.appendEvent('r2', result());
  const jobs = [
    { id: 'r1', cardId: 'c', run: { phase: 'parked' } },
    { id: 'r2', cardId: 'c', run: { phase: 'landed' } },
    { id: 'r3', cardId: 'c', outcome: 'setup', run: { phase: 'queued' } },
    { id: 'r4', cardId: 'c', run: { phase: 'running' } },
  ];
  assert.deepEqual(failureInbox({ jobs }, store).map((i) => [i.jobId, i.outcome]), [['r1', 'question'], ['r3', 'setup']]);
});

test('F-3-14 S-05 summary is the report head plus the last assistant text', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const asst = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  const out = runSummary(lines, [asst('first'), asst('last words'), { type: 'user' }]);
  assert.equal(out, `${lines.split('\n').slice(0, 20).join('\n')}\n\nlast words`);
  assert.equal(runSummary('', []), '');
});
