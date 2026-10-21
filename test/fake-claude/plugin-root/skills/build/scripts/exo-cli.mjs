// why: FAKE_EXO_SCENARIO (inline JSON or a file path) drives every output; run state is written at once with this dead pid.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const raw = process.env.FAKE_EXO_SCENARIO ?? '{}';
const scenario = JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8'));
const [command, ...rest] = process.argv.slice(2);
const cwd = process.cwd();
const refuse = (text) => {
  process.stderr.write(`exo: ${text}\n`);
  process.exit(2);
};
const dirOf = (id) => join(cwd, '.exo', 'run', id);
const keptOf = (id) => join(cwd, '.exo', 'kept', id);
// why: real run-plan refuses a plan whose '## Plan basis' names no Branch: (run-plan.mjs preflight) after the detach line, as phase refused with exit 2.
const planRefusal = (file) => {
  if (!existsSync(file)) return null;
  const basis = readFileSync(file, 'utf8').match(/^## Plan basis\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? '';
  return /^Branch: .+$/m.test(basis) ? null : "the plan's '## Plan basis' names no Branch:";
};
const FINAL = ['passed', 'landed', 'parked', 'stopped', 'refused', 'crashed'];

function write(id, { plan, startedAt }, s) {
  const phase = s.phase ?? 'landed';
  const run = dirOf(id);
  mkdirSync(run, { recursive: true });
  const state = { id, plan, root: cwd, flags: [], detach: true, pid: process.pid, phase, stage: s.stage ?? 'build', startedAt, updatedAt: new Date().toISOString(), exitCode: s.exitCode ?? (phase === 'landed' || phase === 'passed' ? 0 : 3), runRoot: s.runRoot ?? cwd, branch: s.branch ?? 'main' };
  for (const key of ['task', 'landed', 'total', 'reason']) if (s[key] !== undefined) state[key] = s[key];
  writeFileSync(join(run, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(join(run, 'report.md'), s.report ?? `# Run ${id}\nphase: ${phase}\n`);
  writeFileSync(join(run, 'gates.md'), (s.gates ?? []).map((g) => `- open: ${g.source}: ${g.action} (${g.reason})\n`).join(''));
  if (s.denied !== undefined) writeFileSync(join(run, 'denied.txt'), s.denied);
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const logs = join(state.runRoot, '.exo', 'run-plan', basename(plan).replace(/\.md$/, ''), stamp);
  for (const [name, lines] of Object.entries(s.iters ?? {})) {
    mkdirSync(logs, { recursive: true });
    appendFileSync(join(logs, name), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  }
  if (s.kept && FINAL.includes(phase)) {
    mkdirSync(join(cwd, '.exo', 'kept'), { recursive: true });
    renameSync(run, keptOf(id));
  }
  return state;
}

function load(id) {
  for (const dir of [dirOf(id), keptOf(id)]) {
    if (existsSync(join(dir, 'state.json'))) return { dir, state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) };
  }
  return refuse(`refused: no run ${id} in ${cwd}; exo status lists the runs`);
}

function again(id, key) {
  const { dir, state } = load(id);
  if (key === 'approve') {
    if (state.phase !== 'parked') refuse(`refused: run ${id} is ${state.phase}, not parked`);
  } else if (state.phase === 'parked') refuse(`refused: run ${id} is parked; use exo approve ${id}`);
  else if (state.phase === 'landed' || state.phase === 'passed') refuse(`refused: run ${id} already ${state.phase}`);
  const next = { ...scenario, ...(scenario[key] ?? {}), phase: (scenario[key] ?? {}).phase ?? 'landed', gates: (scenario[key] ?? {}).gates ?? [] };
  if (dir === keptOf(id)) renameSync(dir, dirOf(id));
  write(id, state, next);
  process.stdout.write(`exo: run ${id} ${key === 'approve' ? 'approved' : 'resumed'}\n`);
}

if (command === 'run' && rest[0] === 'config') {
  process.stdout.write(`defaults.provider = ${JSON.stringify(scenario.provider ?? 'claude')} (catalog)\n`);
} else if (command === 'run' && rest[0] === '--resume') {
  again(rest[1], 'resume');
} else if (command === 'approve') {
  again(rest[0], 'approve');
} else if (command === 'run' && rest.includes('--detach')) {
  if (scenario.refuse !== undefined) refuse(scenario.refuse);
  const id = scenario.id ?? `fake-${Date.now()}`;
  const plan = rest[0].startsWith('--') ? 'plan.md' : rest[0];
  const bad = planRefusal(resolve(cwd, plan));
  write(id, { plan, startedAt: new Date().toISOString() }, bad === null ? scenario : { ...scenario, phase: 'refused', exitCode: 2, reason: bad, gates: [], iters: {} });
  if (bad !== null) {
    mkdirSync(join(cwd, '.exo', 'run'), { recursive: true });
    appendFileSync(join(cwd, '.exo', 'run', 'live.log'), `run-plan: refused: ${bad}\n`);
  }
  const log = join(dirOf(id), 'run.log');
  process.stdout.write(`exo: run ${id} started in the background (pid ${process.pid}); exo status ${id}, log ${log}, live log ${join(cwd, '.exo', 'run', 'live.log')}; watch: run \`node "${process.argv[1]}" wait ${id}\` as one background Bash call\n`);
} else {
  refuse('usage: exo run [plan] [--detach] [run-plan flags] | exo run --resume <id> | exo approve <id> | exo run config [<key> <value>]');
}
