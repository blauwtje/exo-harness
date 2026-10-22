import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINAL_PHASES } from './exo-run.mjs';
import { killGroup } from './session.mjs';

const readState = (job) => {
  for (const d of ['run', 'kept']) {
    try { return JSON.parse(readFileSync(join(job.runRoot, '.exo', d, job.run.id, 'state.json'), 'utf8')); } catch { continue; }
  }
  return null;
};
const validPid = (pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid;

export function watchHardStop({ getUsage, settings, runs, usageOf = null, kill = killGroup, intervalMs = 1000 }) {
  const baseline = new Map();
  const signalled = new Set();
  const stopAtTaskBoundary = (job) => {
    if (signalled.has(job.id) || !job.run?.id || !job.runRoot) return;
    const st = readState(job);
    if (!st || FINAL_PHASES.includes(st.phase) || typeof st.landed !== 'number') return;
    if (!baseline.has(job.id)) { baseline.set(job.id, st.landed); return; }
    if (st.landed <= baseline.get(job.id) || !validPid(st.pid)) return;
    signalled.add(job.id);
    job.outcome = 'hard-stop';
    kill(st.pid, 'SIGTERM');
  };
  const overLimit = (usage, limit) => {
    const used = usage?.five_hour?.utilization;
    return typeof used === 'number' && used >= limit;
  };
  const tickShared = (limit) => {
    if (!overLimit(getUsage(), limit)) { baseline.clear(); return; }
    for (const job of runs()) stopAtTaskBoundary(job);
  };
  const tickPerJob = (limit) => {
    for (const job of runs()) {
      if (overLimit(usageOf(job), limit)) stopAtTaskBoundary(job);
      else baseline.delete(job.id);
    }
  };
  const tick = () => {
    const limit = (typeof settings === 'function' ? settings() : settings).hardStopFiveHour;
    return usageOf ? tickPerJob(limit) : tickShared(limit);
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { tick, stop() { clearInterval(timer); } };
}
