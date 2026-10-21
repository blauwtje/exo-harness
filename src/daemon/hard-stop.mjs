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

// why: Decision 8: past hardStopFiveHour an exo run is stopped only at a task boundary (its landed count rising), so no task is cut mid-way and --resume continues it; -p jobs are never in `runs`.
export function watchHardStop({ getUsage, settings, runs, kill = killGroup, intervalMs = 1000 }) {
  const baseline = new Map();
  const signalled = new Set();
  const step = (job) => {
    if (signalled.has(job.id) || !job.run?.id || !job.runRoot) return;
    const st = readState(job);
    if (!st || FINAL_PHASES.includes(st.phase) || typeof st.landed !== 'number') return;
    if (!baseline.has(job.id)) { baseline.set(job.id, st.landed); return; }
    if (st.landed <= baseline.get(job.id) || !validPid(st.pid)) return;
    signalled.add(job.id);
    job.outcome = 'hard-stop';
    kill(st.pid, 'SIGTERM');
  };
  const tick = () => {
    const limit = (typeof settings === 'function' ? settings() : settings).hardStopFiveHour;
    const used = getUsage()?.five_hour?.utilization;
    if (typeof used !== 'number' || used < limit) { baseline.clear(); return; }
    for (const job of runs()) step(job);
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { tick, stop() { clearInterval(timer); } };
}
