import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode } from '../src/daemon/mode.mjs';

const stored = () => '/stored/root';

test('plain start is live with defaults', () => {
  assert.deepEqual(resolveMode([], {}, stored), { mode: 'live', claudePath: 'claude', pluginRoot: '/stored/root' });
});

test('env overrides binary paths', () => {
  const env = { EXO_HARNESS_CLAUDE: '/x/claude', EXO_PLUGIN_ROOT: '/x/root' };
  assert.deepEqual(resolveMode(['--live-check'], env, stored), { mode: 'live-check', claudePath: '/x/claude', pluginRoot: '/x/root' });
});

test('--fixtures is allowed under CLAUDECODE', () => {
  assert.equal(resolveMode(['--fixtures'], { CLAUDECODE: '1', EXO_PLUGIN_ROOT: '/r' }, stored).mode, 'fixtures');
});

test('live and live-check refuse under CLAUDECODE', () => {
  assert.throws(() => resolveMode([], { CLAUDECODE: '1' }, stored), /CLAUDECODE/);
  assert.throws(() => resolveMode(['--live-check'], { CLAUDECODE: '1' }, stored), /CLAUDECODE/);
});

test('two mode flags are rejected', () => {
  assert.throws(() => resolveMode(['--fixtures', '--live-check'], {}, stored), /one of/);
});
