import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FLAGS = { '--fixtures': 'fixtures', '--live-check': 'live-check' };

function storedPluginRoot() {
  return readFileSync(join(homedir(), '.claude', 'exo', 'plugin-root'), 'utf8').trim();
}

export function resolveMode(argv, env, readPluginRoot = storedPluginRoot) {
  const modes = argv.filter((a) => a in FLAGS).map((a) => FLAGS[a]);
  if (modes.length > 1) throw new Error('Pick one of --fixtures or --live-check');
  const mode = modes[0] ?? 'live';
  if (env.CLAUDECODE && mode !== 'fixtures') {
    throw new Error(`Refusing ${mode} mode under CLAUDECODE; use --fixtures`);
  }
  return {
    mode,
    claudePath: env.EXO_HARNESS_CLAUDE || 'claude',
    pluginRoot: env.EXO_PLUGIN_ROOT || readPluginRoot(),
  };
}
