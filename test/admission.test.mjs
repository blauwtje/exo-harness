import test from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../src/daemon/admission.mjs';
import { createQueue } from '../src/daemon/queue.mjs';
import { DEFAULTS } from '../src/daemon/settings.mjs';
import { seedP75 } from '../src/daemon/stages.mjs';

const settings = structuredClone(DEFAULTS);
const CASES = [
  { stage: 'build', windows: [['five_hour', 0.8], ['seven_day', 0.7], ['seven_day_sonnet', 0.7]] },
  { stage: 'spec', windows: [['five_hour', 0.8], ['seven_day', 0.7], ['seven_day_opus', 0.7]] },
];
const base = (stage, usage, extra = {}) => ({ stage, usage, settings, history: {}, running: [], queue: { paused: null }, ...extra });
const at = (type, utilization) => ({ [type]: { utilization, resetsAt: 1000, observedAt: 1 } });

for (const { stage, windows } of CASES) {
  for (const [type, ceiling] of windows) {
    const room = ceiling - seedP75(stage);
    test(`F-4-04 ${stage} ${type}: admitted at the ceiling, refused one step above, admitted below`, () => {
      assert.deepEqual(admit(base(stage, at(type, room - 0.01))), { ok: true });
      assert.deepEqual(admit(base(stage, at(type, room))), { ok: true });
      assert.deepEqual(admit(base(stage, at(type, room + 0.01))), { ok: false, reason: 'ceiling', rateLimitType: type, resetsAt: 1000 });
    });
  }
}

test('F-4-04 the p75 history replaces the seed once there are five samples', () => {
  const history = { build: [0.2, 0.2, 0.2, 0.2, 0.2] };
  assert.equal(admit(base('build', at('five_hour', 0.65), { history })).reason, 'ceiling');
  assert.equal(admit(base('build', at('five_hour', 0.65))).ok, true);
});

test('F-4-04 an Opus window holds spec and still admits build', () => {
  const usage = at('seven_day_opus', 0.99);
  assert.equal(admit(base('spec', usage)).reason, 'ceiling');
  assert.deepEqual(admit(base('build', usage)), { ok: true });
});

test('F-4-04 a limit pause holds only stages naming its window, other pauses hold all', () => {
  const limit = { paused: { reason: 'limit', rateLimitType: 'seven_day_opus', resetsAt: 5 } };
  assert.deepEqual(admit(base('spec', {}, { queue: limit })), { ok: false, reason: 'paused', rateLimitType: 'seven_day_opus', resetsAt: 5 });
  assert.equal(admit(base('build', {}, { queue: limit })).ok, true);
  assert.equal(admit(base('build', {}, { queue: { paused: { reason: 'user' } } })).reason, 'paused');
});

test('F-4-06 overage refuses a new job until the toggle allows it', () => {
  for (const overage of [{ isUsingOverage: true }, { status: 'allowed' }]) {
    assert.equal(admit(base('build', { overage })).reason, 'overage');
    assert.equal(admit(base('build', { overage }, { settings: { ...settings, overageAllowed: true } })).ok, true);
  }
  assert.equal(admit(base('build', { overage: { status: 'rejected', isUsingOverage: false } })).ok, true);
});

test('F-4-06 concurrency: at the cap refused, one below admitted', () => {
  assert.equal(admit(base('build', {}, { running: ['a', 'b'] })).reason, 'concurrency');
  assert.equal(admit(base('build', {}, { running: ['a'] })).ok, true);
  assert.equal(admit(base('build', {}, { running: 2 })).reason, 'concurrency');
});

test('C-05 the queue never starts a job past the ceiling', () => {
  const state = { jobs: [], cards: [] };
  const q = createQueue(state);
  q.enqueue('j1');
  const usage = at('five_hour', 0.79);
  assert.equal(q.next(() => admit(base('build', usage, { queue: q.snapshot() })).ok), null);
  assert.deepEqual(q.snapshot().order, ['j1']);
  const low = at('five_hour', 0.5);
  assert.equal(q.next(() => admit(base('build', low, { queue: q.snapshot() })).ok), 'j1');
});
