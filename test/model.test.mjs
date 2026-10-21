import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/daemon/store.mjs';
import { addCard, addJob, addProject, projectKey } from '../src/daemon/model.mjs';

const empty = () => ({ projects: [], cards: [], jobs: [] });

test('F-2-03 project with no origin is keyed local/<folder name>', () => {
  assert.equal(projectKey('/x/y/my-app', null), 'local/my-app');
  const s = empty();
  assert.deepEqual(addProject(s, { path: '/x/y/my-app' }), { key: 'local/my-app', path: '/x/y/my-app', origin: null });
});

test('F-2-03 project with origin is keyed nameWithOwner for https and ssh forms', () => {
  for (const o of ['https://github.com/blauwtje/exo.git', 'git@github.com:blauwtje/exo.git', 'ssh://git@github.com/blauwtje/exo', 'https://github.com/blauwtje/exo/']) {
    assert.equal(projectKey('/p/other-name', o), 'blauwtje/exo', o);
  }
  assert.equal(projectKey('/p/f', 'https://example.com/a/b.git'), 'local/f');
});

test('F-2-03 adding the same project twice is idempotent, a key clash on another path throws', () => {
  const s = empty();
  addProject(s, { path: '/a/app' });
  addProject(s, { path: '/a/app' });
  assert.equal(s.projects.length, 1);
  assert.throws(() => addProject(s, { path: '/b/app' }), /already used/);
});

test('F-2-03 cards start in Inbox and jobs need a known card; state round-trips through the store', () => {
  const s = empty();
  const p = addProject(s, { path: '/a/app' });
  assert.throws(() => addCard(s, { projectKey: 'nope', title: 't' }), /unknown project/);
  const c = addCard(s, { projectKey: p.key, title: 'Do it' });
  assert.equal(c.lane, 'Inbox');
  assert.throws(() => addJob(s, { cardId: 'nope', stage: 'spec' }), /unknown card/);
  const j = addJob(s, { cardId: c.id, stage: 'spec' });
  const store = createStore(mkdtempSync(join(tmpdir(), 'exo-model-')));
  store.save(s);
  assert.deepEqual(store.load(), s);
  assert.equal(store.load().jobs[0].id, j.id);
});
