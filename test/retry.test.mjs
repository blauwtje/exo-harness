import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { classifyEnd, failingLine, nextRetry, bugCardOf, runStopCard } from '../src/daemon/retry.mjs';

const fake = resolve('test/fake-claude/bin/claude');
const run = (kind) => spawnSync(process.execPath, [fake], { env: { ...process.env, FAKE_CLAUDE_FAIL: kind }, encoding: 'utf8' })
  .stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('F-4-10 a stream with no result is infra, an overloaded_error is infra', () => {
  assert.equal(classifyEnd({}, run('noresult')), 'infra');
  assert.equal(classifyEnd({}, run('overloaded')), 'infra');
});

test('F-4-10 limit hits, model errors and denials are never infra', () => {
  const limit = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1 } };
  assert.equal(classifyEnd({}, [limit]), 'limit');
  assert.equal(classifyEnd({}, [{ type: 'result', is_error: true }]), 'model-error');
  assert.equal(classifyEnd({}, [{ type: 'result', is_error: false, permission_denials: [{}] }]), 'model-error');
  assert.equal(classifyEnd({}, [{ type: 'result', is_error: false }]), null);
});

test('F-4-10 retries twice with 2 s then 10 s waits, then stops', () => {
  const a = 'a', b = 'b', c = 'c';
  assert.deepEqual(nextRetry({ failures: [a] }), { retry: true, waitMs: 2000 });
  assert.deepEqual(nextRetry({ failures: [a, b] }), { retry: true, waitMs: 10000 });
  assert.deepEqual(nextRetry({ failures: [a, b, c] }), { retry: false, bugCard: true });
  assert.deepEqual(nextRetry({ failures: [a], retryWaitsMs: [5] }), { retry: true, waitMs: 5 });
});

test('S-09 the same failing line twice is a loop and a bug card with that line', () => {
  const events = run('overloaded');
  const line = failingLine(events);
  const job = { id: 'j1', failures: [line] };
  assert.equal(classifyEnd(job, events), 'loop');
  job.failures.push(line);
  assert.equal(nextRetry(job).bugCard, true);
  assert.equal(bugCardOf(job).line, line);
});

test('S-09 an exo run no-progress stop shows its Reason', () => {
  const card = runStopCard('# Report\nStatus: stopped\nReason: no progress after 3 attempts\n');
  assert.equal(card.reason, 'no progress after 3 attempts');
  assert.equal(runStopCard('Reason: done'), null);
});

test('F-4-10 an overloaded_error that ends in an is_error result is infra, not a model error', () => {
  const overloaded = { type: 'assistant', error: 'api_error', message: { content: [{ type: 'text', text: 'overloaded_error' }] } };
  assert.equal(classifyEnd({}, [overloaded, { type: 'result', is_error: true }]), 'infra');
  assert.equal(classifyEnd({}, [{ type: 'result', is_error: true }]), 'model-error');
});
