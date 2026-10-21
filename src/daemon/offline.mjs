// why: Decision 14; a failed probe holds the queue, the next success resumes it, and the daemon keeps answering the deck meanwhile.
const defaultFetch = () => fetch('https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });

export function createOfflineProbe({ fetch: probe = defaultFetch, queue, intervalMs = 15000, setTimer = setTimeout }) {
  let stopped = false;
  let failures = 0;
  // why: the pause is persisted, so after a restart the probe reads it back instead of trusting its own memory.
  const held = () => queue.snapshot().pauses.some((p) => p.reason === 'offline');
  async function check() {
    const ok = await Promise.resolve().then(probe).then(() => true, () => false);
    if (stopped) return;
    failures = ok ? 0 : failures + 1;
    // why: Decision 14; the queue holds only after two failed probes in a row, so one dropped packet never pauses it.
    if (failures >= 2 && !held()) queue.pause({ reason: 'offline', since: Date.now() });
    if (ok && held()) queue.resume('offline');
  }
  function loop() {
    return check().finally(() => { if (!stopped) setTimer(loop, intervalMs); });
  }
  return {
    check,
    // why: start resolves after the first probe so the first drain never starts a job while offline.
    start() { return loop(); },
    stop() { stopped = true; },
  };
}
