import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkInit } from './invariants.mjs';
import { killGroup } from './session.mjs';
import { parseLine } from './stream.mjs';

const KEYS = ['phase', 'stage', 'runRoot', 'branch', 'task', 'landed', 'total', 'reason'];
const FINAL = ['passed', 'landed', 'parked', 'stopped', 'refused', 'crashed'];

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const readState = (runRoot, id) => {
  for (const d of ['run', 'kept']) {
    try { return JSON.parse(readFileSync(join(runRoot, '.exo', d, id, 'state.json'), 'utf8')); } catch { continue; }
  }
  return null;
};
const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// why: the newest log dir whose utc stamp is not before the run's start belongs to this run, not an older one.
function logDir(st) {
  const base = join(st.runRoot, '.exo', 'run-plan', basename(st.plan ?? '').replace(/\.md$/, ''));
  try {
    const stamps = readdirSync(base).filter((s) => s >= stampOf(st.startedAt)).sort();
    return stamps.length ? join(base, stamps.at(-1)) : null;
  } catch { return null; }
}

export function watchRun({ job, runRoot, store, state, onChange = () => {}, intervalMs = 1000 }) {
  const offsets = new Map();
  const checked = new Set();
  let dir = null;
  let stopped = false;

  const initCheck = (name, event, st) => {
    if (checked.has(name) || event?.type !== 'system' || event.subtype !== 'init') return;
    checked.add(name);
    // why: only the key and the cwd are this check's contract; the mode and plugins are the run's own.
    const { mismatches } = checkInit(event, { permissionMode: event.permissionMode, cwd: st.runRoot });
    const bad = mismatches.filter((m) => m === 'apiKeySource' || m === 'cwd');
    if (!bad.length) return;
    job.initMismatches = bad;
    job.outcome = 'invariant';
    if (st.pid) killGroup(st.pid, 'SIGTERM');
    stopped = true;
  };

  const tail = (st) => {
    const next = logDir(st);
    if (next !== dir) { dir = next; offsets.clear(); checked.clear(); }
    if (!dir) return false;
    let changed = false;
    for (const name of readdirSync(dir).filter((n) => /^iter-.*\.log$/.test(n)).sort()) {
      const from = offsets.get(name) ?? 0;
      const file = join(dir, name);
      const size = statSync(file).size;
      if (size <= from) continue;
      const buf = Buffer.alloc(size - from);
      const fd = openSync(file, 'r');
      try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
      const text = buf.toString('utf8');
      const whole = text.slice(0, text.lastIndexOf('\n') + 1);
      offsets.set(name, from + Buffer.byteLength(whole));
      for (const raw of whole.split('\n').filter(Boolean)) {
        const rec = parseLine(raw);
        store.appendEvent(job.id, { ...(rec.event ?? { kind: 'malformed', raw }), log: name });
        initCheck(name, rec.event, st);
        changed = true;
      }
    }
    return changed;
  };

  const poll = () => {
    if (stopped) return;
    const st = readState(runRoot, job.run.id);
    if (!st) return;
    const run = { ...job.run };
    for (const k of KEYS) run[k] = st[k] ?? null;
    run.alive = !FINAL.includes(st.phase) && st.pid ? alive(st.pid) : false;
    const moved = JSON.stringify(run) !== JSON.stringify(job.run);
    job.run = run;
    let logged = false;
    try { logged = tail(st); } catch { logged = false; }
    if (moved || logged || job.initMismatches) { store.save(state); onChange(job); }
    if (stopped || (FINAL.includes(st.phase) && !logged)) clearInterval(timer);
  };

  const timer = setInterval(poll, intervalMs);
  timer.unref();
  poll();
  return { stop() { stopped = true; clearInterval(timer); } };
}
