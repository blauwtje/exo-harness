import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadStages } from './stages.mjs';
import { FINAL_STATUSES as FINAL } from './usage.mjs';

const run = promisify(execFile);
const IDLE = new Set(['queued']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lstartOf = (pid) =>
  run('ps', ['-o', 'lstart=', '-p', String(pid)]).then((r) => r.stdout.trim() || null, () => null);

async function groupMembers(pgid) {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,pgid=']);
  return stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([, g]) => g === pgid).map(([p]) => p);
}

const signalGroup = (pgid, signal) => {
  try { process.kill(-pgid, signal); } catch {}
};

async function ownedGroup(job) {
  if (!Number.isInteger(job.pgid) || job.pgid <= 1) return false;
  const members = await groupMembers(job.pgid);
  if (!members.length) return false;
  if (!members.includes(job.pgid)) return true;
  return job.startedAtLstart != null && (await lstartOf(job.pgid)) === job.startedAtLstart;
}

async function killOldGroup(job, graceMs) {
  if (!(await ownedGroup(job))) return true;
  signalGroup(job.pgid, 'SIGTERM');
  const until = Date.now() + graceMs;
  while (Date.now() < until && (await groupMembers(job.pgid)).length) await sleep(50);
  if ((await groupMembers(job.pgid)).length) {
    signalGroup(job.pgid, 'SIGKILL');
    for (let i = 0; i < 40 && (await groupMembers(job.pgid)).length; i++) await sleep(50);
  }
  return (await groupMembers(job.pgid)).length === 0;
}

const claudeSessionExists = (job, configDir) => {
  const dir = join(configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', job.worktree.replace(/[^A-Za-z0-9]/g, '-'));
  return existsSync(join(dir, `${job.sessionId}.jsonl`));
};

export async function reconcile({
  store, state, supervisor, sessionExists = claudeSessionExists, configDirOf = () => null, graceMs = loadStages().killGraceMs, skip = () => false, ...sessionOpts
}) {
  const results = [];
  for (const job of state.jobs) {
    if (FINAL.has(job.status) || IDLE.has(job.status) || job.stage === 'run' || skip(job)) continue;
    const crash = (why) => {
      Object.assign(job, { status: 'crashed', crashReason: why });
      delete job.pid;
      delete job.pgid;
      store.save(state);
      results.push({ jobId: job.id, outcome: 'crashed', reason: why });
    };
    if (!(await killOldGroup(job, graceMs))) { crash('old-group-alive'); continue; }
    if (!job.worktree || !existsSync(job.worktree)) { crash('worktree-missing'); continue; }
    if (!job.sessionId || !sessionExists(job, configDirOf(job))) { crash('session-missing'); continue; }
    const card = state.cards.find((c) => c.id === job.cardId);
    if (!card) { crash('card-missing'); continue; }
    try {
      await supervisor.start({ ...sessionOpts, store, state, job, card, worktree: job.worktree, pluginRoot: job.pluginRoot, mode: 'resume' });
      results.push({ jobId: job.id, outcome: 'resumed' });
    } catch (e) {
      crash(`resume-failed: ${e.message}`);
    }
  }
  return results;
}
