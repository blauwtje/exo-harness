const LIMIT_ERRORS = new Set(['rate_limit', 'usage_limit_reached']);

export function detectLimit(event) {
  const info = event?.type === 'rate_limit_event' ? event.rate_limit_info : null;
  if (info?.status === 'rejected') {
    const type = info.rateLimitType ?? null;
    return { rateLimitType: type, resetsAt: info.resetsAt ?? info.unifiedWindows?.[type]?.resetsAt ?? null };
  }
  if (event?.type !== 'assistant' || ![event.error, event.apiError, event.api_error].some((e) => LIMIT_ERRORS.has(e))) return null;
  const params = (event.apiErrorParams ?? event.api_error_params)?.rate_limit_info ?? event.quotaLimits ?? event;
  return { rateLimitType: params.rateLimitType ?? null, resetsAt: params.resetsAt ?? null };
}

const defaultJitter = () => 5000 + Math.floor(Math.random() * 55001);

export function createLimitTimer({ queue, now = Date.now, setTimer = setTimeout, jitterMs = defaultJitter }) {
  const timerGenerationByWindow = new Map();
  function schedule(type, resetsAt) {
    const mine = (timerGenerationByWindow.get(type) ?? 0) + 1;
    timerGenerationByWindow.set(type, mine);
    if (typeof resetsAt !== 'number') return;
    const delay = Math.max(0, resetsAt * 1000 + jitterMs() - now());
    setTimer(() => {
      if (mine === timerGenerationByWindow.get(type)) queue.resume('limit', type);
    }, delay);
  }
  return {
    hit({ rateLimitType = null, resetsAt = null }) {
      queue.pause({ reason: 'limit', rateLimitType, resetsAt });
      schedule(rateLimitType, resetsAt);
    },
    restore() {
      for (const p of queue.snapshot().pauses) if (p.reason === 'limit') schedule(p.rateLimitType ?? null, p.resetsAt);
    },
  };
}
