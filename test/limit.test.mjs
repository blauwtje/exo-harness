import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectLimit, createLimitTimer } from '../src/daemon/limit.mjs';
import { createQueue } from '../src/daemon/queue.mjs';
import { createStore } from '../src/daemon/store.mjs';

const bin = resolve(import.meta.dirname, 'fake-claude/bin/claude');
const fake = (limit, input = '') => {
  const out = spawnSync(bin, ['-p'], { input, encoding: 'utf8', env: { ...process.env, FAKE_CLAUDE_LIMIT: JSON.stringify(limit) } });
  return JSON.parse(out.stdout.trim().split('\n').pop());
};
const mk = () => ({ projects: [], jobs: [], cards: [] });
function clock() {
  const c = { t: 0, timers: [] };
  c.now = () => c.t;
  c.setTimer = (fn, ms) => c.timers.push({ fn, at: c.t + ms });
  c.advance = (to) => { c.t = to; c.timers.filter((x) => x.at <= to && !x.done).forEach((x) => { x.done = true; x.fn(); }); };
  return c;
}

test('F-4-08 detects a rejected rate_limit_event from the fake claude', () => {
  const event = fake({ type: 'rejected', resetsAt: 100, rateLimitType: 'seven_day_opus' });
  assert.deepEqual(detectLimit(event), { rateLimitType: 'seven_day_opus', resetsAt: 100 });
});

test('F-4-08 detects the usage_limit_reached message from the fake claude', () => {
  const event = fake({ type: 'usage_limit_reached', resetsAt: 200, afterTurns: 1 }, '{"type":"user"}\n');
  assert.deepEqual(detectLimit(event), { rateLimitType: 'five_hour', resetsAt: 200 });
});

test('F-4-08 ignores events that are not a limit', () => {
  assert.equal(detectLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), null);
  assert.equal(detectLimit({ type: 'assistant', message: {} }), null);
  assert.equal(detectLimit(null), null);
});

test('S-03 a limit hit pauses the queue and resumes after resetsAt plus jitter', () => {
  const c = clock();
  const q = createQueue(mk());
  const timer = createLimitTimer({ queue: q, now: c.now, setTimer: c.setTimer, jitterMs: () => 5000 });
  timer.hit({ rateLimitType: 'five_hour', resetsAt: 100 });
  assert.deepEqual(q.snapshot().paused, { reason: 'limit', rateLimitType: 'five_hour', resetsAt: 100 });
  c.advance(104999);
  assert.equal(q.snapshot().paused.reason, 'limit');
  c.advance(105000);
  assert.equal(q.snapshot().paused, null);
});

test('S-03 a restart reads the pause back and resumes at the reset', () => {
  const c = clock();
  const state = mk();
  createLimitTimer({ queue: createQueue(state), now: c.now, setTimer: c.setTimer, jitterMs: () => 0 }).hit({ rateLimitType: 'five_hour', resetsAt: 50 });
  const store = createStore(mkdtempSync(join(tmpdir(), 'exo-limit-')));
  store.save(state);
  const c2 = clock();
  c2.t = 10000;
  const q = createQueue(store.load());
  assert.equal(q.snapshot().paused.resetsAt, 50);
  createLimitTimer({ queue: q, now: c2.now, setTimer: c2.setTimer, jitterMs: () => 0 }).restore();
  c2.advance(50000);
  assert.equal(q.snapshot().paused, null);
});

test('S-03 a reset already past resumes at once', () => {
  const c = clock();
  c.t = 999000;
  const q = createQueue(mk());
  q.pause({ reason: 'limit', resetsAt: 5 });
  createLimitTimer({ queue: q, now: c.now, setTimer: c.setTimer, jitterMs: () => 0 }).restore();
  c.advance(c.t);
  assert.equal(q.snapshot().paused, null);
});

test('S-03 a second hit replaces the first timer', () => {
  const c = clock();
  const q = createQueue(mk());
  const timer = createLimitTimer({ queue: q, now: c.now, setTimer: c.setTimer, jitterMs: () => 0 });
  timer.hit({ resetsAt: 10 });
  timer.hit({ resetsAt: 100 });
  c.advance(10000);
  assert.equal(q.snapshot().paused.resetsAt, 100);
  c.advance(100000);
  assert.equal(q.snapshot().paused, null);
});

test('F-4-08 detects the real refused-call record, error rate_limit with the window in apiErrorParams', () => {
  const info = { status: 'rejected', resetsAt: 1792577400, rateLimitType: 'five_hour', overageStatus: 'rejected', isUsingOverage: false };
  const event = {
    type: 'assistant', error: 'rate_limit', apiErrorStatus: 429, isApiErrorMessage: true, apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: info }, quotaLimits: info,
    message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 12:10pm (Europe/Amsterdam)" }] },
  };
  assert.deepEqual(detectLimit(event), { rateLimitType: 'five_hour', resetsAt: 1792577400 });
  assert.deepEqual(detectLimit({ type: 'assistant', api_error: 'usage_limit_reached', api_error_params: { rate_limit_info: info } }), { rateLimitType: 'five_hour', resetsAt: 1792577400 });
  assert.deepEqual(detectLimit({ type: 'assistant', error: 'rate_limit', message: {} }), { rateLimitType: null, resetsAt: null });
});
