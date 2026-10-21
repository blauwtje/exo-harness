import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHealth } from '../src/daemon/health.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'health-'));
const claude = () => {
  const p = join(tmp(), 'claude');
  writeFileSync(p, `#!/bin/sh\necho '{"loggedIn":true,"authMethod":"claude.ai"}'\n`);
  chmodSync(p, 0o755);
  return p;
};
function plugin(version, specs) {
  const root = tmp();
  mkdirSync(join(root, 'skills', 'configure', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'skills', 'configure', 'scripts', 'settings.mjs'), `console.log(${JSON.stringify(specs)});`);
  return root;
}
const repo = () => {
  const d = tmp();
  const git = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return { d, git };
};
const base = { minExoVersion: '0.136.0' };

test('all checks pass', async () => {
  const r = await checkHealth({ ...base, claudePath: claude(), pluginRoot: plugin('0.136.0', 'both'), projectPath: repo().d });
  for (const k of ['claude', 'exo', 'specs', 'tree']) assert.equal(r[k].ok, true, k);
});

test('missing claude fails with a fix', async () => {
  const r = await checkHealth({ ...base, claudePath: '/nonexistent/claude', pluginRoot: plugin('0.136.0', 'docs') });
  assert.equal(r.claude.ok, false);
  assert.ok(r.claude.fix);
});

test('old or missing exo fails', async () => {
  const old = await checkHealth({ ...base, claudePath: claude(), pluginRoot: plugin('0.99.0', 'docs') });
  assert.equal(old.exo.ok, false);
  const newer = await checkHealth({ ...base, claudePath: claude(), pluginRoot: plugin('0.200.0', 'docs') });
  assert.equal(newer.exo.ok, true);
  const gone = await checkHealth({ ...base, claudePath: claude(), pluginRoot: join(tmp(), 'nope') });
  assert.equal(gone.exo.ok, false);
  assert.ok(gone.exo.fix);
});

test('specs setting must be docs or both', async () => {
  const bad = await checkHealth({ ...base, claudePath: claude(), pluginRoot: plugin('0.136.0', 'off') });
  assert.equal(bad.specs.ok, false);
  assert.ok(bad.specs.fix);
});

test('detached HEAD fails the tree check', async () => {
  const { d, git } = repo();
  git('checkout', '-q', '--detach');
  const r = await checkHealth({ ...base, claudePath: claude(), pluginRoot: plugin('0.136.0', 'docs'), projectPath: d });
  assert.equal(r.tree.ok, false);
});
