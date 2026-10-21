import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkInit } from '../src/daemon/invariants.mjs';

const line = readFileSync(new URL('./fixtures/probes/p8-default.jsonl', import.meta.url), 'utf8')
  .split('\n').map((l) => l && JSON.parse(l)).find((m) => m?.subtype === 'init');
const expected = { permissionMode: 'default', cwd: line.cwd, effort: 'high' };

test('matching init passes and stamps versions', () => {
  const r = checkInit(line, expected);
  assert.deepEqual(r.mismatches, []);
  assert.deepEqual(r.stamps, { claudeCodeVersion: '2.1.305', exoVersion: '0.136.0', model: 'claude-haiku-5-5', effort: 'high' });
});

test('each drifted field is named', () => {
  assert.deepEqual(checkInit({ ...line, apiKeySource: 'ANTHROPIC_API_KEY' }, expected).mismatches, ['apiKeySource']);
  assert.deepEqual(checkInit({ ...line, permissionMode: 'bypassPermissions' }, expected).mismatches, ['permissionMode']);
  assert.deepEqual(checkInit({ ...line, plugins: [] }, expected).mismatches, ['plugins']);
  assert.deepEqual(checkInit({ ...line, cwd: '/somewhere/else' }, expected).mismatches, ['cwd']);
});

test('empty init mismatches everything', () => {
  assert.deepEqual(checkInit({}, expected).mismatches, ['apiKeySource', 'permissionMode', 'plugins', 'cwd']);
});
