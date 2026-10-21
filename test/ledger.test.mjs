import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerRow, recordUtilization, p75 } from '../src/daemon/ledger.mjs';

const result = (write1h = 0, write5m = 0) => ({
  type: 'result',
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300,
    cache_creation: { ephemeral_1h_input_tokens: write1h, ephemeral_5m_input_tokens: write5m },
  },
});

test('F-4-13 row carries tokens, cache fields, cost and the estimate mark', () => {
  const row = ledgerRow(result(5, 6), null, 1000);
  assert.deepEqual(row, {
    at: 1000, input: 10, output: 20, cacheRead: 300,
    cacheCreation1h: 5, cacheCreation5m: 6, costUsd: 0.42, estimate: true,
  });
  assert.equal(ledgerRow({ type: 'assistant' }, null), null);
});

test('F-4-13 idle cache write needs over 20000 written tokens and a gap over 300 s', () => {
  const prev = { at: 0 };
  assert.equal(ledgerRow(result(15000, 6000), prev, 301000).idleCacheWrite, true);
  assert.equal('idleCacheWrite' in ledgerRow(result(20000, 0), prev, 301000), false);
  assert.equal('idleCacheWrite' in ledgerRow(result(15000, 6000), prev, 300000), false);
  assert.equal('idleCacheWrite' in ledgerRow(result(15000, 6000), null, 301000), false);
});

test('F-4-04 p75 uses the seed under 5 samples and index ceil(0.75n)-1 after', () => {
  let h = {};
  for (const d of [0.04, 0.01, 0.03, 0.02]) h = recordUtilization(h, 'build', d);
  assert.equal(p75(h, 'build', 0.06), 0.06);
  h = recordUtilization(h, 'build', 0.05);
  assert.equal(p75(h, 'build', 0.06), 0.04);
  assert.equal(p75(h, 'spec', 0.04), 0.04);
});

test('F-4-04 p75 history is pure, JSON-safe, ignores bad deltas and keeps 50', () => {
  const h0 = {};
  const h1 = recordUtilization(h0, 'run', 0.1);
  assert.deepEqual(h0, {});
  assert.deepEqual(JSON.parse(JSON.stringify(h1)), { run: [0.1] });
  assert.deepEqual(recordUtilization(h1, 'run', NaN), h1);
  assert.deepEqual(recordUtilization(h1, 'run', -0.1), h1);
  let h = {};
  for (let i = 0; i < 60; i++) h = recordUtilization(h, 'run', i);
  assert.equal(h.run.length, 50);
  assert.equal(h.run[0], 10);
});
