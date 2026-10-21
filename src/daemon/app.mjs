import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkAuth } from './auth.mjs';
import { checkHealth } from './health.mjs';
import { addCard, addJob, addProject } from './model.mjs';
import { reconcile } from './reconcile.mjs';
import { holderDone, startRun } from './exo-run.mjs';
import { checkCollision, checkProvider, readPlan, runCwd } from './run-guard.mjs';
import { watchRun } from './run-watch.mjs';
import { runSetup } from './setup.mjs';
import { createServer } from './server.mjs';
import { isDone } from './shape-guard.mjs';
import { createStore } from './store.mjs';
import { loadStages } from './stages.mjs';
import { createSupervisor } from './supervisor.mjs';
import { FINAL_STATUSES as FINAL } from './usage.mjs';
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
  ['POST', '/api/jobs/:id/retry', 'retry'],
  ['POST', '/api/jobs/:id/reply', 'reply'],
  ['POST', '/api/jobs/:id/permission', 'permission'],
  ['POST', '/api/jobs/:id/continue', 'continue'],
  ['POST', '/api/jobs/:id/stop', 'stop'],
  ['POST', '/api/stop-all', 'stopAll'],
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
  onNeedsYou,
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
    appendEvent: (jobId, event) => { baseStore.appendEvent(jobId, event); push('event', { jobId, event }); },
  };
  const supervisor = createSupervisor({
    store, state, onNeedsYou: onNeedsYou ?? ((job, needs) => push('needs-you', { jobId: job.id, needs })),
  });

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

  function sessionOpts(j, card) {
    return {
      onTurn: (turn) => finishOrWait(j, card, turn).catch((e) => wait(j, { lastText: e.message })),
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
      if (!FINAL.has(j.status)) {
        j.status = { stopped: 'stopped', refused: 'refused' }[reason] ?? 'crashed';
        if (j.status === 'crashed') j.crashReason = reason ?? 'exited';
        if (reason === 'init-mismatch') j.outcome = 'invariant';
        store.save(state);
      }
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

  function queue({ j, card, cwd, text }) {
    const holder = holderOf(cwd);
    Object.assign(j, { status: 'queued', queued: { text, holder: holder && { id: holder.id, phase: holder.phase, pid: holder.pid } } });
    store.save(state);
    const timer = setInterval(() => {
      if (holderOf(cwd)) return;
      clearInterval(timer);
      timers.delete(j.id);
      startFor(j, card).catch((e) => { j.status = 'crashed'; j.crashReason = e.message; store.save(state); });
    }, loadStages().stages.run.pollMs);
    timer.unref();
    timers.set(j.id, timer);
    return j;
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
    const provider = await checkProvider(pluginRoot, cwd);
    if (!provider.ok) return refuse(provider.text);
    const setup = cwd === j.worktree ? await runSetup(project, j.worktree, project.path) : { ok: true };
    if (!setup.ok) return stopWith(j, 'setup', { kind: 'setup', command: setup.command, tail: setup.tail, options: ['retry'] });
    const res = await startRun({ pluginRoot, cwd, brief: j.brief, parentEnv });
    if (res.refusal === 'lock') return queue({ j, card, cwd, text: res.text });
    if (res.refusal) return refuse(res.text);
    Object.assign(j, { status: 'running', run: { id: res.runId }, runRoot: cwd });
    for (const k of ['needsYou', 'outcome', 'queued']) delete j[k];
    card.lane = 'Approved';
    store.save(state);
    watchers.set(j.id, watchRun({ job: j, runRoot: cwd, store, state, onChange: (x) => { ffRefused(x, project).catch(() => {}); } }));
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
      await launch({ store, state, job: j, card, worktree: wt.path, mode: 'start' });
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
        Object.assign(j, { status: 'running', worktree: shaped.worktree, brief: shaped.brief, startedAt: Date.now() });
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
      if (j.stage !== 'run' || !['refusal', 'setup'].includes(j.needsYou?.kind) || approving.has(id)) throw fail(409, 'job has nothing to retry');
      approving.add(id);
      try { return await startFor(Object.assign(j, { status: 'running' }), cardOf(j.cardId)); } finally { approving.delete(id); }
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
      return { port: actual, url, reconciled: auth.ok };
    },
    async close() {
      for (const t of timers.values()) clearInterval(t);
      for (const w of watchers.values()) w.stop();
      await supervisor.stopAll();
      await server.close();
    },
  };
}
