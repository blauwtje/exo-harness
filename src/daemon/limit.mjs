// why: a limit hit pauses the queue until the window resets (Decision 9); resetsAt is epoch seconds, as the CLI reports it.
export function detectLimit(event) {
  const info = event?.type === 'rate_limit_event' ? event.rate_limit_info : null;
  if (info?.status === 'rejected') {
    const type = info.rateLimitType ?? null;
    return { rateLimitType: type, resetsAt: info.resetsAt ?? info.unifiedWindows?.[type]?.resetsAt ?? null };
  }
  if (event?.type === 'assistant' && event.error === 'usage_limit_reached') {
    return { rateLimitType: event.rateLimitType ?? null, resetsAt: event.resetsAt ?? null };
  }
  return null;
}

const defaultJitter = () => 5000 + Math.floor(Math.random() * 55001);

export function createLimitTimer({ queue, now = Date.now, setTimer = setTimeout, jitterMs = defaultJitter }) {
  let generation = 0;
  function schedule(resetsAt) {
    const mine = ++generation;
    if (typeof resetsAt !== 'number') return;
    const delay = Math.max(0, resetsAt * 1000 + jitterMs() - now());
    setTimer(() => {
      if (mine === generation) queue.resume('limit');
    }, delay);
  }
  return {
    hit({ rateLimitType = null, resetsAt = null }) {
      queue.pause({ reason: 'limit', rateLimitType, resetsAt });
      schedule(resetsAt);
    },
    // why: after a restart the pause is read back from state.json and its timer must be armed again.
    restore() {
      const limit = queue.snapshot().pauses.find((p) => p.reason === 'limit');
      if (limit) schedule(limit.resetsAt);
    },
  };
}
