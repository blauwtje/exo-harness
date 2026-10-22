import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMoves, loadSnapshot, movedSince, saveSnapshot, stageMap } from '../src/ui/moves.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('stageMap maps the project cards to their lane', () => {
  const state = { jobs: [{ cardId: 'b', status: 'running', stage: 'run' }], cards: [
    { id: 'a', projectKey: 'p', lane: 'Shaped' }, { id: 'b', projectKey: 'p', lane: 'Approved' }, { id: 'c', projectKey: 'q', lane: 'Done' }] };
  assert.deepEqual(stageMap(state, 'p'), { a: 'Shaped', b: 'Running' });
});

test('diffMoves lists moved tasks, ignores new, gone and unchanged ones', () => {
  const prev = { a: 'Inbox', b: 'Queued', c: 'Done' };
  const next = { a: 'Shaped', b: 'Queued', d: 'Inbox' };
  assert.deepEqual(diffMoves({ prev, next }), [{ id: 'a', from: 'Inbox', to: 'Shaped' }]);
});

test('the first refresh is a baseline with no moves', () => {
  assert.deepEqual(diffMoves({ prev: null, next: { a: 'Inbox' } }), []);
});

test('a snapshot round trips per project and a bad one reads as none', () => {
  const storage = mem();
  assert.equal(loadSnapshot({ storage, projectKey: 'p' }), null);
  saveSnapshot({ storage, projectKey: 'p', map: { a: 'Inbox' } });
  assert.deepEqual(loadSnapshot({ storage, projectKey: 'p' }), { a: 'Inbox' });
  assert.equal(loadSnapshot({ storage, projectKey: 'q' }), null);
  storage.setItem('exo.lastlook.bad', '{nope');
  assert.equal(loadSnapshot({ storage, projectKey: 'bad' }), null);
  assert.equal(loadSnapshot({ storage: { getItem() { throw new Error('x'); } }, projectKey: 'p' }), null);
});

test('movedSince compares against the saved snapshot and shows nothing without one', () => {
  assert.deepEqual(movedSince({ snapshot: { a: 'Inbox', b: 'Done' }, next: { a: 'Queued', b: 'Done' } }), ['a']);
  assert.deepEqual(movedSince({ snapshot: null, next: { a: 'Queued' } }), []);
});

test('a snapshot that cannot be saved is reported, not swallowed', () => {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    saveSnapshot({ storage: { setItem() { throw new Error('quota full'); } }, projectKey: 'p', map: { a: 'Inbox' } });
  } finally {
    console.warn = original;
  }
  assert.match(warned.join('\n'), /quota full/);
});
