import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function build() {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'deck-dist-')));
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error', '--outDir', out, '--emptyOutDir'], { stdio: 'inherit' });
  process.env.EXO_E2E_DIST = out;
  return () => rmSync(out, { recursive: true, force: true });
}
