import { FINAL_STATUSES, parseRateLimitEvent } from '../daemon/usage.mjs';

export const LANES = ['Inbox', 'Shaped', 'Approved', 'Queued', 'Running', 'Review', 'Done'];
const LANE_WORD = { Shaped: 'Planned' };
export const LINE = { Inbox: 'inbox', Shaped: 'planned', Approved: 'approved', Queued: 'queued', Running: 'running', Review: 'review', Done: 'done' };
export const laneWord = (lane) => LANE_WORD[lane] ?? lane;
export { FINAL_STATUSES as FINAL };
export const isLive = (j) => !FINAL_STATUSES.has(j.status);

export const latestJob = (state, cardId) => state.jobs.findLast((j) => j.cardId === cardId) ?? null;
export const liveJob = (state, cardId) => state.jobs.findLast((j) => j.cardId === cardId && isLive(j)) ?? null;

export function laneOf(state, card) {
  const j = liveJob(state, card.id);
  if (j) return j.status === 'queued' ? 'Queued' : j.stage === 'run' && j.status === 'waiting' && card.lane === 'Review' ? 'Review' : 'Running';
  return LANES.includes(card.lane) ? card.lane : 'Inbox';
}

export function groupCards(state, projectKey) {
  const lanes = Object.fromEntries(LANES.map((l) => [l, []]));
  for (const card of state.cards) if (card.projectKey === projectKey) lanes[laneOf(state, card)].push(card);
  return lanes;
}

export const waitingCardIds = (items) => new Set(items.map((i) => i.card?.id ?? i.job?.cardId).filter(Boolean));

export const laneShownCards = (lanes, name, waitIds) => (name === 'Running' ? lanes.Running.filter((c) => !waitIds.has(c.id)) : lanes[name]);

export function workingCards(state, items, projectKey) {
  if (!state) return [];
  const waitIds = waitingCardIds(items);
  return state.cards.filter((c) => (projectKey == null || c.projectKey === projectKey) && laneOf(state, c) === 'Running' && !waitIds.has(c.id));
}
export const workingCount = (state, items, projectKey) => workingCards(state, items, projectKey).length;

export function homeCounts(state, projectKey, items) {
  const lanes = groupCards(state, projectKey);
  const waitIds = waitingCardIds(items);
  const running = laneShownCards(lanes, 'Running', waitIds).length;
  return {
    lanes,
    waitIds,
    needsYou: items.length,
    running,
    runningWaitsOnYou: lanes.Running.length - running,
    working: lanes.Running.some((c) => !waitIds.has(c.id) && liveJob(state, c.id)?.status === 'running'),
    queued: lanes.Queued.length,
    review: lanes.Review.length,
    done: lanes.Done.length,
  };
}

export const liveJobCount = (state, projectKey) => (state ? state.jobs.filter((j) => isLive(j)
  && (projectKey == null || state.cards.find((c) => c.id === j.cardId)?.projectKey === projectKey)).length : 0);

const RANK = {
  invariant: 0, health: 1, failure: 2, 'run-failed': 3, refusal: 4, setup: 5, land: 6, conflict: 7, gate: 8,
  permission: 9, question: 10, brief: 11, 'turn-cap': 12, limit: 8, overage: 2, budget: 13,
};
export const RUN_KINDS = new Set(['brief', 'gate', 'conflict', 'run-failed', 'setup', 'refusal', 'land', 'limit']);

export function needsYou(state, health) {
  const items = [];
  const cardOf = (id) => state.cards.find((c) => c.id === id);
  const asked = new Set();
  for (const ask of state.pending ?? []) {
    const job = state.jobs.find((j) => j.id === ask.jobId);
    if (!job) continue;
    asked.add(job.id);
    items.push({ kind: ask.card === 'question' ? 'question' : 'permission', key: `ask:${ask.requestId}`, job, card: cardOf(job.cardId), ask });
  }
  for (const job of state.jobs) {
    const kind = job.needsYou?.kind;
    if (RUN_KINDS.has(kind)) { items.push({ kind, key: `${kind}:${job.id}`, job, card: cardOf(job.cardId) }); continue; }
    if (latestJob(state, job.cardId)?.id !== job.id) continue;
    const card = cardOf(job.cardId);
    if (job.needsYou?.reason === 'turn-cap') items.push({ kind: 'turn-cap', key: `cap:${job.id}`, job, card });
    else if (job.status === 'waiting' && !asked.has(job.id)) {
      items.push({ kind: 'question', key: `q:${job.id}`, job, card, questions: job.question ?? [], text: job.lastText ?? '' });
    } else if (job.outcome === 'invariant') items.push({ kind: 'invariant', key: `inv:${job.id}`, job, card });
    else if (job.status === 'crashed') items.push({ kind: 'failure', key: `fail:${job.id}`, job, card });
  }
  for (const need of state.needs ?? []) items.push({ kind: need.kind, key: `need:${need.id}`, need });
  for (const [name, check] of Object.entries(health ?? {})) {
    if (check && check.ok === false) items.push({ kind: 'health', key: `health:${name}`, name, check });
  }
  return items.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

export const NEEDS_YOU_KINDS = Object.freeze(['question', 'permission', 'brief', 'gate', 'conflict', 'run-failed', 'setup', 'refusal', 'land', 'turn-cap']);

export function splitNeeds(items, kinds) {
  const picked = new Set(Array.isArray(kinds) ? kinds : NEEDS_YOU_KINDS);
  return { items: items.filter((i) => picked.has(i.kind)), history: items.filter((i) => !picked.has(i.kind)) };
}


export function latestRate(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const r = parseRateLimitEvent(events[i]);
    if (r && Object.keys(r.windows).length) return r;
  }
  return null;
}

const sum = (list, f) => list.reduce((n, x) => n + (f(x) ?? 0), 0);

export function ledgerOf(events, job = {}) {
  const init = events.find((e) => e?.type === 'system' && e.subtype === 'init');
  const result = events.findLast((e) => e?.type === 'result');
  const seen = new Set();
  const turns = [];
  for (const e of events) {
    const m = e?.type === 'assistant' ? e.message : null;
    if (!m?.usage || seen.has(m.id)) continue;
    if (m.id) seen.add(m.id);
    turns.push(m.usage);
  }
  const models = Object.entries(result?.modelUsage ?? {});
  const fromModels = (k) => (models.length ? sum(models, ([, u]) => u[k]) : null);
  const u = result?.usage ?? {};
  const pick = (a, b, c) => a ?? b ?? c ?? null;
  const cacheWrite = pick(fromModels('cacheCreationInputTokens'), u.cache_creation_input_tokens, turns.length ? sum(turns, (t) => t.cache_creation_input_tokens) : null);
  const splits = [
    turns.length ? { h: sum(turns, (t) => t.cache_creation?.ephemeral_1h_input_tokens), m: sum(turns, (t) => t.cache_creation?.ephemeral_5m_input_tokens) } : null,
    u.cache_creation ? { h: u.cache_creation.ephemeral_1h_input_tokens ?? 0, m: u.cache_creation.ephemeral_5m_input_tokens ?? 0 } : null,
  ];
  const split = splits.find((s) => s && (cacheWrite == null || s.h + s.m === cacheWrite)) ?? null;
  return {
    model: job.model ?? init?.model ?? models[0]?.[0] ?? null,
    claudeVersion: job.claudeCodeVersion ?? init?.claude_code_version ?? null,
    exoVersion: job.exoVersion ?? init?.plugins?.find((p) => p.name === 'exo')?.version ?? null,
    effort: job.effort ?? null,
    input: pick(fromModels('inputTokens'), u.input_tokens, turns.length ? sum(turns, (t) => t.input_tokens) : null),
    output: pick(fromModels('outputTokens'), u.output_tokens, turns.length ? sum(turns, (t) => t.output_tokens) : null),
    cacheRead: pick(fromModels('cacheReadInputTokens'), u.cache_read_input_tokens, turns.length ? sum(turns, (t) => t.cache_read_input_tokens) : null),
    cacheWrite,
    cache1h: split?.h ?? null,
    cache5m: split?.m ?? null,
    cost: result?.total_cost_usd ?? null,
  };
}

const clip = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const toolArg = (input = {}) => clip(input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.query ?? input.description ?? JSON.stringify(input), 110);

function assistantRows(key, content) {
  const rows = [];
  for (const c of content) {
    if (c.type === 'text' && c.text?.trim()) rows.push({ key: `${key}:t`, kind: 'say', title: 'Agent', text: c.text.trim() });
    else if (c.type === 'tool_use') rows.push({ key: `${key}:${c.id}`, kind: 'tool', title: c.name, text: toolArg(c.input) });
    else if (c.type === 'thinking' && c.thinking?.trim()) rows.push({ key: `${key}:k`, kind: 'think', title: 'Thinking', text: clip(c.thinking, 200) });
  }
  return rows;
}

function userRows(key, content) {
  const rows = [];
  for (const c of content) {
    if (c.type === 'tool_result') rows.push({ key: `${key}:${c.tool_use_id}`, kind: 'output', title: 'Tool output', text: clip(typeof c.content === 'string' ? c.content : JSON.stringify(c.content), 160) });
    else if (c.type === 'text') rows.push({ key: `${key}:u`, kind: 'you', title: 'You', text: c.text });
  }
  return rows;
}

export function timelineRows(events) {
  const rows = [];
  events.forEach((e, i) => {
    const key = `${i}`;
    if (!e || typeof e !== 'object') return;
    if (e.kind === 'malformed') return rows.push({ key, kind: 'raw', title: 'Unreadable line', text: clip(e.raw) });
    if (e.type === 'system' && e.subtype === 'init') return rows.push({ key, kind: 'start', title: 'Session started', text: `${e.model ?? 'unknown model'} · claude ${e.claude_code_version ?? '?'}` });
    if (e.type === 'assistant') return rows.push(...assistantRows(key, e.message?.content ?? []));
    if (e.type === 'user') {
      const content = e.message?.content;
      if (typeof content === 'string') return rows.push({ key, kind: 'you', title: 'You', text: content });
      return rows.push(...userRows(key, content ?? []));
    }
    if (e.type === 'result') {
      const cost = typeof e.total_cost_usd === 'number' ? ` · $${e.total_cost_usd.toFixed(4)} est.` : '';
      return rows.push({ key, kind: e.is_error ? 'error' : 'turn', title: e.is_error ? `Turn failed (${e.subtype})` : 'Turn finished', text: `${e.num_turns ?? '?'} turn${e.num_turns === 1 ? '' : 's'}${cost}` });
    }
    if (e.type === 'rate_limit_event') {
      const r = parseRateLimitEvent(e);
      const w = Object.entries(r?.windows ?? {}).map(([n, v]) => `${n.replace('_', ' ')} ${Math.round(v.utilization * 100)}%`).join(' · ');
      return rows.push({ key, kind: 'limit', title: `Limits ${r?.status ?? ''}`.trim(), text: w });
    }
    if (e.type === 'control_request' && e.request?.tool_name === 'AskUserQuestion') {
      const qs = e.request?.input?.questions ?? [];
      const text = qs.map((q) => `${q.question}${q.options?.length ? ` ${q.options.map((o) => o.label).join(' / ')}` : ''}`).join('\n');
      return rows.push({ key, kind: 'ask', title: 'Asked a question', text: text || 'No question text' });
    }
    if (e.type === 'control_request') return rows.push({ key, kind: 'ask', title: 'Asked permission', text: `${e.request?.tool_name ?? 'tool'}: ${toolArg(e.request?.input)}` });
    if (e.type === 'control_response') return rows.push({ key, kind: 'answer', title: 'Answered', text: clip(e.response?.response?.behavior ?? '') });
  });
  return rows;
}

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
export const usd = (n) => (n == null ? '—' : `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`);
export const shortId = (id) => String(id ?? '').slice(0, 6);
