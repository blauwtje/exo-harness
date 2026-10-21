import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeUsage, readIterLogUsage, readStatuslineCache, usageFromEvent } from '../src/daemon/usage-sources.mjs';
import { parseRateLimitEvent } from '../src/daemon/usage.mjs';

const ev = (type, utilization, resetsAt) => ({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', rateLimitType: type, unifiedWindows: { [type]: { utilization, resetsAt } } },
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'usage-src-'));
  const logDir = join(dir, '.exo', 'run-plan', 'plan', '2026');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, 'iter-1-task-1.log');
  writeFileSync(log, `${JSON.stringify(ev('five_hour', 0.2, 111))}\n${JSON.stringify(ev('seven_day', 0.1, 222))}\nnot json rate_limit_event\n`);
  utimesSync(log, 2000, 2000);
  const cache = join(dir, 'cache.json');
  writeFileSync(cache, JSON.stringify({ five_hour: { used_percentage: 60, resets_at: 333 }, seven_day: { used_percentage: 70, resets_at: 444 }, seven_day_opus: { used_percentage: 5, resets_at: 555 }, cached_at: 1 }));
  utimesSync(cache, 1500, 1500);
  return { dir, cache };
}

test('F-4-03 each of three sources wins one rateLimitType', () => {
  const { dir, cache } = fixture();
  const iter = readIterLogUsage(dir);
  const status = readStatuslineCache(cache);
  const warning = ev('seven_day', 0.9, 999);
  warning.rate_limit_info.status = 'allowed_warning';
  const stream = usageFromEvent(warning, 3_000_000);
  const merged = mergeUsage(iter, status, stream);
  assert.equal(merged.five_hour.utilization, 0.2);
  assert.equal(merged.seven_day.utilization, 0.9);
  assert.equal(merged.seven_day_opus.utilization, 0.05);
  assert.equal(merged.seven_day.status, 'allowed_warning');
});

test('F-4-03 statusline cache converts percent and skips missing or bad files', () => {
  const { dir, cache } = fixture();
  const u = readStatuslineCache(cache);
  assert.deepEqual(Object.keys(u).sort(), ['five_hour', 'seven_day', 'seven_day_opus']);
  assert.equal(u.five_hour.utilization, 0.6);
  assert.equal(u.five_hour.resetsAt, 333);
  assert.deepEqual(readStatuslineCache(join(dir, 'nope.json')), {});
  writeFileSync(join(dir, 'bad.json'), '{');
  assert.deepEqual(readStatuslineCache(join(dir, 'bad.json')), {});
});

test('F-4-03 iter log reading survives a missing run-plan dir', () => {
  assert.deepEqual(readIterLogUsage(mkdtempSync(join(tmpdir(), 'usage-src-'))), {});
});

test('F-4-03 parseRateLimitEvent returns observedAt and per-window status', () => {
  const rejected = ev('five_hour', 0.3, 5);
  rejected.rate_limit_info.status = 'rejected';
  const u = parseRateLimitEvent(rejected, 42);
  assert.equal(u.observedAt, 42);
  assert.equal(u.windows.five_hour.status, 'rejected');
});
