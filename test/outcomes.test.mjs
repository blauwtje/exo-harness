import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OUTCOMES, classifyOutcome, captureLimitStream, failureInbox, isLimitStream } from '../src/daemon/outcomes.mjs';
import { createStore } from '../src/daemon/store.mjs';

const result = (extra) => ({ type: 'result', is_error: false, subtype: 'success', ...extra });
const rate = (status) => ({ type: 'rate_limit_event', rate_limit_info: { status } });

test('enum lists the nine outcomes', () => {
  assert.deepEqual(OUTCOMES, ['done', 'question', 'max_turns', 'budget', 'limit', 'auth', 'crashed', 'refused', 'invariant']);
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
