const CONSECUTIVE_FAILURES_TO_HOLD = 2;
const defaultFetch = () => fetch('https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });

export function createOfflineProbe({ fetch: probe = defaultFetch, queue, intervalMs = 15000, setTimer = setTimeout }) {
  let stopped = false;
  let failures = 0;
  const offlineHoldActive = () => queue.snapshot().pauses.some((p) => p.reason === 'offline');
  async function check() {
    const ok = await Promise.resolve().then(probe).then(() => true, () => false);
    if (stopped) return;
    failures = ok ? 0 : failures + 1;
    if (failures >= CONSECUTIVE_FAILURES_TO_HOLD && !offlineHoldActive()) queue.pause({ reason: 'offline', since: Date.now() });
    if (ok && offlineHoldActive()) queue.resume('offline');
  }
  function loop() {
    return check().finally(() => { if (!stopped) setTimer(loop, intervalMs); });
  }
  return {
    check,
    start() { return loop(); },
    stop() { stopped = true; },
  };
}
