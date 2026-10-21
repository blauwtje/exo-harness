// why: Decision 2 probe; it needs the user's own terminal, so it refuses under CLAUDECODE.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_PHASES } from '../src/daemon/exo-run.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const HEADING = '## Probe P3';

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

if (process.env.CLAUDECODE) {
  console.error('probe-p3: refusing to run under CLAUDECODE; run it from your own terminal');
  process.exit(2);
}

const facts = flag('--facts') ?? join(root, 'docs', 'facts.md');
const cli = flag('--exo') ?? join(
  process.env.EXO_PLUGIN_ROOT || readFileSync(join(homedir(), '.claude', 'exo', 'plugin-root'), 'utf8').trim(),
  'skills', 'build', 'scripts', 'exo-cli.mjs',
);
const waitMs = Number(process.env.PROBE_P3_WAIT_MS ?? 30 * 60 * 1000);

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function scratch() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'probe-p3-')));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  git(base, 'init', '--bare', '-b', 'main', origin);
  git(base, 'clone', origin, repo);
  git(repo, 'config', 'user.email', 'probe@example.invalid');
  git(repo, 'config', 'user.name', 'probe');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  writeFileSync(join(repo, '.gitignore'), '.exo/\n.worktrees/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'push', 'origin', 'main');
  return { base, repo };
}

// why: a run plan is the exo plan format plan-check accepts; `Land: none` is no Land: line, Land: local also needs a Commit: line, and Branch: is the linked worktree's branch.
function planText(repo, land) {
  const landLines = land === 'none' ? '' : `Land: ${land}\nCommit: chore(probe): add hello.txt\n`;
  return `# Probe ${land}

## Goal
Add one file, hello.txt, so a detached exo run lands a single task from a linked worktree.

## Plan basis
Repository: ${repo}
Branch: wt-${land}
Land gate: test -f hello.txt
${landLines}Lint: none
App: none

## Success criterion
\`grep -qx hello hello.txt\`
Product run: none (a probe file, no product)

## Checkpoint
- Blocks first: Task 1.
- Parallel: none.
- Shared state: none.
- Smallest safe split: one task.

## Tasks
### Task 1: chore(probe): add hello.txt
Depends on: none | Files: \`hello.txt\` | Data: a file holding "hello" | Red: none (a probe file with no production change) | Proof: test -f hello.txt
`;
}

function addPlan(repo, land) {
  const dir = join(repo, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  const plan = join(dir, `probe-${land}.md`);
  writeFileSync(plan, planText(repo, land));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', `plan ${land}`);
  git(repo, 'push', 'origin', 'main');
  return plan;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readFinal(wt, id) {
  for (const dir of ['run', 'kept']) {
    const file = join(wt, '.exo', dir, id, 'state.json');
    const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (state && FINAL_PHASES.includes(state.phase)) return { state, dir: join(wt, '.exo', dir, id) };
  }
  return null;
}

async function finalState(wt, id) {
  for (const end = Date.now() + waitMs; Date.now() < end; await sleep(500)) {
    const found = readFinal(wt, id);
    if (found) return found;
  }
  return null;
}

// why: exo ends a refused run as phase `refused`; its reason is a `run-plan: refused: ...` line in the live log, else the state's reason.
function refusalReason(wt, state) {
  const live = join(wt, '.exo', 'run', 'live.log');
  const lines = existsSync(live) ? readFileSync(live, 'utf8').split('\n') : [];
  const line = lines.reverse().find((l) => l.includes('refused:'));
  return line ? line.slice(line.indexOf('refused:') + 'refused:'.length).trim() : (state.reason ?? 'no reason recorded');
}

async function probe(repo, base, land) {
  const plan = addPlan(repo, land);
  const wt = join(base, `wt-${land}`);
  git(repo, 'worktree', 'add', '-b', `wt-${land}`, wt, 'main');
  const r = spawnSync(process.execPath, [cli, 'run', plan, '--detach'], { cwd: wt, encoding: 'utf8', env: process.env });
  const out = (r.stderr.trim() || r.stdout.trim());
  const id = r.stdout.match(/exo: run (\S+) started in the background/)?.[1];
  if (r.status !== 0 || !id) return `- Land: ${land}: exo run refused or failed to start (exit ${r.status}): ${out}`;
  const done = await finalState(wt, id);
  if (!done) return `- Land: ${land}: run ${id} reached no final phase within ${waitMs} ms`;
  if (done.state.phase === 'refused') return `- Land: ${land}: exo refused the run ${id} (exit ${done.state.exitCode}): ${refusalReason(wt, done.state)}; no fact about linked worktrees`;
  const gatesFile = join(done.dir, 'gates.md');
  const gates = existsSync(gatesFile) ? readFileSync(gatesFile, 'utf8').split('\n').filter(Boolean) : [];
  const detail = gates.length ? gates.map((g) => `  - gate: \`${g}\``).join('\n') : '  - gates: none';
  return `- Land: ${land}: final phase \`${done.state.phase}\` (exit ${done.state.exitCode}), run ${id} from a linked worktree\n${detail}`;
}

function record(lines) {
  const section = `${HEADING}\n\n${lines.join('\n')}\n`;
  const old = existsSync(facts) ? readFileSync(facts, 'utf8') : '';
  const re = /^## Probe P3\n[\s\S]*?(?=^## |(?![\s\S]))/m;
  const next = re.test(old) ? old.replace(re, `${section}\n`) : `${old}${old && !old.endsWith('\n\n') ? (old.endsWith('\n') ? '\n' : '\n\n') : ''}${section}`;
  writeFileSync(facts, next);
}

const { base, repo } = scratch();
const lines = [];
for (const land of ['local', 'none']) lines.push(await probe(repo, base, land));
record(lines);
console.log(lines.join('\n'));
console.log(`probe-p3: wrote ${HEADING} to ${facts}; scratch repo ${repo}`);
