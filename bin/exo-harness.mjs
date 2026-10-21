#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/daemon/app.mjs';
import { dataDir } from '../src/daemon/data-dir.mjs';
import { resolveMode } from '../src/daemon/mode.mjs';

const { mode, claudePath, pluginRoot } = resolveMode(process.argv.slice(2), process.env);
// why: the real daemon reads the user's statusline cache for usage (Decision 6); the home comes from the env so a fixtures run can point it at a temp dir.
const statuslinePath = join(process.env.HOME || homedir(), '.cache', 'exo', 'statusline-rate-limits.json');
// why: the acceptance script needs the offline probe to fail on demand; this seam exists only in --fixtures mode, so a normal run can never be held offline by an env var.
const offlineFlag = mode === 'fixtures' ? process.env.EXO_FIXTURE_OFFLINE_FLAG : null;
const offlineOptions = offlineFlag
  ? { fetch: async () => { if (existsSync(offlineFlag)) throw new Error('offline'); }, intervalMs: 200 }
  : {};
const app = createApp({
  dataDir: dataDir(), claudePath, pluginRoot, distDir: fileURLToPath(new URL('../dist', import.meta.url)), statuslinePath, offlineOptions,
});
const { url } = await app.start();
console.log(`exo-harness: ${url}`);

const quit = () => app.close().finally(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
