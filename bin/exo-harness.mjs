#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClaudeJsonPath } from '../src/daemon/accounts.mjs';
import { createApp } from '../src/daemon/app.mjs';
import { dataDir } from '../src/daemon/data-dir.mjs';
import { resolveMode } from '../src/daemon/mode.mjs';

const { mode, claudePath, pluginRoot } = resolveMode(process.argv.slice(2), process.env);
const statuslinePath = join(process.env.HOME || homedir(), '.cache', 'exo', 'statusline-rate-limits.json');
const fixturesOnlyOfflineFlagFile = mode === 'fixtures' ? process.env.EXO_FIXTURE_OFFLINE_FLAG : null;
const offlineOptions = fixturesOnlyOfflineFlagFile
  ? { fetch: async () => { if (existsSync(fixturesOnlyOfflineFlagFile)) throw new Error('offline'); }, intervalMs: 200 }
  : {};
const app = createApp({
  dataDir: dataDir(), claudePath, pluginRoot, distDir: fileURLToPath(new URL('../dist', import.meta.url)), statuslinePath, claudeJsonPath: defaultClaudeJsonPath(process.env, process.env.HOME || homedir()), offlineOptions,
});
const { url } = await app.start();
console.log(`exo-harness: ${url}`);

const quit = () => app.close().finally(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
