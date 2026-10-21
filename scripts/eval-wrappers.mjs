import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMode } from '../src/daemon/mode.mjs';
import { startSession } from '../src/daemon/session.mjs';
import { isBuildDispatch } from '../src/daemon/shape-guard.mjs';
import { loadStages } from '../src/daemon/stages.mjs';
import { classifyTurn } from '../src/daemon/turns.mjs';
import { parseRateLimitEvent } from '../src/daemon/usage.mjs';
import { createWorktree } from '../src/daemon/worktree.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
export const evalDir = join(root, 'evals', 'wrapper');
export const loadCases = () => JSON.parse(readFileSync(join(evalDir, 'cases.json'), 'utf8'));

export function wrapperHash() {
  const s = loadStages().stages.spec;
  return createHash('sha256').update(s.systemPrompt + s.userMessage).digest('hex');
}

const blocks = (e) => (e?.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []);
const textOf = (e) => blocks(e).filter((b) => b?.type === 'text').map((b) => b.text).join('');

export function turnsOf(events) {
  const turns = [];
  let last = '';
  for (const e of events) {
    if (e?.type === 'assistant') last = textOf(e) || last;
    else if (e?.type === 'result') { turns.push(classifyTurn(last).class); last = ''; }
  }
  return turns;
}

const dispatchIds = (events) => events.filter((e) => isBuildDispatch(e, 'spec'))
  .flatMap(blocks).filter((b) => b?.type === 'tool_use').map((b) => b.id);

const resultFor = (e, ids) => e?.type === 'user' && Array.isArray(e.message?.content)
  && e.message.content.some((b) => b?.type === 'tool_result' && ids.includes(b.tool_use_id));

export function gradeRun(c, events) {
  const turns = turnsOf(events);
  const ids = dispatchIds(events);
  const reached = events.some((e) => resultFor(e, ids));
  const first = turns.find((t) => t === 'question' || t === 'done');
  const passed = { turn: first === c.expect, guard: !reached, prompt: ids.length === 0 };
  return Object.fromEntries(Object.keys(c.graders).map((g) => [g, passed[g]]));
}

export function gradeCase(c, runs) {
  const graders = {};
  for (const [g, min] of Object.entries(c.graders)) {
    const k = runs.filter((r) => r[g]).length;
    graders[g] = { k, n: runs.length, min, pass: min === null ? null : k >= min };
  }
  return { id: c.id, graders, pass: Object.values(graders).every((x) => x.pass !== false) };
}

const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

export function gradeFixtures(dir = join(evalDir, 'fixtures')) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const { cases } = loadCases();
  return cases.map((c) => gradeCase(c, manifest.runs.filter((r) => r.case === c.id)
    .map((r) => gradeRun(c, readJsonl(join(dir, r.file))))));
}

const overCeiling = (events, ceilings) => {
  const last = events.filter((e) => e?.type === 'rate_limit_event').map(parseRateLimitEvent).filter(Boolean).at(-1);
  return Object.entries(ceilings).find(([w, max]) => (last?.windows[w]?.utilization ?? 0) > max)?.[0] ?? null;
};

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

async function liveRun(c, { pluginRoot, claudePath, outFile }) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'eval-repo-')));
  git(repo, 'init', '-q');
  git(repo, '-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
  const wt = await createWorktree(repo, c.card.title);
  const events = [];
  const store = {
    save() {},
    appendEvent: (_id, e) => { events.push(e); appendFileSync(outFile, `${JSON.stringify(e)}\n`); },
  };
  const job = { id: 'eval', cardId: 'c', stage: 'spec' };
  let handedOff = false;
  let sess;
  const onTurn = (t) => {
    if (c.followUp && t.class === 'done' && !handedOff) { handedOff = true; return sess.send(c.followUp); }
    const ends = c.followUp ? handedOff || t.class === 'question' : t.class === 'question' || t.class === 'done';
    if (ends) sess.stop();
  };
  sess = await startSession({
    store, state: { projects: [], cards: [], jobs: [job] }, job, card: c.card, worktree: realpathSync(wt.path),
    pluginRoot, claudePath, onTurn,
  });
  await sess.done;
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
  return {
    events,
    meta: { model: init.model ?? null, effort: job.effort ?? null, claudeCodeVersion: job.claudeCodeVersion ?? null,
      exoVersion: job.exoVersion ?? null, transcript: outFile },
  };
}

async function runCase(c, ctx) {
  const { runs, ceilings, record, out, manifest, pluginRoot, claudePath } = ctx;
  const graded = [];
  for (let k = 1; k <= runs; k++) {
    const outFile = join(out, `${c.id}-${k}.jsonl`);
    const { events, meta } = await liveRun(c, { pluginRoot, claudePath, outFile });
    graded.push(gradeRun(c, events));
    console.log(`${c.id} run ${k}: ${JSON.stringify({ ...meta, graded: graded.at(-1) })}`);
    if (record) recordRun({ c, k, outFile, meta, manifest });
    const over = overCeiling(events, ceilings);
    if (over) { console.log(`stopping: ${over} over its ceiling`); return { stop: true, graded }; }
  }
  return { stop: false, graded };
}

function recordRun({ c, k, outFile, meta, manifest }) {
  const fixtures = join(evalDir, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  copyFileSync(outFile, join(fixtures, `${c.id}-${k}.jsonl`));
  manifest.runs.push({ case: c.id, file: `${c.id}-${k}.jsonl`, ...meta });
}

async function live(argv, env) {
  const { pluginRoot, claudePath } = resolveMode(argv, env);
  const { runs, ceilings, cases } = loadCases();
  const manifest = { label: 'recorded by eval-wrappers --live --record', wrapper: { sha256: wrapperHash() }, runs: [] };
  const ctx = { runs, ceilings, record: argv.includes('--record'), manifest, pluginRoot, claudePath,
    out: mkdtempSync(join(tmpdir(), 'eval-wrappers-')) };
  let ok = true;
  for (const c of cases) {
    const { stop, graded } = await runCase(c, ctx);
    const r = gradeCase(c, graded);
    console.log(summary(r));
    ok = ok && r.pass && !stop;
    if (!ok) break;
  }
  if (ctx.record) writeFileSync(join(evalDir, 'fixtures', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return ok;
}

const summary = (r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${Object.entries(r.graders)
  .map(([g, x]) => `${g} ${x.k}/${x.n}${x.min === null ? ' (reported)' : ` (need ${x.min})`}`).join(', ')}`;

async function main(argv, env) {
  if (argv.includes('--fixtures')) {
    resolveMode(argv, env, () => '');
    const results = gradeFixtures();
    for (const r of results) console.log(summary(r));
    return results.every((r) => r.pass);
  }
  if (argv.includes('--live')) return live(argv, env);
  throw new Error('usage: eval-wrappers --fixtures | --live [--record]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((ok) => process.exit(ok ? 0 : 1), (e) => {
    console.error(e.message);
    process.exit(2);
  });
}
