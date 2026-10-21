import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRateLimitEvent, parseResultUsage } from '../src/daemon/usage.mjs';

const lines = (f) => readFileSync(new URL(`./fixtures/probes/${f}`, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('rate_limit_event from a real probe', () => {
  const ev = lines('p3a-spec.jsonl').find((e) => e.type === 'rate_limit_event');
  const u = parseRateLimitEvent(ev);
  assert.equal(u.status, 'allowed');
  assert.equal(u.rateLimitType, 'five_hour');
  assert.deepEqual(Object.keys(u.windows), ['five_hour', 'seven_day']);
  assert.equal(typeof u.windows.five_hour.utilization, 'number');
  assert.equal(u.windows.five_hour.resetsAt, 1792533000);
  assert.deepEqual(u.overage, { status: 'rejected', isUsingOverage: false, disabledReason: 'org_level_disabled' });
});

test('rate_limit_event without optional fields', () => {
  const u = parseRateLimitEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
  assert.deepEqual(u.windows, {});
  assert.deepEqual(u.overage, { status: null, isUsingOverage: false, disabledReason: null });
});

test('non-rate-limit input returns null', () => {
  assert.equal(parseRateLimitEvent({ type: 'result' }), null);
  assert.equal(parseRateLimitEvent(null), null);
  assert.equal(parseResultUsage({ type: 'assistant' }), null);
});

test('result cache tokens from a real probe', () => {
  const ev = lines('p3a-spec.jsonl').find((e) => e.type === 'result');
  assert.deepEqual(parseResultUsage(ev), { cacheRead: ev.usage.cache_read_input_tokens, cacheCreation1h: ev.usage.cache_creation.ephemeral_1h_input_tokens, cacheCreation5m: ev.usage.cache_creation.ephemeral_5m_input_tokens });
});

test('result without cache fields gives zeros', () => {
  assert.deepEqual(parseResultUsage({ type: 'result', usage: {} }), { cacheRead: 0, cacheCreation1h: 0, cacheCreation5m: 0 });
});
