import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/daemon/app.mjs';

const fakeRoot = new URL('./fake-claude/plugin-root', import.meta.url).pathname;
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 60; i++) { if (await fn()) return; await sleep(100); } assert.fail('timed out'); };

function repo() {
  const dir = tmp('rf-repo-');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, g };
}

// why: seed a Shaped card whose brief waits for approval, so the tests start at the Approve click.
async function boot({ land = 'none', scenario = {}, project: asProject, projectExtra = {}, pluginRoot = fakeRoot } = {}) {
  const base = tmp('rf-dir-');
  const claude = join(base, 'claude');
  writeFileSync(claude, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))});\n`);
  chmodSync(claude, 0o755);
  const { dir: main, g } = repo();
  const worktree = tmp('rf-wt-');
  const brief = join(worktree, 'plan.md');
  writeFileSync(brief, `# Plan\n\n## Plan basis\nBranch: feat-x\nLand: ${land}\n`);
  const scenarioFile = join(base, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const data = join(base, 'data');
  mkdirSync(data);
  const projectPath = asProject ?? main;
  const seed = {
    projects: [{ key: 'local/p', path: projectPath, origin: null, ...projectExtra }],
    cards: [{ id: 'c1', projectKey: 'local/p', title: 'T', lane: 'Shaped' }],
    jobs: [{ id: 'shape1', cardId: 'c1', stage: 'spec', status: 'done', worktree, brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } }],
  };
  writeFileSync(join(data, 'state.json'), JSON.stringify(seed));
  // why: run-guard's provider check inherits the process env, as the real daemon's parentEnv is process.env.
  process.env.FAKE_EXO_SCENARIO = scenarioFile;
  const app = createApp({ dataDir: data, claudePath: claude, pluginRoot, parentEnv: { ...process.env, FAKE_EXO_SCENARIO: scenarioFile } });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const setScenario = (s) => writeFileSync(scenarioFile, JSON.stringify(s));
  const runJob = () => app.state.jobs.find((j) => j.stage === 'run');
  return { app, api, g, main, worktree, setScenario, runJob, state: app.state };
}

test('F-3-02 Approve starts a detached run in the worktree and moves the card to Approved', async () => {
  const t = await boot({ scenario: { id: 'run-1', phase: 'build' } });
  try {
    const res = await t.api('POST', '/api/cards/c1/approve');
    assert.equal(res.status, 200);
    const j = t.runJob();
    assert.equal(j.status, 'running');
    assert.equal(j.run.id, 'run-1');
    assert.equal(j.runRoot, t.worktree);
    assert.equal(t.state.cards[0].lane, 'Approved');
    assert.equal(t.state.jobs.find((x) => x.id === 'shape1').needsYou, undefined);
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 409);
  } finally { await t.app.close(); }
});

test('F-3-02 a provider other than claude is a refusal card with Retry, and Retry starts the run', async () => {
  const t = await boot({ scenario: { provider: 'codex' } });
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    assert.equal(j.needsYou.kind, 'refusal');
    assert.match(j.needsYou.text, /defaults\.provider/);
    assert.equal(j.outcome, 'refused');
    t.setScenario({ id: 'run-2', phase: 'build' });
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/retry`)).status, 200);
    assert.equal(j.status, 'running');
    assert.equal(j.needsYou, undefined);
    assert.equal(t.state.jobs.filter((x) => x.stage === 'run').length, 1);
  } finally { await t.app.close(); }
});

test('F-3-03 S-19 a branch collision answers 409, shows on the card and creates no job', async () => {
  const t = await boot();
  try {
    t.g('branch', 'feat-x');
    const res = await t.api('POST', '/api/cards/c1/approve');
    assert.equal(res.status, 409);
    assert.match(t.state.cards[0].collision.text, /feat-x.*local branch/);
    assert.equal(t.runJob(), undefined);
    assert.equal(t.state.jobs[0].needsYou.kind, 'brief');
  } finally { await t.app.close(); }
});

test('F-3-04 S-18 a setup failure is a setup card with the output tail, not a bug card', async () => {
  const t = await boot({ scenario: { id: 'run-3', phase: 'build' }, projectExtra: { setup: 'node -e console.log("npm-ci-broke");process.exit(3)' } });
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    assert.equal(j.outcome, 'setup');
    assert.equal(j.needsYou.kind, 'setup');
    assert.match(j.needsYou.tail, /npm-ci-broke/);
    assert.equal(j.run, undefined);
    delete t.state.projects[0].setup;
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/retry`)).status, 200);
    assert.equal(j.status, 'running');
  } finally { await t.app.close(); }
});

test('F-3-05 S-07 a held lock queues the job behind the holder and starts it once the holder is done', async () => {
  const t = await boot({ scenario: { refuse: 'refused: another run holds the lock (.exo/run/lock)' } });
  try {
    const holderDir = join(t.worktree, '.exo', 'run', 'holder');
    mkdirSync(holderDir, { recursive: true });
    const holder = (phase) => writeFileSync(join(holderDir, 'state.json'), JSON.stringify({ id: 'holder', phase, pid: process.pid }));
    holder('build');
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    assert.equal(j.status, 'queued');
    assert.match(j.queued.text, /another run holds the lock/);
    assert.equal(j.queued.holder.id, 'holder');
    t.setScenario({ id: 'run-4', phase: 'build' });
    holder('landed');
    await until(() => j.run?.id === 'run-4');
    assert.notEqual(j.status, 'queued');
  } finally { await t.app.close(); }
});

test('F-3-05 a dirty-tree refusal shows exo text with Retry and is not queued', async () => {
  const t = await boot({ scenario: { refuse: 'refused: tracked working tree is dirty' } });
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    assert.equal(j.needsYou.kind, 'refusal');
    assert.match(j.needsYou.text, /working tree is dirty/);
    assert.equal(j.status, 'refused');
  } finally { await t.app.close(); }
});

test('F-3-12 S-17 a fast-forward refusal shows exo text and the main checkout status and touches nothing there', async () => {
  const t = await boot({ scenario: { id: 'run-5', phase: 'refused', reason: 'could not fast-forward main to feat-x' } });
  try {
    writeFileSync(join(t.main, 'local-edit.txt'), 'mine\n');
    const before = t.g('status', '--porcelain').toString();
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    await until(() => j.needsYou?.kind === 'refusal');
    assert.match(j.needsYou.text, /could not fast-forward/);
    assert.match(j.needsYou.status, /local-edit\.txt/);
    assert.equal(t.g('status', '--porcelain').toString(), before);
  } finally { await t.app.close(); }
});

test('F-3-13 the exo repo runs from its main checkout and only with Land: local', async () => {
  const root = tmp('rf-exo-');
  cpSync(fakeRoot, root, { recursive: true });
  const t = await boot({ land: 'none', project: root, pluginRoot: root, scenario: { id: 'run-6', phase: 'build' } });
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 200);
    const j = t.runJob();
    assert.match(j.needsYou.text, /Land: local/);
    writeFileSync(j.brief, '# Plan\n\n## Plan basis\nBranch: feat-x\nLand: local\n');
    assert.equal((await t.api('POST', `/api/jobs/${j.id}/retry`)).status, 200);
    assert.equal(j.status, 'running');
    assert.equal(j.runRoot, root);
  } finally { await t.app.close(); }
});

test('F-3-02 Reject leaves the card Shaped and clears the brief item', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('POST', '/api/cards/c1/reject')).status, 200);
    assert.equal(t.state.cards[0].lane, 'Shaped');
    assert.equal(t.state.jobs[0].needsYou, undefined);
    assert.equal((await t.api('POST', '/api/cards/c1/approve')).status, 409);
  } finally { await t.app.close(); }
});
