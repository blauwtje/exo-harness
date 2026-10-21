import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setBudget } from '../src/daemon/dial.mjs';

const pluginRoot = resolve('test/fake-claude/plugin-root');

function repo(ignore) {
  const dir = mkdtempSync(join(tmpdir(), 'dial-'));
  execFileSync('git', ['init', '-q', dir]);
  if (ignore) writeFileSync(join(dir, '.gitignore'), '.claude/exo.local.json\n');
  return { path: dir };
}

function withLog(fn) {
  const log = join(mkdtempSync(join(tmpdir(), 'dial-log-')), 'log');
  writeFileSync(log, '');
  process.env.FAKE_SETTINGS_LOG = log;
  const read = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return fn(read).finally(() => delete process.env.FAKE_SETTINGS_LOG);
}

test('F-4-11 an ignored local file gets the budget written with --scope local', () => withLog(async (read) => {
  const r = await setBudget({ project: repo(true), value: 'conservative', pluginRoot });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(read(), [{ key: 'budget', value: 'conservative', scope: 'local' }]);
}));

test('F-4-11 a file that is not git-ignored is refused and nothing is written', () => withLog(async (read) => {
  const r = await setBudget({ project: repo(false), value: 'conservative', pluginRoot });
  assert.equal(r.refusal, 'not-ignored');
  assert.match(r.text, /\.claude\/exo\.local\.json/);
  assert.deepEqual(read(), []);
}));

test('F-4-11 the check runs before the write and the write never uses another scope', () => withLog(async (read) => {
  const order = [];
  const git = async (cmd, args) => { order.push(['git', args.slice(2)]); };
  const run = async (cmd, args) => { order.push(['run', args.slice(1)]); };
  await setBudget({ project: { path: '/p' }, value: 'x1', pluginRoot, git, run });
  assert.deepEqual(order, [['git', ['check-ignore', '.claude/exo.local.json']], ['run', ['set', 'budget', 'x1', '--scope', 'local']]]);
  const r = await setBudget({ project: { path: '/p' }, value: '--scope=user', pluginRoot, git, run });
  assert.equal(r.refusal, 'bad-value');
  assert.equal(order.length, 2);
  assert.deepEqual(read(), []);
}));
