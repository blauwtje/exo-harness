import { spawn } from 'node:child_process';
import { classifyEnd, failingLine, nextRetry, bugCardOf } from './retry.mjs';
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
    entry.events = [];
    const hooked = { ...store, appendEvent: (id, ev) => { entry.events.push(ev); store.appendEvent(id, ev); touch(entry); } };
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
    const begin = async (mode) => {
      entry.events.length = 0;
      entry.ready = Promise.resolve(sessionStarter({ ...opts, mode, state, store: hooked, onTurn }));
      entry.sess = await entry.ready;
      touch(entry);
      return entry.sess;
    };
    try {
      await begin(opts.mode);
    } catch (err) {
      jobs.delete(job.id);
      syncCaffeine();
      throw err;
    }
    // why: Decision 10; only a session that ended on its own is judged, and only an infrastructure failure or a repeated line is acted on, never a stop, limit hit or model error.
    const settle = async () => {
      for (;;) {
        const end = await entry.sess.done;
        const kind = end.reason ? null : classifyEnd(job, entry.events);
        if (kind !== 'infra' && kind !== 'loop') return end;
        (job.failures ??= []).push(failingLine(entry.events));
        const next = nextRetry(job);
        if (!next.retry) {
          if (next.bugCard) job.bugCard = bugCardOf(job);
          store.save(state);
          return end;
        }
        store.save(state);
        await new Promise((r) => setTimeout(r, next.waitMs));
        if (entry.stopped) return { ...end, reason: 'stopped' };
        // why: a stream that got as far as init holds its session id, so the retry resumes it instead of reusing the id.
        const started = opts.mode === 'resume' || entry.events.some((e) => e?.type === 'system');
        try { await begin(started ? 'resume' : 'start'); } catch { return end; }
      }
    };
    const done = settle().then((end) => {
      clearTimeout(entry.timer);
      jobs.delete(job.id);
      syncCaffeine();
      return end;
    });
    return {
      get pid() { return entry.sess.pid; },
      get pgid() { return entry.sess.pgid; },
      done,
      send: (t) => entry.sess.send(t),
      answer: (id, r) => entry.sess.answer(id, r),
      end: () => entry.sess.end(),
      stop: () => entry.sess.stop(),
    };
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
      entry.stopped = true;
      await entry.ready.catch(() => {});
      if (!entry.sess) return;
      entry.sess.stop();
      await entry.sess.done;
    },
    async stopAll() {
      await Promise.all([...jobs.keys()].map((id) => this.stop(id)));
    },
    caffeinated: () => caffeine !== null,
  };
}
