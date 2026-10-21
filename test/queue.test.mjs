import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/daemon/queue.mjs';
import { createStore } from '../src/daemon/store.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mk = () => ({
  projects: [], jobs: [{ id: 'j1', cardId: 'c1' }, { id: 'j2', cardId: 'c2' }, { id: 'j3', cardId: 'c1' }],
  cards: [{ id: 'c1', projectKey: 'a' }, { id: 'c2', projectKey: 'b' }],
});
const all = () => true;

test('F-4-07 next is FIFO without priority', () => {
  const q = createQueue(mk());
  ['j1', 'j2', 'j3'].forEach(q.enqueue);
  assert.deepEqual([q.next(all), q.next(all), q.next(all), q.next(all)], ['j1', 'j2', 'j3', null]);
});

test('F-4-07 project priority wins, FIFO inside a project', () => {
  const q = createQueue(mk());
  ['j1', 'j2', 'j3'].forEach(q.enqueue);
  q.setPriority(['b', 'a']);
  assert.deepEqual([q.next(all), q.next(all), q.next(all)], ['j2', 'j1', 'j3']);
});

test('F-4-07 next skips a job admit refuses', () => {
  const q = createQueue(mk());
  ['j1', 'j2'].forEach(q.enqueue);
  assert.equal(q.next((id) => id !== 'j1'), 'j2');
  assert.deepEqual(q.snapshot().order, ['j1']);
});

test('F-4-07 reorder needs the full list of queued ids', () => {
  const q = createQueue(mk());
  ['j1', 'j2'].forEach(q.enqueue);
  assert.ok(q.reorder(['j1', 'nope']).error);
  assert.ok(q.reorder(['j1']).error);
  assert.deepEqual(q.reorder(['j2', 'j1']), {});
  assert.equal(q.next(all), 'j2');
});

test('F-4-07 a pause with several causes resumes only when none is left', () => {
  const q = createQueue(mk());
  q.enqueue('j1');
  q.pause({ reason: 'limit', resetsAt: 5 });
  q.pause({ reason: 'offline' });
  assert.equal(q.next(all), null);
  q.resume('limit');
  assert.equal(q.snapshot().paused.reason, 'offline');
  assert.equal(q.next(all), null);
  q.resume('offline');
  assert.equal(q.snapshot().paused, null);
  assert.equal(q.next(all), 'j1');
});

test('F-4-07 queue survives a save and load in state.json', () => {
  const state = mk();
  const q = createQueue(state);
  ['j1', 'j2'].forEach(q.enqueue);
  q.setPriority(['b']);
  q.pause({ reason: 'limit', resetsAt: 9 });
  const store = createStore(mkdtempSync(join(tmpdir(), 'exo-queue-')));
  store.save(state);
  const back = createQueue(store.load());
  assert.deepEqual(back.snapshot(), q.snapshot());
  assert.equal(back.snapshot().paused.resetsAt, 9);
});
