import { p75 } from './ledger.mjs';
import { seedP75, stageWindows } from './stages.mjs';

const EPSILON = 1e-9;
const no = (reason, rateLimitType = null, resetsAt = null) => ({ ok: false, reason, rateLimitType, resetsAt });

// why: overage is active on isUsingOverage or any overageStatus other than rejected (Decision 7).
export const overageActive = (o) => Boolean(o) && (o.isUsingOverage === true || (o.status != null && o.status !== 'rejected'));

// why: a limit pause holds only stages that name its window (Decision 9); any other cause holds all.
export const holds = (paused, windows) => paused && (paused.reason !== 'limit' || !paused.rateLimitType || windows.includes(paused.rateLimitType));

const count = (running) => (Array.isArray(running) ? running.length : Number(running) || 0);

// why: a window with no reading yet cannot be checked, so it does not block (Choice: fail open on missing data).
function overCeiling({ windows, usage, settings, delta }) {
  for (const type of windows) {
    const w = usage?.[type];
    if (!w || typeof w.utilization !== 'number') continue;
    const ceiling = type === 'five_hour' ? settings.ceilings.fiveHour : settings.ceilings.sevenDay;
    if (w.utilization + delta > ceiling + EPSILON) return no('ceiling', type, w.resetsAt ?? null);
  }
  return null;
}

export function admit({ stage, usage, settings, history, running, queue }) {
  const windows = stageWindows(stage);
  // why: every pause counts, not only the first (Decisions 9, 14, 15); a limit pause is scoped to its window, the rest hold all.
  const pauses = queue?.pauses?.length ? queue.pauses : queue?.paused ? [queue.paused] : [];
  const paused = pauses.find((p) => holds(p, windows));
  if (paused) return no('paused', paused.rateLimitType ?? null, paused.resetsAt ?? null);
  if (overageActive(usage?.overage) && !settings.overageAllowed) return no('overage', null, usage.overage.resetsAt ?? null);
  if (count(running) >= settings.maxConcurrent) return no('concurrency');
  return overCeiling({ windows, usage, settings, delta: p75(history, stage, seedP75(stage)) }) ?? { ok: true };
}
