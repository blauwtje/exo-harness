import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { access, copyFile, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { childEnv } from './child-env.mjs';

const exec = promisify(execFile);
const TAIL_CHARS = 2000;
const LOCKFILES = [
  ['package-lock.json', ['npm', 'ci']],
  ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
  ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
];

const exists = (p) => access(p).then(() => true, () => false);
const readJson = (p) => readFile(p, 'utf8').then(JSON.parse, () => ({}));

async function envSetting(mainCheckout) {
  for (const name of ['exo.local.json', 'exo.json']) {
    const conf = await readJson(path.join(mainCheckout, '.claude', name));
    if (conf && typeof conf === 'object' && 'env' in conf) return conf.env;
  }
  return 'ask';
}

async function isIgnored(mainCheckout, name) {
  try {
    await exec('git', ['check-ignore', '-q', '--', name], { cwd: mainCheckout });
    return true;
  } catch {
    return false;
  }
}

function envValues(text) {
  const lines = text.split('\n').filter((line) => line.includes('='));
  const values = lines.map((line) => line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2'));
  return values.filter(Boolean);
}

async function copyOne(name, worktree, mainCheckout) {
  const src = path.join(mainCheckout, name);
  if (!(await lstat(src)).isFile() || !(await isIgnored(mainCheckout, name))) return [];
  if (await exists(path.join(worktree, name))) return [];
  await copyFile(src, path.join(worktree, name), constants.COPYFILE_EXCL);
  return envValues(await readFile(src, 'utf8'));
}

async function copyEnvFiles(worktree, mainCheckout) {
  const names = (await readdir(mainCheckout)).filter((name) => /^\.env/.test(name));
  const secrets = [];
  for (const name of names) secrets.push(...(await copyOne(name, worktree, mainCheckout)));
  return secrets;
}

async function setupArgv(project, worktree) {
  if (typeof project?.setup === 'string' && project.setup.trim()) return project.setup.trim().split(/\s+/);
  for (const [file, argv] of LOCKFILES) if (await exists(path.join(worktree, file))) return argv;
  return null;
}

const redact = (text, secrets) => secrets.reduce((t, s) => t.split(s).join('[redacted]'), text);

export async function runSetup(project, worktree, mainCheckout, parentEnv = process.env) {
  const secrets = (await envSetting(mainCheckout)) === 'copy' ? await copyEnvFiles(worktree, mainCheckout) : [];
  const argv = await setupArgv(project, worktree);
  if (!argv) return { ok: true, command: null, tail: '' };
  const command = argv.join(' ');
  const output = (r) => redact(`${r.stdout ?? ''}${r.stderr ?? ''}`, secrets).slice(-TAIL_CHARS);
  try {
    const r = await exec(argv[0], argv.slice(1), { cwd: worktree, env: childEnv('exo-run', parentEnv), timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, command, tail: output(r) };
  } catch (err) {
    const tail = err.stdout === undefined ? redact(String(err.message), secrets) : output(err);
    return { ok: false, command, tail };
  }
}
