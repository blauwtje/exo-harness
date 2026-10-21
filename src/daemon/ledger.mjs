import { parseResultUsage } from './usage.mjs';

const IDLE_WRITE_TOKENS = 20000;
const IDLE_GAP_MS = 300 * 1000;
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 50;

export function ledgerRow(resultEvent, previousRow, at = Date.now()) {
  const cache = parseResultUsage(resultEvent);
  if (!cache) return null;
  const usage = resultEvent.usage ?? {};
  const row = {
    at,
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    ...cache,
    costUsd: resultEvent.total_cost_usd ?? 0,
    estimate: true,
  };
  const wrote = row.cacheCreation1h + row.cacheCreation5m;
  if (wrote > IDLE_WRITE_TOKENS && previousRow && at - previousRow.at > IDLE_GAP_MS) row.idleCacheWrite = true;
  return row;
}

// why: the caller keeps this history in state.json under utilizationHistory (Decision 6).
export function recordUtilization(history, stage, delta) {
  if (!Number.isFinite(delta) || delta < 0) return history ?? {};
  const samples = [...(history?.[stage] ?? []), delta].slice(-MAX_SAMPLES);
  return { ...history, [stage]: samples };
}

export function p75(history, stage, seed) {
  const samples = history?.[stage] ?? [];
  if (samples.length < MIN_SAMPLES) return seed;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.75 * sorted.length) - 1];
}
