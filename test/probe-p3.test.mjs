import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const probe = new URL('../scripts/probe-p3.mjs', import.meta.url).pathname;
const fakeCli = new URL('./fake-claude/plugin-root/skills/build/scripts/exo-cli.mjs', import.meta.url).pathname;
const run = (env, facts) => {
  const { CLAUDECODE, ...rest } = process.env;
  return spawnSync(process.execPath, [probe, '--exo', fakeCli, '--facts', facts], {
    encoding: 'utf8', env: { ...rest, ...env }, timeout: 60000,
  });
};
const factsFile = () => join(mkdtempSync(join(tmpdir(), 'probe-facts-')), 'facts.md');

test('F-3-01 the probe runs the fake exo from linked worktrees and writes ## Probe P3', () => {
  const facts = factsFile();
  writeFileSync(facts, '# Facts\n\n## Other\n\n- keep\n');
  const scenario = JSON.stringify({ id: 'p-1', phase: 'parked', gates: [{ source: 'land', action: 'approve land', reason: 'Land: local' }] });
  const r = run({ FAKE_EXO_SCENARIO: scenario }, facts);
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(facts, 'utf8');
  assert.match(text, /^## Probe P3$/m);
  assert.match(text, /Land: local: final phase `parked`/);
  assert.match(text, /Land: none: final phase `parked`/);
  assert.match(text, /gate: `- open: land: approve land/);
  assert.match(text, /## Other\n\n- keep/);
  const again = run({ FAKE_EXO_SCENARIO: scenario }, facts);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(facts, 'utf8').match(/^## Probe P3$/gm).length, 1);
});

test('F-3-01 the probe refuses under CLAUDECODE and writes nothing', () => {
  const facts = factsFile();
  const r = run({ CLAUDECODE: '1' }, facts);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing to run under CLAUDECODE/);
  assert.equal(existsSync(facts), false);
});
