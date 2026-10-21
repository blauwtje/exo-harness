import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRateLimitEvent } from './usage.mjs';

export function usageFromEvent(event, observedAt = Date.now()) {
  const parsed = parseRateLimitEvent(event, observedAt);
  if (!parsed) return {};
  return Object.fromEntries(Object.entries(parsed.windows).map(([type, w]) => [type, { ...w, observedAt }]));
}

export function mergeUsage(...entries) {
  const out = {};
  const pairs = entries.flatMap((entry) => Object.entries(entry ?? {}));
  for (const [type, w] of pairs) {
    if (!out[type] || w.observedAt >= out[type].observedAt) out[type] = w;
  }
  return out;
}

export function readStatuslineCache(path) {
  let observedAt;
  let raw;
  try {
    observedAt = statSync(path).mtimeMs;
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch { return {}; }
  const out = {};
  for (const [type, w] of Object.entries(raw ?? {})) {
    if (typeof w?.used_percentage !== 'number') continue;
    out[type] = { utilization: w.used_percentage / 100, resetsAt: w.resets_at ?? null, status: null, observedAt };
  }
  return out;
}

const subdirs = (dir) => {
  try { return readdirSync(dir); } catch { return []; }
};

const iterLogs = (runRoot) => {
  const planRoot = join(runRoot, '.exo', 'run-plan');
  const runs = subdirs(planRoot).flatMap((plan) => subdirs(join(planRoot, plan)).map((stamp) => join(planRoot, plan, stamp)));
  return runs.flatMap((dir) => subdirs(dir).filter((n) => /^iter-.*\.log$/.test(n)).sort().map((n) => join(dir, n)));
};

const parseOrNull = (line) => {
  try { return JSON.parse(line); } catch { return null; }
};

function logUsage(file) {
  let observedAt;
  let text;
  try {
    observedAt = statSync(file).mtimeMs;
    text = readFileSync(file, 'utf8');
  } catch { return {}; }
  const lines = text.split('\n').filter((l) => l.includes('rate_limit_event'));
  return mergeUsage(...lines.map((l) => usageFromEvent(parseOrNull(l), observedAt)));
}

export function readIterLogUsage(runRoot) {
  return mergeUsage(...iterLogs(runRoot).map(logUsage));
}
