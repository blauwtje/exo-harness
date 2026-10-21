import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineProbe } from '../src/daemon/offline.mjs';
import { createQueue } from '../src/daemon/queue.mjs';
import { createApp } from '../src/daemon/app.mjs';

const flaky = (failures) => {
  let n = 0;
  return async () => { if (n++ < failures) throw new Error('offline'); return {}; };
};

test('F-4-14 the queue holds while the probe fails and resumes on the first success', async () => {
  const q = createQueue({ projects: [], jobs: [], cards: [] });
  const probe = createOfflineProbe({ fetch: flaky(2), queue: q, intervalMs: 10, setTimer: () => {} });
  await probe.check();
  assert.equal(q.snapshot().paused.reason, 'offline');
  q.enqueue('j1');
  assert.equal(q.next(() => true), null);
  await probe.check();
  assert.equal(q.snapshot().paused.reason, 'offline');
  await probe.check();
  assert.equal(q.snapshot().paused, null);
  assert.equal(q.next(() => true), 'j1');
});

test('S-08 offline, queued jobs start only after the success and the deck state still answers', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'exo-offline-')));
  const data = join(base, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'state.json'), JSON.stringify({ projects: [], cards: [{ id: 'c1', projectKey: 'p', title: 'T', lane: 'Shaped' }], jobs: [{ id: 'j1', cardId: 'c1', stage: 'spec', status: 'queued' }] }));
  const timers = [];
  const app = createApp({
    dataDir: data, pluginRoot: base, drainMs: 3600000,
    offlineOptions: { fetch: flaky(2), setTimer: (fn) => { timers.push(fn); } },
  });
  try {
    const { port, url } = await app.start();
    const token = new URL(url).hash.replace(/^#token=/, '');
    const get = async () => (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { authorization: `Bearer ${token}` } })).status;
    const until = async (fn) => { for (let i = 0; i < 100 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 20)); };
    await until(() => timers.length === 1);
    assert.equal(app.state.queue.paused.reason, 'offline');
    assert.equal(await get(), 200);
    assert.equal(app.state.jobs[0].status, 'queued');
    timers.shift()();
    await until(() => timers.length === 1);
    assert.equal(app.state.queue.paused.reason, 'offline');
    assert.equal(app.state.jobs[0].status, 'queued');
    timers.shift()();
    await until(() => !app.state.queue.paused);
    assert.equal(app.state.queue.paused, null);
    assert.notEqual(app.state.jobs[0].status, 'queued');
    assert.equal(await get(), 200);
  } finally {
    await app.close();
  }
});
