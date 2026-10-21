import { spawn } from 'node:child_process';
import { loadStages } from './stages.mjs';
import { startSession } from './session.mjs';

const defaultCaffeinate = () => spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });

export function createSupervisor({
  store, state, spawnCaffeinate = defaultCaffeinate, onNeedsYou = () => {}, sessionStarter = startSession,
}) {
  const jobs = new Map();
  let caffeine = null;

  const syncCaffeine = () => {
    const awake = [...jobs.values()].some((j) => !j.job.stalled);
    if (awake && !caffeine) {
      caffeine = spawnCaffeinate();
      caffeine?.on?.('error', () => {});
    } else if (!awake && caffeine) {
      caffeine.kill();
      caffeine = null;
    }
  };

  const touch = (entry) => {
    clearTimeout(entry.timer);
    if (entry.job.stalled) {
      entry.job.stalled = false;
      store.save(state);
    }
    entry.timer = setTimeout(() => {
      entry.job.stalled = true;
      store.save(state);
      syncCaffeine();
    }, entry.stallMs);
    entry.timer.unref();
    syncCaffeine();
  };

  const flush = (entry) => {
    while (!entry.held && entry.pending.length) entry.sess.send(entry.pending.shift());
  };

  async function start(opts) {
    const { job } = opts;
    const stage = loadStages().stages[job.stage];
    const entry = {
      job, pending: [], held: false, turns: 0, cap: opts.maxTotalTurns ?? stage.maxTotalTurns,
      stallMs: opts.stallMs ?? stage.stallMs,
    };
    const hooked = { ...store, appendEvent: (id, ev) => { store.appendEvent(id, ev); touch(entry); } };
    const onTurn = (turn) => {
      entry.turns += turn.event?.num_turns ?? 0;
      if (entry.turns >= entry.cap && !entry.held) {
        entry.held = true;
        job.needsYou = { reason: 'turn-cap', turns: entry.turns, options: ['continue', 'stop'] };
        store.save(state);
        onNeedsYou(job, job.needsYou);
      }
      opts.onTurn?.(turn);
    };
    jobs.set(job.id, entry);
    entry.sess = await sessionStarter({ ...opts, state, store: hooked, onTurn });
    touch(entry);
    entry.sess.done.then(() => {
      clearTimeout(entry.timer);
      jobs.delete(job.id);
      syncCaffeine();
    });
    return entry.sess;
  }

  return {
    start,
    send(jobId, text) {
      const entry = jobs.get(jobId);
      if (!entry) return false;
      entry.pending.push(text);
      flush(entry);
      return true;
    },
    continue(jobId) {
      const entry = jobs.get(jobId);
      if (!entry?.held) return false;
      entry.cap += loadStages().stages[entry.job.stage].maxTotalTurns;
      entry.held = false;
      delete entry.job.needsYou;
      store.save(state);
      flush(entry);
      return true;
    },
    async stop(jobId) {
      const entry = jobs.get(jobId);
      if (!entry) return;
      entry.pending.length = 0;
      entry.sess.stop();
      await entry.sess.done;
    },
    async stopAll() {
      await Promise.all([...jobs.keys()].map((id) => this.stop(id)));
    },
    caffeinated: () => caffeine !== null,
  };
}
