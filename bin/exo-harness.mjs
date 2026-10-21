#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/daemon/app.mjs';
import { dataDir } from '../src/daemon/data-dir.mjs';
import { resolveMode } from '../src/daemon/mode.mjs';

const { claudePath, pluginRoot } = resolveMode(process.argv.slice(2), process.env);
const app = createApp({
  dataDir: dataDir(), claudePath, pluginRoot, distDir: fileURLToPath(new URL('../dist', import.meta.url)),
});
const { url } = await app.start();
console.log(`exo-harness: ${url}`);

const quit = () => app.close().finally(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
