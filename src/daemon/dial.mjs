import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const FILE = '.claude/exo.local.json';
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const refuse = (refusal, text) => ({ refusal, text });

export async function setBudget({ project, value, pluginRoot, git = exec, run = exec }) {
  if (typeof value !== 'string' || !VALUE.test(value)) return refuse('bad-value', `${String(value)} is not a budget value`);
  const ignored = await git('git', ['-C', project.path, 'check-ignore', FILE]).then(() => true, () => false);
  if (!ignored) return refuse('not-ignored', `${FILE} is not git-ignored in this project, so the budget was not written. Add it to .gitignore and try again.`);
  const script = join(pluginRoot, 'skills/configure/scripts/settings.mjs');
  try {
    await run(process.execPath, [script, 'set', 'budget', value, '--scope', 'local'], { cwd: project.path });
  } catch (e) {
    return refuse('write-failed', String(e.stderr || e.message).trim());
  }
  return { ok: true };
}
