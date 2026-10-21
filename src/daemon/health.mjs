import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAuth } from './auth.mjs';
import { loadStages } from './stages.mjs';

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() }));
  });

const result = (ok, detail, fix = '') => ({ ok, detail, fix });
const INSTALL_EXO = 'Install or update the exo plugin, then run /exo:configure';

function atLeast(version, min) {
  const a = String(version).split('.').map(Number);
  const b = String(min).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

async function checkExo(pluginRoot, minExoVersion) {
  let version;
  try {
    version = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8')).version;
  } catch {
    return result(false, `exo not found at ${pluginRoot}`, INSTALL_EXO);
  }
  if (typeof version !== 'string' || !atLeast(version, minExoVersion)) {
    return result(false, `exo ${version} is older than ${minExoVersion}`, `Update exo to ${minExoVersion} or newer`);
  }
  return result(true, `exo ${version}`);
}

async function checkSpecs(pluginRoot) {
  const script = join(pluginRoot, 'skills', 'configure', 'scripts', 'settings.mjs');
  const { err, stdout } = await run('node', [script, 'get', 'specs']);
  const fix = 'Run: node <plugin-root>/skills/configure/scripts/settings.mjs set specs docs';
  if (err) return result(false, 'could not read the exo specs setting', fix);
  const ok = stdout === 'docs' || stdout === 'both';
  return result(ok, `specs setting is ${JSON.stringify(stdout)}`, ok ? '' : fix);
}

async function checkTree(projectPath) {
  if (!projectPath) return result(true, 'no project to check');
  const { err, stdout } = await run('git', ['-C', projectPath, 'symbolic-ref', '--short', 'HEAD']);
  if (err) return result(false, `${projectPath} has no checked-out branch (detached HEAD or not a git repo)`, 'Check out a branch in the project');
  return result(true, `on branch ${stdout}`);
}

export async function checkHealth({ claudePath = 'claude', pluginRoot, projectPath, minExoVersion = loadStages().minExoVersion, parentEnv } = {}) {
  const [auth, exo, specs, tree] = await Promise.all([
    checkAuth({ claudePath, ...(parentEnv && { parentEnv }) }),
    checkExo(pluginRoot, minExoVersion),
    checkSpecs(pluginRoot),
    checkTree(projectPath),
  ]);
  return { claude: result(auth.ok, auth.reason, auth.fix), exo, specs, tree };
}
