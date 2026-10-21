import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const DONE = '.archived';

export const archiveDir = (dataDir, jobId) => join(dataDir, 'jobs', jobId, 'run');

// why: the marker is written last, so a half-copied archive never unlocks removal.
export async function archiveRun(dataDir, jobId, { runDir, runPlanDir }) {
  const dest = archiveDir(dataDir, jobId);
  await mkdir(dest, { recursive: true });
  await cp(runDir, join(dest, 'state'), { recursive: true });
  if (runPlanDir) await cp(runPlanDir, join(dest, 'run-plan'), { recursive: true });
  await writeFile(join(dest, DONE), `${new Date().toISOString()}\n`);
  return dest;
}

// why: the plain git remove command deletes .exo/ with exit 0; only exo's --kept script keeps it (M10).
export async function removeWorktree(pluginRoot, worktree, { checkout, archived }) {
  const marker = archived && join(archived, DONE);
  if (!marker || !(await access(marker).then(() => true, () => false))) {
    throw new Error(`refusing to remove '${worktree}': run evidence is not archived`);
  }
  const script = join(pluginRoot, 'skills', 'build', 'scripts', 'remove-worktree.mjs');
  const { stdout } = await run(process.execPath, [script, '--worktree', worktree, '--run', checkout, '--kept']);
  return stdout;
}
