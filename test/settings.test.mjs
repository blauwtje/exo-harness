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
    needsYou: ['question', 'permission', 'brief', 'gate', 'conflict', 'run-failed', 'setup', 'refusal', 'land', 'turn-cap'],
    alerts: {}, accounts: [], accountByStage: {},
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
    { overageAllowed: 1 },
    { needsYou: 'brief' }, { needsYou: [1] }, { needsYou: [''] }, { alerts: [] }, { alerts: { gate: 'app' } },
    { alerts: { gate: { where: 'email', sound: true } } }, { alerts: { gate: { where: 'app' } } }, { ceilings: { fiveHour: NaN } }, 'x', null,
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

test('F-4-02 needsYou and alerts persist, alerts are replaced whole, bad stored values fall back', () => {
  const d = dir();
  const alerts = { gate: { where: 'system', sound: true, extra: 1 }, brief: { where: 'none', sound: false } };
  const r = saveSettings(d, { needsYou: ['gate', 'limit', 'gate'], alerts });
  assert.equal(r.error, undefined);
  assert.deepEqual(loadSettings(d).needsYou, ['gate', 'limit']);
  assert.deepEqual(loadSettings(d).alerts, { gate: { where: 'system', sound: true }, brief: { where: 'none', sound: false } });
  saveSettings(d, { alerts: { land: { where: 'app', sound: false } } });
  assert.deepEqual(loadSettings(d).alerts, { land: { where: 'app', sound: false } });
  saveSettings(d, { needsYou: [] });
  assert.deepEqual(loadSettings(d).needsYou, []);
  writeFileSync(join(d, 'settings.json'), '{"needsYou": "x", "alerts": {"gate": 3}}');
  assert.deepEqual(loadSettings(d).needsYou, loadSettings(dir()).needsYou);
  assert.deepEqual(loadSettings(d).alerts, {});
});

test('F-4-02 needsYou accepts only the 16 known kinds', () => {
  const d = dir();
  assert.ok(saveSettings(d, { needsYou: ['gate', 'gaet'] }).error);
  assert.equal(saveSettings(d, { needsYou: ['overage', 'invariant', 'failure', 'health', 'limit', 'budget'] }).error, undefined);
  writeFileSync(join(d, 'settings.json'), '{"needsYou": ["gaet"]}');
  assert.deepEqual(loadSettings(d).needsYou, loadSettings(dir()).needsYou);
});

test('accounts need a valid unique id, a clean name and a normalized absolute configDir', () => {
  const d = dir();
  const ok = { id: 'work', name: 'Work', configDir: '/a/work' };
  assert.deepEqual(saveSettings(d, { accounts: [ok] }).settings.accounts, [ok]);
  for (const bad of [
    [{ ...ok, id: 'default' }], [{ ...ok, id: 'Work' }], [{ ...ok, id: 'x'.repeat(33) }], [ok, { ...ok, configDir: '/b' }],
    [{ ...ok, name: '' }], [{ ...ok, name: 'a\nb' }], [{ ...ok, name: 'x'.repeat(65) }],
    [{ ...ok, configDir: 'rel' }], [{ ...ok, configDir: '/a/../b' }], [{ ...ok, configDir: '/a/' }], [{ ...ok, configDir: '/a\u0000' }], 'nope',
  ]) assert.ok(saveSettings(d, { accounts: bad }).error, JSON.stringify(bad));
  assert.deepEqual(loadSettings(d).accounts, [ok]);
});

test('accountByStage takes known stages and known account ids, merges, and is checked when accounts change', () => {
  const d = dir();
  saveSettings(d, { accounts: [{ id: 'work', name: 'Work', configDir: '/a/work' }] });
  assert.match(saveSettings(d, { accountByStage: { build: 'ghost' } }).error, /unknown account/);
  assert.match(saveSettings(d, { accountByStage: { nostage: 'default' } }).error, /unknown stage/);
  assert.deepEqual(saveSettings(d, { accountByStage: { build: 'work' } }).settings.accountByStage, { build: 'work' });
  assert.deepEqual(saveSettings(d, { accountByStage: { spec: 'default' } }).settings.accountByStage, { build: 'work', spec: 'default' });
  assert.match(saveSettings(d, { accounts: [] }).error, /unknown account/);
  assert.deepEqual(saveSettings(d, { accounts: [], accountByStage: { build: 'default' } }).settings.accountByStage, { build: 'default', spec: 'default' });
});

test('a hand-edited settings file keeps the good accounts and stage picks and drops the bad ones', () => {
  const d = dir();
  writeFileSync(join(d, 'settings.json'), JSON.stringify({
    accounts: [{ id: 'work', name: 'Work', configDir: '/a/work', token: 'x' }, { id: 'BAD', name: 'b', configDir: '/b' }, { id: 'work', name: 'Dup', configDir: '/c' }],
    accountByStage: { build: 'work', spec: 'BAD', nostage: 'work', run: 'default' },
  }));
  const s = loadSettings(d);
  assert.deepEqual(s.accounts, [{ id: 'work', name: 'Work', configDir: '/a/work' }]);
  assert.deepEqual(s.accountByStage, { build: 'work', run: 'default' });
});
