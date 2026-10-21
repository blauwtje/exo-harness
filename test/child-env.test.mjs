import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnv } from '../src/daemon/child-env.mjs';

const parent = {
  PATH: '/bin',
  ANTHROPIC_API_KEY: 'sk-secret-123',
  ANTHROPIC_AUTH_TOKEN: 't',
  ANTHROPIC_BASE_URL: 'u',
  CLAUDE_CODE_USE_BEDROCK: '1',
  CLAUDE_CODE_USE_VERTEX: '1',
  FORCE_PROMPT_CACHING_5M: '1',
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
};

test('scrubs auth and provider vars for every kind', () => {
  for (const kind of ['shape', 'exo-run']) {
    const env = childEnv(kind, parent);
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('ANTHROPIC_') || k === 'FORCE_PROMPT_CACHING_5M' || /USE_(BEDROCK|VERTEX)/.test(k)), []);
    assert.equal(env.PATH, '/bin');
  }
});

test('CLAUDECODE and CLAUDE_CODE_* removed only for exo-run', () => {
  const run = childEnv('exo-run', parent);
  assert.equal('CLAUDECODE' in run, false);
  assert.equal('CLAUDE_CODE_ENTRYPOINT' in run, false);
  const other = childEnv('shape', parent);
  assert.equal(other.CLAUDECODE, '1');
  assert.equal(other.CLAUDE_CODE_ENTRYPOINT, 'cli');
});

test('silent: no output, parent untouched', () => {
  const writes = [];
  const o = process.stdout.write, e = process.stderr.write;
  process.stdout.write = (s) => (writes.push(String(s)), true);
  process.stderr.write = (s) => (writes.push(String(s)), true);
  try { childEnv('exo-run', parent); } finally { process.stdout.write = o; process.stderr.write = e; }
  assert.deepEqual(writes, []);
  assert.equal(parent.ANTHROPIC_API_KEY, 'sk-secret-123');
});
