import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseLine } from '../src/daemon/stream.mjs';

const dir = join(import.meta.dirname, 'fixtures', 'probes');

const probeLines = () => readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean));

test('every probe line parses without throwing, keeping raw', () => {
  const lines = probeLines();
  assert.ok(lines.length > 0);
  const results = lines.map(parseLine);
  results.forEach((r, i) => assert.equal(r.raw, lines[i]));
  assert.ok(results.every((r) => ['known', 'unknown', 'malformed'].includes(r.kind)));
  assert.ok(results.some((r) => r.kind === 'known'));
});

test('known, unknown and malformed lines', () => {
  const k = parseLine('{"type":"system","subtype":"init"}');
  assert.deepEqual([k.kind, k.type, k.subtype], ['known', 'system', 'init']);
  const u = parseLine('{"type":"brand_new","x":1}');
  assert.deepEqual([u.kind, u.type, u.event.x], ['unknown', 'brand_new', 1]);
  for (const bad of ['{nope', '', '42', 'null', '[1]']) {
    const m = parseLine(bad);
    assert.deepEqual([m.kind, m.event, m.raw], ['malformed', null, bad]);
  }
});
