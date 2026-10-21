import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const git = async (cwd, args) => (await run('git', args, { cwd })).stdout.trim();

export function slugify(title) {
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return slug || 'card';
}

async function baseRef(repo) {
  const remotes = (await git(repo, ['remote'])).split('\n');
  if (remotes.includes('origin')) {
    return git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  }
  return git(repo, ['symbolic-ref', '--short', 'HEAD']);
}

async function excludeWorktrees(repo) {
  const file = path.resolve(repo, await git(repo, ['rev-parse', '--git-path', 'info/exclude']));
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current.split('\n').includes('.worktrees/')) return;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}.worktrees/\n`);
}

const exists = (p) => access(p).then(() => true, () => false);

export async function createWorktree(repo, title) {
  const base = await baseRef(repo);
  await excludeWorktrees(repo);
  const slug0 = slugify(title);
  let slug = slug0;
  for (let n = 2; await exists(path.join(repo, '.worktrees', slug)); n++) {
    slug = `${slug0}-${n}`;
  }
  const dir = path.join(repo, '.worktrees', slug);
  await mkdir(path.dirname(dir), { recursive: true });
  await git(repo, ['worktree', 'add', '--detach', dir, base]);
  return { path: dir, slug, base };
}
