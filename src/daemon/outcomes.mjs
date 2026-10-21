import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUTCOMES = ['done', 'question', 'max_turns', 'budget', 'limit', 'auth', 'crashed', 'refused', 'invariant'];

const DEFAULT_INBOX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'inbox');
const INBOX_EVENTS = 20;

export function inboxDir(env = process.env) {
  return env.EXO_HARNESS_INBOX || DEFAULT_INBOX;
}

export function isLimitStream(events) {
  return events.some((e) => {
    const info = e?.type === 'rate_limit_event' ? e.rate_limit_info : null;
    if (info && info.status !== 'allowed') return true;
    return Boolean(e?.api_error) || e?.api_error_status === 429;
  });
}

export function classifyOutcome(job, events = []) {
  if (OUTCOMES.includes(job?.outcome)) return job.outcome;
  if (job?.status === 'crashed') return 'crashed';
  const result = events.findLast((e) => e?.type === 'result');
  if (result?.subtype === 'error_max_budget_usd') return 'budget';
  if (result?.subtype === 'error_max_turns' || result?.terminal_reason === 'max_turns') return 'max_turns';
  if (isLimitStream(events)) return 'limit';
  if (job?.status === 'waiting') return 'question';
  if (result && !result.is_error) return 'done';
  return result ? 'crashed' : null;
}

export function failureInbox(state, store) {
  const items = [];
  for (const job of state.jobs) {
    const events = store.readEvents(job.id);
    const outcome = classifyOutcome(job, events);
    if (outcome && outcome !== 'done') items.push({ jobId: job.id, cardId: job.cardId, outcome, events: events.slice(-INBOX_EVENTS) });
  }
  return items;
}

export function captureLimitStream(jobId, events, env = process.env) {
  if (!isLimitStream(events)) return null;
  const dir = inboxDir(env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${jobId}.jsonl`);
  writeFileSync(file, events.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return file;
}
