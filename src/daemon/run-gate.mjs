import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// why: argv arrays only, so a branch or file name never reaches a shell.
const git = (cwd, args) =>
  new Promise((resolve) => {
    execFile('git', ['--literal-pathspecs', ...args], { cwd, timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
  });

const text = (path) => readFile(path, 'utf8').catch(() => '');
const lines = (s) => s.split('\n').filter(Boolean);

async function conflictFiles(runRoot, base, branch) {
  const r = await git(runRoot, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch]);
  if (r.code !== 1) return [];
  return lines(r.stdout).slice(1);
}

export async function gateDetails(runDir, runRoot, ...[base, branch]) {
  const [gates, report, denied, stat, names] = await Promise.all([
    text(join(runDir, 'gates.md')),
    text(join(runDir, 'report.md')),
    text(join(runDir, 'denied.txt')),
    git(runRoot, ['diff', '--stat', `${base}...${branch}`]),
    git(runRoot, ['diff', '--name-only', `${base}...${branch}`]),
  ]);
  return {
    gates: lines(gates),
    diffStat: stat.stdout,
    files: lines(names.stdout),
    reportHead: report.split('\n').slice(0, 15).join('\n'),
    denied,
    conflicts: await conflictFiles(runRoot, base, branch),
  };
}

export async function fileDiff(runRoot, ...[base, branch, file]) {
  const names = await git(runRoot, ['diff', '--name-only', `${base}...${branch}`]);
  if (typeof file !== 'string' || !lines(names.stdout).includes(file)) throw new Error('file is not in the branch diff');
  return (await git(runRoot, ['diff', `${base}...${branch}`, '--', file])).stdout;
}

export async function finishLand(checkout, base, branch) {
  const action = `clean ${checkout} and switch it to ${base}`;
  const status = await git(checkout, ['status', '--porcelain', '--untracked-files=no']);
  const head = await git(checkout, ['symbolic-ref', '--short', 'HEAD']);
  if (status.err || head.err || status.stdout.trim() || head.stdout.trim() !== base) {
    return { ok: false, action, text: status.stdout.trim() || head.stderr.trim() || status.stderr.trim() || `main checkout is not on ${base}` };
  }
  const old = (await git(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
  const merged = await git(checkout, ['merge', '--ff-only', branch]);
  if (merged.err) return { ok: false, action, text: (merged.stderr || merged.stdout).trim() };
  const next = (await git(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
  return { ok: true, range: `${old}..${next}` };
}
