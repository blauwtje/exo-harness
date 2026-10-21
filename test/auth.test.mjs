import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAuth } from '../src/daemon/auth.mjs';

function fakeClaude(body) {
  const path = join(mkdtempSync(join(tmpdir(), 'auth-')), 'claude');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const printing = (json) => fakeClaude(`cat <<'EOF'\n${json}\nEOF`);

test('claude.ai login passes', async () => {
  const r = await checkAuth({ claudePath: printing('{"loggedIn":true,"authMethod":"claude.ai"}') });
  assert.equal(r.ok, true);
});

test('missing binary blocks with install fix', async () => {
  const r = await checkAuth({ claudePath: '/nonexistent/claude' });
  assert.equal(r.ok, false);
  assert.match(r.fix, /install/);
});

test('logged out blocks with login fix', async () => {
  const r = await checkAuth({ claudePath: printing('{"loggedIn":false}') });
  assert.equal(r.ok, false);
  assert.equal(r.fix, 'claude auth login --claudeai');
});

test('api key auth method blocks', async () => {
  const r = await checkAuth({ claudePath: printing('{"loggedIn":true,"authMethod":"api_key"}') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /api_key/);
  assert.equal(r.fix, 'claude auth login --claudeai');
});

test('bad JSON blocks', async () => {
  const r = await checkAuth({ claudePath: printing('not json') });
  assert.equal(r.ok, false);
  assert.ok(r.fix);
});

test('non-zero exit with no output blocks', async () => {
  const r = await checkAuth({ claudePath: fakeClaude('exit 1') });
  assert.equal(r.ok, false);
});

test('timeout blocks', async () => {
  const r = await checkAuth({ claudePath: fakeClaude('sleep 5'), timeout: 200 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /timed out/);
});

test('the status call does not see the API key', async () => {
  const claudePath = fakeClaude('if [ -n "$ANTHROPIC_API_KEY" ]; then echo \'{"loggedIn":true,"authMethod":"api_key"}\'; else echo \'{"loggedIn":true,"authMethod":"claude.ai"}\'; fi');
  const r = await checkAuth({ claudePath, parentEnv: { ...process.env, ANTHROPIC_API_KEY: 'sk-x' } });
  assert.equal(r.ok, true);
});
