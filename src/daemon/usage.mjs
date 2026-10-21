// Browser-safe module shared by the daemon and the deck: the one set of final job statuses.
export const FINAL_STATUSES = new Set(['done', 'crashed', 'stopped', 'refused']);

export function parseRateLimitEvent(event, observedAt = Date.now()) {
  const info = event?.type === 'rate_limit_event' ? event.rate_limit_info : null;
  if (!info) return null;
  const windows = {};
  for (const [type, w] of Object.entries(info.unifiedWindows ?? {})) {
    windows[type] = { utilization: w.utilization, resetsAt: w.resetsAt, status: w.status ?? (type === info.rateLimitType ? info.status : null) };
  }
  return {
    status: info.status,
    rateLimitType: info.rateLimitType,
    observedAt,
    windows,
    overage: {
      status: info.overageStatus ?? null,
      isUsingOverage: info.isUsingOverage ?? false,
      disabledReason: info.overageDisabledReason ?? null,
    },
  };
}

export function parseResultUsage(event) {
  if (event?.type !== 'result') return null;
  const usage = event.usage ?? {};
  return {
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheCreation5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
  };
}
