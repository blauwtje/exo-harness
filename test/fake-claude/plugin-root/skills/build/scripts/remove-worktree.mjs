// why: --kept keeps the worktree's .exo/ under <run>/.exo/kept/<name>/ before git removes the worktree.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const worktree = flag('--worktree');
const run = flag('--run');
if (worktree === undefined || run === undefined) {
  process.stderr.write("remove-worktree: flags '--worktree' and '--run' are required\n");
  process.exit(2);
}
try {
  if (args.includes('--kept') && existsSync(join(worktree, '.exo'))) {
    const kept = join(run, '.exo', 'kept', basename(worktree));
    mkdirSync(kept, { recursive: true });
    cpSync(join(worktree, '.exo'), kept, { recursive: true });
  }
  execFileSync('git', ['-C', run, 'worktree', 'remove', '--force', worktree], { stdio: 'pipe' });
} catch (error) {
  process.stderr.write(`remove-worktree: git refused to remove '${worktree}': ${error.message}\n`);
  process.exit(1);
}
process.stdout.write(`removed '${worktree}'\n`);
