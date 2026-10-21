import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isBuildDispatch, isDone } from '../src/daemon/shape-guard.mjs';

const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('helper agents pass, other agents and exo:build stop the session', () => {
  for (const h of ['exo:find-open-points', 'exo:locate-code', 'exo:fetch-docs'])
    assert.equal(isBuildDispatch(use('Agent', { subagent_type: h }), 'spec'), false);
  assert.equal(isBuildDispatch(use('Agent', { subagent_type: 'exo:implementer' }), 'spec'), true);
  assert.equal(isBuildDispatch(use('Agent', { subagent_type: 'general-purpose' }), 'spec'), true);
  assert.equal(isBuildDispatch(use('Agent', {}), 'spec'), true);
  assert.equal(isBuildDispatch(use('Skill', { skill: 'exo:build' }), 'spec'), true);
  assert.equal(isBuildDispatch(use('Skill', { skill: 'exo:spec' }), 'spec'), false);
  assert.equal(isBuildDispatch(use('Read', {}), 'spec'), false);
  assert.equal(isBuildDispatch({ type: 'user', message: { content: [] } }, 'spec'), false);
  assert.throws(() => isBuildDispatch({}, 'nope'));
});

test('p9-spec fixture: only helper agents appear, none is a build dispatch', () => {
  const lines = readFileSync(new URL('./fixtures/probes/p9-spec.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  assert.ok(events.some((e) => blocks(e).some((b) => b.name === 'Agent')));
  assert.equal(events.some((e) => isBuildDispatch(e, 'spec')), false);
});
const blocks = (e) => (e.type === 'assistant' ? e.message.content.filter((b) => b.type === 'tool_use') : []);

function fakePlugin(exit) {
  const root = mkdtempSync(path.join(tmpdir(), 'sg-plugin-'));
  const dir = path.join(root, 'skills', 'spec', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plan-check.mjs'), `process.exit(${exit});`);
  return root;
}

function tree(withBrief) {
  const wt = mkdtempSync(path.join(tmpdir(), 'sg-wt-'));
  mkdirSync(path.join(wt, 'docs', 'specs'), { recursive: true });
  writeFileSync(path.join(wt, 'docs', 'specs', 'old.md'), 'old');
  if (withBrief) writeFileSync(path.join(wt, 'docs', 'specs', 'new.md'), 'new');
  return wt;
}

test('isDone needs a new brief and a passing plan-check', async () => {
  const startedAt = Date.now() + 1000;
  assert.match(await isDone(tree(true), 0, { pluginRoot: fakePlugin(0) }), /\.md$/);
  assert.equal(await isDone(tree(true), 0, { pluginRoot: fakePlugin(1) }), null);
  assert.equal(await isDone(tree(true), startedAt, { pluginRoot: fakePlugin(0) }), null);
  assert.equal(await isDone(mkdtempSync(path.join(tmpdir(), 'sg-empty-')), 0, { pluginRoot: fakePlugin(0) }), null);
});
