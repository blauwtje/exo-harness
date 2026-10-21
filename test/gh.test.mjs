import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkGhArgs } from '../src/daemon/gh.mjs';

const root = join(import.meta.dirname, '..');

test('allowlisted commands pass', () => {
  for (const args of [['repo', 'list'], ['repo', 'clone', 'a/b'], ['repo', 'view', 'a/b'], ['pr', 'list'], ['pr', 'view', '1'], ['api', 'repos/a/b'], ['api', '-H', 'Accept: x', 'user'], ['auth', 'status']]) {
    assert.doesNotThrow(() => checkGhArgs(args), args.join(' '));
  }
});

test('everything else is rejected', () => {
  for (const args of [['repo', 'delete', 'a/b'], ['pr', 'merge', '1'], ['issue', 'list'], ['auth', 'token'], [], ['api', '-X', 'DELETE', 'x'], ['api', '--method=DELETE', 'x'], ['api', '-XPOST', 'x'], ['api', '-f', 'a=b', 'x'], ['api', '--input', 'f', 'x'], ['api', '-X', 'GET', 'x']]) {
    assert.throws(() => checkGhArgs(args), args.join(' '));
  }
  assert.throws(() => checkGhArgs('repo list'));
  assert.throws(() => checkGhArgs(['repo', 'list', 1]));
});

function files(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  return entries.flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('source never contains destructive gh invocations', () => {
  const bad = /repo delete|-X\s*DELETE|--method[ =]DELETE/i;
  for (const f of [...files(join(root, 'src')), ...files(join(root, 'bin'))]) {
    assert.ok(!bad.test(readFileSync(f, 'utf8')), `${f} contains a destructive gh call`);
  }
});
