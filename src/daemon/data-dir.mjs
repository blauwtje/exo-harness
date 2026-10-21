import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataDir(env = process.env) {
  const dir = env.EXO_HARNESS_DATA || join(homedir(), 'Library', 'Application Support', 'exo-harness');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}
