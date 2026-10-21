import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/daemon/settings.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'settings-'));

test('F-4-02 a missing file gives the defaults', () => {
  const s = loadSettings(dir());
  assert.deepEqual(s, {
    ceilings: { fiveHour: 0.8, sevenDay: 0.7 }, hardStopFiveHour: 0.92, maxConcurrent: 2,
    landDefault: 'local', landByProject: {}, scouts: { enabled: false }, overageAllowed: false,
  });
});

test('F-4-02 a save is read back, rewritten whole, with unknown keys dropped and no tmp file left', () => {
  const d = dir();
  const r = saveSettings(d, { ceilings: { fiveHour: 0.5 }, maxConcurrent: 3, bogus: 1 });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.settings.ceilings, { fiveHour: 0.5, sevenDay: 0.7 });
  assert.deepEqual(loadSettings(d), r.settings);
  const onDisk = JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'));
  assert.equal('bogus' in onDisk, false);
  assert.deepEqual(readdirSync(d), ['settings.json']);
  saveSettings(d, { overageAllowed: true });
  assert.equal(loadSettings(d).maxConcurrent, 3);
  assert.equal(loadSettings(d).overageAllowed, true);
});

test('F-4-02 an out-of-range or mistyped value is refused and nothing is written', () => {
  const d = dir();
  const bad = [
    { ceilings: { fiveHour: 1.5 } }, { ceilings: { sevenDay: 0 } }, { ceilings: 'x' },
    { hardStopFiveHour: -1 }, { maxConcurrent: 0 }, { maxConcurrent: 1.5 }, { maxConcurrent: '2' },
    { landDefault: 'push' }, { landByProject: { a: 'nope' } }, { scouts: { enabled: 'yes' } },
    { overageAllowed: 1 }, { ceilings: { fiveHour: NaN } }, 'x', null,
  ];
  for (const patch of bad) {
    const r = saveSettings(d, patch);
    assert.equal(typeof r.error, 'string', JSON.stringify(patch));
  }
  assert.deepEqual(readdirSync(d), []);
});

test('F-4-02 a damaged or hand-edited file falls back per key', () => {
  const d = dir();
  writeFileSync(join(d, 'settings.json'), '{"maxConcurrent": 99, "ceilings": {"fiveHour": 0.6, "sevenDay": 0.5}');
  assert.equal(loadSettings(d).maxConcurrent, 2);
  writeFileSync(join(d, 'settings.json'), '{"maxConcurrent": 99, "overageAllowed": true, "x": 1}');
  const s = loadSettings(d);
  assert.equal(s.maxConcurrent, 2);
  assert.equal(s.overageAllowed, true);
  assert.equal('x' in s, false);
});
