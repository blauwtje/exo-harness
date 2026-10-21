import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('F-2-12 F-2-14 C-03 the acceptance run passes end to end', () => {
  const script = fileURLToPath(new URL('../scripts/accept.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 60000 });
  assert.match(out, /accept: pass/);
});
