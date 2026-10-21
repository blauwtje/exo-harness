import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDir } from '../src/daemon/data-dir.mjs';
import { createStore } from '../src/daemon/store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'exo-store-'));

test('F-2-02 S-14 data dir honours EXO_HARNESS_DATA and is mode 0700', () => {
  const dir = join(tmp(), 'nested', 'data');
  assert.equal(dataDir({ EXO_HARNESS_DATA: dir }), dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('F-2-02 S-14 default data dir is under Application Support', () => {
  const home = tmp();
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.equal(dataDir({}), join(home, 'Library', 'Application Support', 'exo-harness'));
  } finally {
    process.env.HOME = prev;
  }
});

test('F-2-02 state round-trips, starts empty, and leaves no tmp file', () => {
  const dir = tmp();
  const store = createStore(dir);
  assert.deepEqual(store.load(), { projects: [], cards: [], jobs: [] });
  const state = { projects: [{ key: 'local/x' }], cards: [], jobs: [] };
  store.save(state);
  store.save({ ...state, cards: [{ id: 'c1' }] });
  assert.deepEqual(store.load().cards, [{ id: 'c1' }]);
  assert.deepEqual(readdirSync(dir), ['state.json']);
});

test('F-2-02 events append one line each and read back in order', () => {
  const dir = tmp();
  const store = createStore(dir);
  store.appendEvent('j1', { type: 'a' });
  store.appendEvent('j1', { type: 'b' });
  assert.deepEqual(store.readEvents('j1'), [{ type: 'a' }, { type: 'b' }]);
  assert.equal(store.readEvents('nope').length, 0);
});

test('F-2-02 a torn final event line is dropped, a bad middle line throws', () => {
  const dir = tmp();
  const store = createStore(dir);
  store.appendEvent('j1', { type: 'a' });
  const file = join(dir, 'jobs', 'j1', 'events.jsonl');
  appendFileSync(file, '{"type":');
  assert.deepEqual(store.readEvents('j1'), [{ type: 'a' }]);
  appendFileSync(file, '\n{"type":"c"}\n');
  assert.throws(() => store.readEvents('j1'));
});

test('F-2-02 job ids cannot escape the jobs dir', () => {
  const dir = tmp();
  const store = createStore(dir);
  for (const id of ['../x', 'a/b', '..', '']) assert.throws(() => store.appendEvent(id, {}));
  assert.equal(existsSync(join(dir, 'x')), false);
});
