import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { admit } from './admission.mjs';
import { checkAuth } from './auth.mjs';
import { watchHardStop } from './hard-stop.mjs';
import { checkHealth } from './health.mjs';
import { createLimitTimer, detectLimit } from './limit.mjs';
import { addCard, addJob, addProject } from './model.mjs';
import { createQueue } from './queue.mjs';
import { reconcile } from './reconcile.mjs';
import { archiveRun, removeWorktree } from './archive.mjs';
import { FINAL_PHASES, approveRun, holderDone, resumeRun, startRun } from './exo-run.mjs';
import { fileDiff, finishLand, gateDetails } from './run-gate.mjs';
import { checkCollision, checkProvider, readPlan, runCwd } from './run-guard.mjs';
import { watchRun } from './run-watch.mjs';
import { runSetup } from './setup.mjs';
import { loadSettings, saveSettings } from './settings.mjs';
import { failureInbox } from './outcomes.mjs';
import { createServer } from './server.mjs';
import { isDone } from './shape-guard.mjs';
import { createStore } from './store.mjs';
import { loadStages } from './stages.mjs';
import { createSupervisor } from './supervisor.mjs';
import { FINAL_STATUSES as FINAL, parseRateLimitEvent } from './usage.mjs';
import { mergeUsage, readIterLogUsage, readStatuslineCache, usageFromEvent } from './usage-sources.mjs';
import { createWorktree } from './worktree.mjs';

const git = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw fail(400, `${name} is required`);
  return v;
};

const ROUTES = [
  ['GET', '/api/state', 'state'],
  ['GET', '/api/health', 'health'],
  ['POST', '/api/projects', 'addProject'],
  ['POST', '/api/cards', 'addCard'],
  ['POST', '/api/cards/:id/shape', 'shape'],
  ['POST', '/api/cards/:id/approve', 'approve'],
  ['POST', '/api/cards/:id/reject', 'reject'],
  ['POST', '/api/cards/:id/find-cause', 'findCause'],
  ['GET', '/api/inbox', 'inbox'],
  ['POST', '/api/jobs/:id/retry', 'retry'],
  ['POST', '/api/jobs/:id/finish-land', 'finishLandRoute'],
  ['POST', '/api/jobs/:id/approve-gate', 'approveGate'],
  ['POST', '/api/jobs/:id/reject-gate', 'rejectGate'],
  ['POST', '/api/jobs/:id/resume-run', 'resumeRunRoute'],
  ['POST', '/api/jobs/:id/discard', 'discard'],
  ['GET', '/api/jobs/:id/diff', 'diff'],
  ['POST', '/api/jobs/:id/reply', 'reply'],
  ['POST', '/api/jobs/:id/permission', 'permission'],
  ['POST', '/api/jobs/:id/continue', 'continue'],
  ['POST', '/api/jobs/:id/stop', 'stop'],
  ['POST', '/api/stop-all', 'stopAll'],
  ['GET', '/api/settings', 'getSettings'],
  ['PUT', '/api/settings', 'putSettings'],
  ['GET', '/api/queue', 'getQueue'],
  ['POST', '/api/queue/reorder', 'reorderQueue'],
  ['POST', '/api/queue/priority', 'prioritize'],
  ['POST', '/api/queue/resume', 'resumeQueue'],
  ['GET', '/api/jobs/:id/transcript', 'transcript'],
].map(([method, path, name]) => ({ method, name, re: new RegExp(`^${path.replace(':id', '([^/]+)')}$`) }));

function routeTable(handlers) {
  return new Proxy({}, {
    get(_, key) {
      const [method, path] = String(key).split(' ');
      for (const r of ROUTES) {
        const m = r.method === method && r.re.exec(path);
        if (m) return (req) => handlers[r.name]({ ...req, id: m[1] && decodeURIComponent(m[1]) });
      }
      return undefined;
    },
  });
}

export function createApp({
  dataDir, claudePath = 'claude', pluginRoot, distDir = null, parentEnv = process.env, token = randomBytes(32).toString('hex'),
  onNeedsYou, statuslinePath, drainMs = 5000, limitOptions = {},
}) {
  const baseStore = createStore(dataDir);
  const state = baseStore.load();
  const sessions = new Map();
  const pending = new Map();
  let server;
  const push = (event, data) => server?.broadcast(event, data);
  const store = {
    ...baseStore,
    save: (s) => { baseStore.save(s); push('state', s); },
    appendEvent: (jobId, event) => { baseStore.appendEvent(jobId, event); push('event', { jobId, event }); observe(jobId, event); },
  };
  const supervisor = createSupervisor({
    store, state, onNeedsYou: onNeedsYou ?? ((job, needs) => push('needs-you', { jobId: job.id, needs })),
  });

  // why: Decisions 6, 7, 9, 15, 16; every job start asks `admit` and a refusal leaves a queued job with its reason.
  const qm = createQueue(state);
  // why: the entry passes the real statusline cache; without it only stream events and iter logs count, so tests never read the user's own usage.
  const cachePath = statuslinePath ?? null;
  let eventUsage = {};
  let overage = null;
  // why: only an explicit toggle lifts overage (Decision 7), so settings reach admission with it false.
  const settingsNow = () => ({ ...loadSettings(dataDir), overageAllowed: false });
  const liveRuns = () => state.jobs.filter((j) => j.stage === 'run' && j.status === 'running' && j.run?.id && j.runRoot);
  const usageNow = () => ({
    ...mergeUsage(eventUsage, (cachePath ? readStatuslineCache(cachePath) : {}), ...[...new Set(liveRuns().map((j) => j.runRoot))].map(readIterLogUsage)),
    overage,
  });
  const runningCount = (except) => state.jobs.filter((j) => j.id !== except && ['starting', 'running'].includes(j.status)).length;
  const check = (stage, except) => admit({ stage, usage: usageNow(), settings: settingsNow(), history: state.utilizationHistory, running: runningCount(except), queue: qm.snapshot() });

  function holdBack(j, v, extra = {}) {
    Object.assign(j, { status: 'queued', queued: { ...extra, reason: v.reason, rateLimitType: v.rateLimitType, resetsAt: v.resetsAt } });
    qm.enqueue(j.id);
    store.save(state);
    return j;
  }

  function observe(jobId, event) {
    const at = Date.now();
    eventUsage = mergeUsage(eventUsage, usageFromEvent(event, at));
    const parsed = parseRateLimitEvent(event, at);
    if (parsed) overage = { ...parsed.overage, resetsAt: parsed.windows[parsed.rateLimitType]?.resetsAt ?? null };
    const hit = detectLimit(event);
    if (hit) limitHit(jobId, hit);
  }

  const limitTimers = new Set();
  const limiter = createLimitTimer({
    queue: { ...qm, resume: (reason) => { qm.resume(reason); store.save(state); drain(); } },
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); limitTimers.add(t); return t; },
    ...limitOptions,
  });

  function limitHit(jobId, hit) {
    const j = state.jobs.find((x) => x.id === jobId);
    if (!j || FINAL.has(j.status)) return;
    limiter.hit(hit);
    Object.assign(j, { status: 'queued', limitHit: hit, queued: { reason: 'paused', rateLimitType: hit.rateLimitType, resetsAt: hit.resetsAt } });
    qm.enqueue(j.id);
    store.save(state);
    supervisor.stop(j.id).catch(() => {});
  }

  // why: a queued job names why it waits, so the gauge can show the ceiling and the resume time.
  function refresh() {
    let changed = false;
    for (const id of qm.snapshot().order) {
      const j = state.jobs.find((x) => x.id === id);
      if (j?.status !== 'queued' || j.queued?.holder) continue;
      const v = check(j.stage, j.id);
      if (v.ok) continue;
      const next = { ...j.queued, reason: v.reason, rateLimitType: v.rateLimitType, resetsAt: v.resetsAt };
      if (JSON.stringify(next) !== JSON.stringify(j.queued)) { j.queued = next; changed = true; }
    }
    if (changed) store.save(state);
  }

  // why: a stale id (job stopped or discarded while queued) is picked so next() drops it, then skipped.
  const admissible = (id) => {
    const j = state.jobs.find((x) => x.id === id);
    if (j?.status !== 'queued') return true;
    return !j.queued?.holder && check(j.stage, j.id).ok;
  };

  function drain() {
    for (let id; (id = qm.next(admissible));) {
      const j = state.jobs.find((x) => x.id === id);
      if (j?.status === 'queued') begin(j);
    }
    refresh();
  }

  function begin(j) {
    const card = cardOf(j.cardId);
    const resume = j.queued?.resume;
    delete j.queued;
    delete j.limitHit;
    if (j.stage === 'run') {
      j.status = 'running';
      store.save(state);
      return resume ? beginResume(j, card) : restart(j, card);
    }
    j.status = 'starting';
    store.save(state);
    launch({ store, state, job: j, card, worktree: j.worktree, mode: j.sessionId ? 'resume' : 'start' }).catch(() => {});
  }

  async function beginResume(j, card) {
    const r = await resumeRun({ pluginRoot, cwd: j.runRoot, runId: j.run.id, parentEnv }).catch((e) => ({ ok: false, text: e.message }));
    if (!r.ok) return runFailed(j, r.text);
    resumed(j, card);
  }

  const job = (id) => state.jobs.find((j) => j.id === id) ?? (() => { throw fail(404, `unknown job: ${id}`); })();
  const wait = (j, extra) => { Object.assign(j, { status: 'waiting' }, extra); store.save(state); };

  async function finishOrWait(j, card, turn) {
    if (turn.class === 'question') return wait(j, { question: turn.questions });
    const brief = turn.class === 'done' ? await isDone(j.worktree, j.startedAt, { pluginRoot }) : null;
    if (!brief) return wait(j, { lastText: turn.text });
    delete j.question;
    Object.assign(j, { status: 'done', brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } });
    card.lane = 'Shaped';
    store.save(state);
    (await sessions.get(j.id))?.end();
  }

  // why: Decision 15; a find-cause job is done on a `done` turn and its last text is the summary.
  async function finishCause(j, turn) {
    if (turn.class !== 'done') return wait(j, turn.class === 'question' ? { question: turn.questions } : { lastText: turn.text });
    delete j.question;
    Object.assign(j, { status: 'done', summary: turn.text });
    store.save(state);
    (await sessions.get(j.id))?.end();
  }

  function sessionOpts(j, card) {
    const turnOf = j.stage === 'find-cause' ? (turn) => finishCause(j, turn) : (turn) => finishOrWait(j, card, turn);
    return {
      onTurn: (turn) => turnOf(turn).catch((e) => wait(j, { lastText: e.message })),
      onAsk: (requestId, request, d) => {
        pending.set(requestId, { jobId: j.id, requestId, request, card: d.card });
        wait(j, {});
        push('ask', { jobId: j.id, requestId, card: d.card });
      },
    };
  }

  function launch(opts) {
    const { job: j } = opts;
    const p = supervisor.start({ claudePath, parentEnv, pluginRoot, ...opts, ...sessionOpts(j, opts.card) });
    sessions.set(j.id, p);
    p.then((sess) => sess.done).then(({ reason }) => {
      for (const [id, a] of pending) if (a.jobId === j.id) pending.delete(id);
      if (sessions.get(j.id) !== p || j.limitHit) return drain();
      if (!FINAL.has(j.status)) {
        j.status = { stopped: 'stopped', refused: 'refused' }[reason] ?? 'crashed';
        if (j.status === 'crashed') j.crashReason = reason ?? 'exited';
        if (reason === 'init-mismatch') j.outcome = 'invariant';
        store.save(state);
      }
      drain();
    }, (e) => { j.status = 'crashed'; j.crashReason = e.message; store.save(state); });
    return p;
  }

  async function gateAuth() {
    const auth = await checkAuth({ claudePath, parentEnv });
    if (!auth.ok) throw fail(412, `${auth.reason}. Fix: ${auth.fix}`);
  }

  let reconciling = null;
  const reconcileOnce = () => (reconciling ??= reconcile({
    store, state, supervisor: { start: (o) => launch({ ...o }) }, skip: (j) => sessions.has(j.id), claudePath, parentEnv,
  }).finally(() => { reconciling = null; }));

  async function reconcileAndCheck() {
    const health = await checkHealth({ claudePath, pluginRoot, projectPath: state.projects[0]?.path, parentEnv });
    if (health.claude?.ok) await reconcileOnce();
    return health;
  }

  const watchers = new Map();
  const timers = new Map();
  const approving = new Set();
  const projectOf = (card) => state.projects.find((p) => p.key === card.projectKey);
  const cardOf = (id) => state.cards.find((c) => c.id === id) ?? (() => { throw fail(404, `unknown card: ${id}`); })();

  // why: the deck shows exo's own text and reads the main checkout without touching it (S-17).
  async function ffRefused(j, project) {
    if (j.run.phase !== 'refused' || !String(j.run.reason).startsWith('could not fast-forward') || j.needsYou) return;
    const status = await git('git', ['-C', project.path, 'status', '--porcelain']).then((r) => r.stdout, (e) => String(e.message));
    Object.assign(j, { status: 'refused', outcome: 'refused', needsYou: { kind: 'refusal', text: j.run.reason, status, options: ['retry'] } });
    store.save(state);
  }

  function holderOf(cwd) {
    const root = join(cwd, '.exo', 'run');
    const states = [];
    try {
      for (const d of readdirSync(root)) states.push(JSON.parse(readFileSync(join(root, d, 'state.json'), 'utf8')));
    } catch { return null; }
    return states.find((s) => !holderDone(s)) ?? null;
  }

  const restart = (j, card) => startFor(j, card).catch((e) => { j.status = 'crashed'; j.crashReason = e.message; store.save(state); });

  function queue({ j, card, cwd, text }) {
    const holder = holderOf(cwd);
    Object.assign(j, { status: 'queued', queued: { reason: 'lock', text, holder: holder && { id: holder.id, phase: holder.phase, pid: holder.pid } } });
    qm.enqueue(j.id);
    store.save(state);
    const timer = setInterval(() => {
      if (holderOf(cwd)) return;
      clearInterval(timer);
      timers.delete(j.id);
      delete j.queued?.holder;
      store.save(state);
      drain();
    }, loadStages().stages.run.pollMs);
    timer.unref();
    timers.set(j.id, timer);
    return j;
  }

  // why: Decisions 10-13 and 17 and 22; every run phase becomes a card, an archive or a lane move.
  const FINAL_RUN = new Set(FINAL_PHASES.filter((p) => p !== 'parked'));
  const RUN_ID = /^[A-Za-z0-9][\w.-]*$/;
  const SAFE_REF = /^[A-Za-z0-9][\w./-]*$/;
  const rerun = new Set();
  const busyRun = new Set();
  let closed = false;
  let hardStop;
  let drainTimer;

  function runDirOf(j) {
    if (!RUN_ID.test(j.run?.id ?? '')) throw new Error('bad run id');
    for (const d of ['run', 'kept']) {
      const dir = join(j.runRoot, '.exo', d, j.run.id);
      if (existsSync(join(dir, 'state.json'))) return dir;
    }
    throw new Error(`no run state for ${j.run.id}`);
  }

  async function archive(j) {
    const dir = runDirOf(j);
    const plan = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).plan;
    const planDir = plan && join(j.runRoot, '.exo', 'run-plan', basename(plan).replace(/\.md$/, ''));
    j.archived = await archiveRun(dataDir, j.id, { runDir: dir, runPlanDir: planDir && existsSync(planDir) ? planDir : undefined });
    store.save(state);
  }

  function runFailed(j, reason) {
    const phase = j.run.phase;
    Object.assign(j, { status: ['stopped', 'crashed', 'refused'].includes(phase) ? phase : 'crashed', needsYou: { kind: 'run-failed', reason, phase, options: ['resume', 'retry', 'discard'] } });
    store.save(state);
  }

  // why: the worktree goes only after the archive exists (M10); a removal failure never undoes the landing.
  async function finishLanded(j, card, project) {
    watchers.get(j.id)?.stop();
    if (!j.archived) await archive(j);
    delete j.needsYou;
    Object.assign(j, { status: 'done', outcome: 'done' });
    card.lane = 'Done';
    store.save(state);
    try {
      await removeWorktree(pluginRoot, j.worktree, { checkout: project.path, archived: j.archived });
      j.worktreeRemoved = true;
    } catch (e) { j.removeError = e.message; }
    store.save(state);
  }

  async function landOrCard({ j, card, project, base }) {
    const r = await finishLand(project.path, base, j.run.branch);
    if (r.ok) {
      Object.assign(j.run, { phase: 'landed', landed: r.range });
      return finishLanded(j, card, project);
    }
    Object.assign(j, { status: 'waiting', needsYou: { kind: 'land', text: r.text, action: r.action, base, options: ['retry'] } });
    card.lane = 'Review';
    store.save(state);
  }

  async function baseOf(project) {
    const head = await git('git', ['-C', project.path, 'symbolic-ref', '--short', 'HEAD']).then((r) => r.stdout.trim(), () => '');
    return head || 'main';
  }

  async function parked(j, card, project) {
    const { run } = j;
    if (!SAFE_REF.test(run.branch ?? '')) throw new Error(`unsafe branch name: ${run.branch}`);
    const d = await gateDetails({ runDir: runDirOf(j), runRoot: j.runRoot, base: await baseOf(project), branch: run.branch });
    const reasons = [run.reason ?? '', ...d.gates];
    const landBase = reasons.map((x) => /cannot switch to ([^\s()]+)/.exec(x)?.[1]).find(Boolean);
    if (landBase) {
      if (!SAFE_REF.test(landBase)) throw new Error(`unsafe base name: ${landBase}`);
      return landOrCard({ j, card, project, base: landBase });
    }
    const conflict = reasons.some((x) => x.includes('rebase conflict'));
    Object.assign(j, {
      status: 'waiting',
      needsYou: { kind: conflict ? 'conflict' : 'gate', ...d, base: await baseOf(project), worktree: j.worktree, options: conflict ? ['find-cause', 'manual', 'approve', 'reject'] : ['approve', 'reject'] },
    });
    card.lane = 'Review';
    store.save(state);
  }

  async function gone(j) {
    const { run } = j;
    if (run.alive !== false) return;
    const key = `${run.id}:gone`;
    if (j.handled === key) return;
    let reason = `the run process is gone in phase ${run.phase}`;
    if (!run.resumed) {
      run.resumed = true;
      store.save(state);
      const r = await resumeRun({ pluginRoot, cwd: j.runRoot, runId: run.id, parentEnv });
      if (r.ok) { attach(j); rerun.add(j.id); return; }
      reason = r.text;
    }
    j.handled = key;
    runFailed(j, reason);
  }

  // why: the watch SIGTERMed this run for an apiKeySource or cwd breach; it is archived and stopped, never resumed (Decisions 12, 13).
  async function invariantStop(j) {
    if (j.status === 'stopped') return;
    watchers.get(j.id)?.stop();
    await archive(j);
    const reason = `init check failed: ${j.initMismatches.join(', ')}`;
    Object.assign(j, { status: 'stopped', needsYou: { kind: 'run-failed', reason, phase: j.run.phase, options: ['retry', 'discard'] } });
    store.save(state);
  }

  async function step(j) {
    const { run } = j;
    if (!run?.phase || closed) return;
    if (j.initMismatches?.length) return invariantStop(j);
    const card = cardOf(j.cardId);
    const project = projectOf(card);
    if (run.phase !== 'parked' && !FINAL_RUN.has(run.phase)) return gone(j);
    const key = `${run.id}:${run.phase}:${run.reason ?? ''}`;
    if (j.handled === key || j.status === 'stopped') return;
    j.handled = key;
    if (run.phase === 'parked') return parked(j, card, project);
    await archive(j);
    if (run.phase === 'landed') return finishLanded(j, card, project);
    if (run.phase === 'passed') {
      Object.assign(j, { status: 'done', outcome: 'done' });
      card.lane = 'Review';
      return store.save(state);
    }
    if (run.phase === 'refused' && String(run.reason).startsWith('could not fast-forward')) return ffRefused(j, project);
    runFailed(j, run.reason ?? `run ${run.phase}`);
  }

  const failCard = (j, e) => {
    Object.assign(j, { status: 'crashed', outcome: 'crashed', needsYou: { kind: 'run-failed', reason: `deck error: ${e.message}`, phase: j.run?.phase, options: ['discard'] } });
    store.save(state);
  };

  async function onRun(j) {
    if (busyRun.has(j.id)) { rerun.add(j.id); return; }
    busyRun.add(j.id);
    try {
      do {
        rerun.delete(j.id);
        await step(j).catch((e) => failCard(j, e));
      } while (rerun.has(j.id) && !closed);
    } finally { busyRun.delete(j.id); }
  }

  function attach(j) {
    watchers.get(j.id)?.stop();
    watchers.set(j.id, watchRun({ job: j, runRoot: j.runRoot, store, state, onChange: (x) => { onRun(x); } }));
  }

  const needs = (j, ...kinds) => {
    if (!kinds.includes(j.needsYou?.kind) || approving.has(j.id)) throw fail(409, `job has no ${kinds.join(' or ')} card`);
    return j.needsYou;
  };
  const resumed = (j, card) => {
    for (const k of ['needsYou', 'outcome']) delete j[k];
    for (const k of ['handled', 'archived']) delete j[k];
    Object.assign(j, { status: 'running' });
    card.lane = 'Approved';
    store.save(state);
    attach(j);
    return j;
  };
  async function again(id, kinds, call) {
    const j = job(id);
    needs(j, ...kinds);
    approving.add(id);
    try {
      const r = await call(j);
      if (!r.ok) throw fail(409, r.text);
      return resumed(j, cardOf(j.cardId));
    } finally { approving.delete(id); }
  }

  const stopWith = (j, outcome, needsYou) => {
    Object.assign(j, { status: 'refused', outcome, needsYou });
    delete j.queued;
    store.save(state);
    return j;
  };

  // why: Decisions 6, 16, 7 and 8 in order; every stop is a card with Retry, never a bug card.
  async function startFor(j, card) {
    const project = projectOf(card);
    const plan = await readPlan(j.brief);
    const guard = await runCwd({ project: project.path, pluginRoot, worktree: j.worktree, plan });
    const refuse = (text) => stopWith(j, 'refused', { kind: 'refusal', text, options: ['retry'] });
    if (guard.refusal) return refuse(guard.text);
    const { cwd } = guard;
    const provider = await checkProvider(pluginRoot, cwd, parentEnv);
    if (!provider.ok) return refuse(provider.text);
    const setup = cwd === j.worktree ? await runSetup(project, j.worktree, project.path, parentEnv) : { ok: true };
    if (!setup.ok) return stopWith(j, 'setup', { kind: 'setup', command: setup.command, tail: setup.tail, options: ['retry'] });
    const res = await startRun({ pluginRoot, cwd, brief: j.brief, parentEnv });
    if (res.refusal === 'lock') return queue({ j, card, cwd, text: res.text });
    if (res.refusal) return refuse(res.text);
    // why: Decision 12 allows one automatic resume per job, so a retried run keeps the spent one.
    Object.assign(j, { status: 'running', run: { id: res.runId, ...(j.run?.resumed && { resumed: true }) }, runRoot: cwd });
    for (const k of ['needsYou', 'outcome', 'queued', 'archived', 'initMismatches']) delete j[k];
    card.lane = 'Approved';
    store.save(state);
    attach(j);
    return j;
  }

  const handlers = {
    state: () => ({ ...state, pending: [...pending.values()] }),
    health: () => reconcileAndCheck(),
    async addProject({ body }) {
      const path = text(body.path, 'path');
      try {
        if (!statSync(path).isDirectory()) throw new Error();
        await git('git', ['-C', path, 'rev-parse', '--git-dir']);
      } catch { throw fail(400, `${path} is not a git repository`); }
      const origin = await git('git', ['-C', path, 'remote', 'get-url', 'origin']).then((r) => r.stdout.trim(), () => null);
      try { const p = addProject(state, { path, origin }); store.save(state); return p; } catch (e) { throw fail(409, e.message); }
    },
    addCard({ body }) {
      try {
        const card = addCard(state, { projectKey: body.projectKey, title: text(body.title, 'title') });
        card.body = typeof body.body === 'string' ? body.body : '';
        store.save(state);
        return card;
      } catch (e) { throw e.status ? e : fail(400, e.message); }
    },
    async shape({ id }) {
      const card = state.cards.find((c) => c.id === id) ?? (() => { throw fail(404, `unknown card: ${id}`); })();
      if (state.jobs.some((j) => j.cardId === id && !FINAL.has(j.status))) throw fail(409, 'card already has a running job');
      await gateAuth();
      const project = state.projects.find((p) => p.key === card.projectKey);
      const wt = await createWorktree(project.path, card.title).catch((e) => { throw fail(500, `worktree failed: ${e.message}`); });
      const j = addJob(state, { cardId: id, stage: 'spec' });
      Object.assign(j, { worktree: wt.path, startedAt: Date.now() });
      store.save(state);
      const v = check('spec', j.id);
      if (!v.ok) return holdBack(j, v);
      await launch({ store, state, job: j, card, worktree: wt.path, mode: 'start' });
      return j;
    },
    inbox: () => failureInbox(state, baseStore),
    async findCause({ id, body }) {
      const card = cardOf(id);
      if (state.jobs.some((x) => x.cardId === id && x.stage !== 'run' && !FINAL.has(x.status))) throw fail(409, 'card already has a running job');
      const from = body?.jobId === undefined ? state.jobs.findLast((x) => x.cardId === id && x.worktree) : job(body.jobId);
      if (body?.jobId !== undefined && (from.cardId !== id || from.needsYou?.kind !== 'conflict')) throw fail(409, 'job is not a conflict gate of this card');
      if (!from?.worktree || !existsSync(from.worktree)) throw fail(409, 'card has no worktree to inspect');
      await gateAuth();
      const j = addJob(state, { cardId: id, stage: 'find-cause' });
      Object.assign(j, { worktree: from.worktree, startedAt: Date.now() });
      store.save(state);
      const v = check('find-cause', j.id);
      if (!v.ok) return holdBack(j, v);
      await launch({ store, state, job: j, card, worktree: from.worktree, mode: 'start' });
      return j;
    },
    async approve({ id }) {
      const card = cardOf(id);
      if (approving.has(id) || state.jobs.some((j) => j.cardId === id && j.stage === 'run' && !FINAL.has(j.status))) throw fail(409, 'card already has a live run');
      const shaped = state.jobs.findLast((j) => j.cardId === id && j.needsYou?.kind === 'brief');
      if (!shaped) throw fail(409, 'card has no brief waiting for approval');
      approving.add(id);
      try {
        const branch = (await readPlan(shaped.brief)).branch;
        const source = await checkCollision(projectOf(card).path, branch);
        if (source) {
          const text = `branch ${branch} already exists as a ${source}`;
          card.collision = { branch, source, text };
          store.save(state);
          throw fail(409, text);
        }
        delete card.collision;
        delete shaped.needsYou;
        const j = addJob(state, { cardId: id, stage: 'run' });
        const v = check('run', j.id);
        Object.assign(j, { worktree: shaped.worktree, brief: shaped.brief, startedAt: Date.now() });
        if (!v.ok) return holdBack(j, v);
        j.status = 'running';
        store.save(state);
        return await startFor(j, card);
      } finally { approving.delete(id); }
    },
    reject({ id }) {
      const card = cardOf(id);
      const shaped = state.jobs.findLast((j) => j.cardId === id && j.needsYou?.kind === 'brief');
      if (!shaped) throw fail(409, 'card has no brief waiting for approval');
      delete shaped.needsYou;
      store.save(state);
      return card;
    },
    async retry({ id }) {
      const j = job(id);
      if (j.stage !== 'run' || !['refusal', 'setup', 'run-failed'].includes(j.needsYou?.kind) || approving.has(id)) throw fail(409, 'job has nothing to retry');
      const v = check('run', id);
      if (!v.ok) { delete j.needsYou; return holdBack(j, v); }
      approving.add(id);
      try { return await startFor(Object.assign(j, { status: 'running' }), cardOf(j.cardId)); } finally { approving.delete(id); }
    },
    approveGate: ({ id }) => again(id, ['gate', 'conflict'], (j) => approveRun({ pluginRoot, cwd: j.runRoot, runId: j.run.id, parentEnv })),
    resumeRunRoute({ id }) {
      const j = job(id);
      if (j.initMismatches?.length) throw fail(409, 'a run stopped by the init check is never resumed');
      const v = check('run', id);
      if (!v.ok) {
        needs(j, 'run-failed');
        delete j.needsYou;
        return holdBack(j, v, { resume: true });
      }
      return again(id, ['run-failed'], (j) => resumeRun({ pluginRoot, cwd: j.runRoot, runId: j.run.id, parentEnv }));
    },
    rejectGate({ id }) {
      const j = job(id);
      needs(j, 'gate', 'conflict');
      delete j.needsYou;
      j.status = 'stopped';
      cardOf(j.cardId).lane = 'Shaped';
      store.save(state);
      return j;
    },
    async finishLandRoute({ id }) {
      const j = job(id);
      const { base } = needs(j, 'land');
      const card = cardOf(j.cardId);
      approving.add(id);
      try { await landOrCard({ j, card, project: projectOf(card), base }); return j; } finally { approving.delete(id); }
    },
    async discard({ id }) {
      const j = job(id);
      needs(j, 'run-failed');
      const card = cardOf(j.cardId);
      approving.add(id);
      try {
        if (!j.archived) await archive(j);
        await removeWorktree(pluginRoot, j.worktree, { checkout: projectOf(card).path, archived: j.archived });
      } catch (e) { throw fail(409, e.message); } finally { approving.delete(id); }
      delete j.needsYou;
      Object.assign(j, { status: 'stopped', worktreeRemoved: true });
      card.lane = 'Shaped';
      store.save(state);
      return j;
    },
    async diff({ id, url }) {
      const j = job(id);
      const { base } = needs(j, 'gate', 'conflict');
      try { return { diff: await fileDiff({ runRoot: j.runRoot, base, branch: j.run.branch, file: url.searchParams.get('file') }) }; } catch (e) { throw fail(400, e.message); }
    },
    async reply({ id, body }) {
      const j = job(id);
      if (!supervisor.send(id, text(body.text, 'text'))) throw fail(409, 'job has no live session');
      delete j.question;
      Object.assign(j, { status: 'running' });
      store.save(state);
      return j;
    },
    async permission({ id, body }) {
      const ask = pending.get(body.requestId);
      if (!ask || ask.jobId !== id) throw fail(404, 'no such pending request');
      const sess = await sessions.get(id);
      const input = ask.request.input;
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : undefined;
      sess.answer(ask.requestId, body.allow === true
        ? { behavior: 'allow', updatedInput: answers ? { ...input, answers } : input }
        : { behavior: 'deny', message: typeof body.message === 'string' ? body.message : 'Denied by the user.' });
      pending.delete(ask.requestId);
      Object.assign(job(id), { status: 'running' });
      store.save(state);
      return { ok: true };
    },
    async continue({ id }) {
      const j = job(id);
      if (!supervisor.continue(id)) throw fail(409, 'job is not waiting at a turn cap');
      return j;
    },
    async stop({ id }) {
      const j = job(id);
      await supervisor.stop(id);
      if (!FINAL.has(j.status)) { j.status = 'stopped'; store.save(state); }
      return j;
    },
    async stopAll() {
      await supervisor.stopAll();
      for (const j of state.jobs) if (!FINAL.has(j.status) && j.status !== 'queued') j.status = 'stopped';
      store.save(state);
      return { ok: true };
    },
    transcript: ({ id }) => baseStore.readEvents(job(id).id),
    getSettings: () => settingsNow(),
    putSettings({ body }) {
      if (body && 'overageAllowed' in body) throw fail(400, 'overageAllowed is not set here');
      const r = saveSettings(dataDir, body);
      if (r.error) throw fail(400, r.error);
      drain();
      return settingsNow();
    },
    getQueue: () => qm.snapshot(),
    reorderQueue({ body }) {
      const r = qm.reorder(body.ids);
      if (r.error) throw fail(400, r.error);
      store.save(state);
      return qm.snapshot();
    },
    prioritize({ body }) {
      if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string')) throw fail(400, 'ids must be a list of project ids');
      qm.setPriority(body.ids);
      store.save(state);
      return qm.snapshot();
    },
    resumeQueue() {
      qm.resume('stopped');
      qm.resume('limit');
      store.save(state);
      drain();
      return qm.snapshot();
    },
  };

  server = createServer({ routes: routeTable(handlers), token, distDir });

  return {
    token, state, supervisor,
    async start(port = 0) {
      const actual = await server.listen(port);
      const url = `http://127.0.0.1:${actual}/#token=${token}`;
      const auth = await checkAuth({ claudePath, parentEnv });
      if (auth.ok) {
        const wrapped = { start: (o) => launch({ ...o }) };
        await reconcile({ store, state, supervisor: wrapped, claudePath, parentEnv });
      }
      for (const j of state.jobs) {
        if (j.stage === 'run' && j.status === 'running' && j.run?.id && j.runRoot) { attach(j); onRun(j); }
        if (j.status === 'queued') { delete j.queued?.holder; qm.enqueue(j.id); }
      }
      limiter.restore();
      hardStop = watchHardStop({ getUsage: usageNow, settings: settingsNow, runs: liveRuns });
      drainTimer = setInterval(drain, drainMs);
      drainTimer.unref();
      drain();
      return { port: actual, url, reconciled: auth.ok };
    },
    async close() {
      closed = true;
      clearInterval(drainTimer);
      hardStop?.stop();
      for (const t of limitTimers) clearTimeout(t);
      for (const t of timers.values()) clearInterval(t);
      for (const w of watchers.values()) w.stop();
      await supervisor.stopAll();
      await server.close();
    },
  };
}
