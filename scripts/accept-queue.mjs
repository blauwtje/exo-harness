import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../bin/exo-harness.mjs', import.meta.url));
const fakeRoot = fileURLToPath(new URL('../test/fake-claude/plugin-root', import.meta.url));
const fakeClaude = fileURLToPath(new URL('../test/fake-claude/bin/claude', import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'exo-accept-queue-')));
const nowSec = () => Math.floor(Date.now() / 1000);
const until = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error('accept-queue: timed out');
};

const limitFlag = join(root, 'limit.json');
const offlineFlag = join(root, 'offline.flag');

function setup() {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  const seed = { projects: [{ key: 'local/p', path: repo, origin: null }], cards: [], jobs: [] };
  for (const n of [1, 2]) {
    const worktree = join(root, `wt${n}`);
    mkdirSync(worktree);
    const brief = join(worktree, 'plan.md');
    writeFileSync(brief, `# Plan\n\n## Plan basis\nBranch: feat-${n}\nLand: none\n`);
    seed.cards.push({ id: `c${n}`, projectKey: 'local/p', title: `T${n}`, lane: 'Shaped' });
    seed.jobs.push({ id: `shape${n}`, cardId: `c${n}`, stage: 'spec', status: 'done', worktree, brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } });
  }
  seed.cards.push({ id: 'k1', projectKey: 'local/p', title: 'Shape me', body: 'x', lane: 'Inbox' });
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'state.json'), JSON.stringify(seed));
  const claudeWrapperEnablingLimitFromFlagFile = join(root, 'claude');
  writeFileSync(claudeWrapperEnablingLimitFromFlagFile, `#!/bin/sh\nif [ -f "${limitFlag}" ]; then export FAKE_CLAUDE_LIMIT="$(cat "${limitFlag}")"; fi\nexec "${fakeClaude}" "$@"\n`);
  chmodSync(claudeWrapperEnablingLimitFromFlagFile, 0o755);
  const cache = join(root, 'home', '.cache', 'exo');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'statusline-rate-limits.json'), JSON.stringify({ five_hour: { used_percentage: 60, resets_at: nowSec() + 7200 } }));
  return claudeWrapperEnablingLimitFromFlagFile;
}

const bin = setup();
const env = {
  ...process.env, HOME: join(root, 'home'), EXO_HARNESS_DATA: join(root, 'data'), EXO_HARNESS_CLAUDE: bin, EXO_PLUGIN_ROOT: fakeRoot,
  EXO_FIXTURE_OFFLINE_FLAG: offlineFlag, FAKE_EXO_SCENARIO: JSON.stringify({ id: 'run-1', phase: 'build' }),
};
const child = spawn(process.execPath, [entry, '--fixtures'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const daemonUrl = new Promise((resolve, reject) => {
  let seen = '';
  child.stdout.on('data', (d) => { seen += d; const m = seen.match(/exo-harness: (\S+)/); if (m) resolve(m[1]); });
  child.on('exit', () => reject(new Error('accept-queue: daemon exited before printing its URL')));
});

try {
  const url = new URL(await daemonUrl);
  const api = async (method, path, body) => {
    const res = await fetch(`${url.origin}${path}`, {
      method, headers: { authorization: `Bearer ${url.hash.replace(/^#token=/, '')}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const state = async () => (await api('GET', '/api/state')).body;
  const runs = async () => (await state()).jobs.filter((j) => j.stage === 'run');

  assert.equal((await api('PUT', '/api/settings', { ceilings: { fiveHour: 0.5 } })).status, 200);
  assert.equal((await api('POST', '/api/cards/c1/approve')).status, 200);
  assert.equal((await api('POST', '/api/cards/c2/approve')).status, 200);
  const held = await runs();
  assert.equal(held.length, 2);
  for (const j of held) {
    assert.equal(j.status, 'queued');
    assert.equal(j.queued.reason, 'ceiling');
    assert.equal(j.queued.rateLimitType, 'five_hour');
    assert.ok(j.queued.resetsAt > nowSec(), 'the queued job names a future resetsAt');
  }

  assert.equal((await api('PUT', '/api/settings', { ceilings: { fiveHour: 0.8 } })).status, 200);
  const cap = (await api('GET', '/api/settings')).body.maxConcurrent;
  await until(async () => (await runs()).some((j) => j.status !== 'queued'));
  const started = (await runs()).filter((j) => j.status !== 'queued');
  assert.ok(started.length >= 1 && started.length <= cap, `at most ${cap} jobs run, saw ${started.length}`);

  const resetsAt = nowSec() + 3600;
  writeFileSync(limitFlag, JSON.stringify({ type: 'rejected', resetsAt, afterTurns: 0, rateLimitType: 'five_hour' }));
  assert.equal((await api('POST', '/api/cards/k1/shape')).status, 200);
  const paused = await until(async () => (await state()).queue.pauses.find((p) => p.reason === 'limit'));
  assert.deepEqual(paused, { reason: 'limit', rateLimitType: 'five_hour', resetsAt });

  const offlineHeld = async () => (await state()).queue.pauses.some((p) => p.reason === 'offline');
  writeFileSync(offlineFlag, '');
  await until(offlineHeld);
  rmSync(offlineFlag);
  await until(async () => !(await offlineHeld()));
  assert.ok((await state()).queue.pauses.some((p) => p.reason === 'limit'), 'the limit pause outlives the offline hold');
  console.log('accept-queue: pass (ceiling holds with resetsAt, restore starts at most the cap, limit hit pauses, offline holds and resumes)');
} finally {
  child.kill('SIGTERM');
  rmSync(root, { recursive: true, force: true });
}
