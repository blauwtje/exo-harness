import { detectLimit } from './limit.mjs';

const DEFAULT_WAITS_MS = [2000, 10000];

const isOverloaded = (event) => JSON.stringify(event).includes('overloaded_error');

export function classifyEnd(job, events) {
  if (events.some(detectLimit)) return 'limit';
  const result = events.find((e) => e.type === 'result');
  const sawOverloadedEvent = events.some(isOverloaded);
  if (result?.permission_denials?.length || (result?.is_error && !sawOverloadedEvent)) return 'model-error';
  if (result && !sawOverloadedEvent) return null;
  const line = failingLine(events);
  return (job.failures ?? []).includes(line) ? 'loop' : 'infra';
}

export function failingLine(events) {
  const hit = events.find(isOverloaded);
  if (hit) return JSON.stringify(hit);
  return 'stream ended with no result event';
}

export function nextRetry(job) {
  const failures = job.failures ?? [];
  const waits = job.retryWaitsMs ?? DEFAULT_WAITS_MS;
  const last = failures.at(-1);
  const repeated = failures.indexOf(last) !== failures.length - 1;
  if (!failures.length || repeated || failures.length > waits.length) return { retry: false, bugCard: failures.length > 0 };
  return { retry: true, waitMs: waits[failures.length - 1] };
}

export function bugCardOf(job) {
  const line = (job.failures ?? []).at(-1) ?? null;
  return { kind: 'bug', jobId: job.id ?? null, line, title: `Job failed: ${line}` };
}

export function runStopCard(report) {
  const reason = /^Reason:\s*(.+)$/m.exec(report ?? '')?.[1].trim();
  if (!reason || !/no progress|attempt/i.test(reason)) return null;
  return { kind: 'bug', reason, title: `Run stopped: ${reason}` };
}
