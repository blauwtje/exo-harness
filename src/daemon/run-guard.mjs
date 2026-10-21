import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { childEnv } from './child-env.mjs';
import { cliOf } from './stages.mjs';

const run = (cmd, args, cwd, env) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, env, timeout: 60000 }, (err, stdout) => resolve({ err, stdout: String(stdout ?? '') }));
  });

const field = (text, name) =>
  text.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\**${name}:\\**\\s*\`?([^\`\\s]+)\`?\\s*$`, 'mi'))?.[1] ?? null;

export async function readPlan(brief) {
  const text = await readFile(brief, 'utf8');
  return { branch: field(text, 'Branch'), land: field(text, 'Land') };
}

// why: argv arrays only, so a branch name never reaches a shell.
export async function checkCollision(repo, branch) {
  if (!branch) return null;
  const ref = (r) => run('git', ['rev-parse', '--verify', '--quiet', r], repo);
  if (!(await ref(`refs/heads/${branch}`)).err) return 'local branch';
  if (!(await ref(`refs/remotes/origin/${branch}`)).err) return 'origin remote branch';
  const remote = await run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], repo);
  if (!remote.err && remote.stdout.trim()) return 'origin remote branch';
  const trees = await run('git', ['worktree', 'list', '--porcelain'], repo);
  if (trees.stdout.split('\n').some((l) => l === `branch refs/heads/${branch}`)) return 'git worktree';
  return null;
}

// why: exo gets the same scrubbed env as the run it checks for (parentEnv, not the raw process.env).
export async function checkProvider(pluginRoot, cwd, parentEnv = process.env) {
  const { err, stdout } = await run(process.execPath, [cliOf(pluginRoot), 'run', 'config'], cwd, childEnv('exo-run', parentEnv));
  const provider = stdout.match(/^defaults\.provider\s*=\s*"?([\w.-]+)"?/m)?.[1] ?? null;
  if (!err && provider === 'claude') return { ok: true, provider };
  return { ok: false, provider, text: `exo run config must print defaults.provider = "claude"; got ${provider ?? 'nothing'}` };
}

export async function runCwd({ project, pluginRoot, worktree, plan }) {
  const [p, r] = await Promise.all([realpath(project), realpath(pluginRoot)]);
  if (p !== r) return { cwd: worktree };
  if (plan.land !== 'local') return { refusal: 'land', text: 'the exo repo runs from its main checkout, so the brief must say Land: local' };
  return { cwd: project };
}
