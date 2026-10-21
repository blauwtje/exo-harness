import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { boot, stateOf, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const lane = (page, name) => page.getByRole('region', { name: new RegExp(`^${name}, \\d+ cards?$`) });
const needs = (page) => page.getByRole('region', { name: 'Needs you' });
const item = (page, kind) => needs(page).locator(`li[data-kind="${kind}"]`);
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const gitIn = (dir) => (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);

// why: C-04 counts what the user does, so every click goes through one of these two helpers.
function counter() {
  const n = { clicks: 0, approvals: 0 };
  return {
    n,
    click: async (locator) => { await locator.click(); n.clicks += 1; },
    approve: async (locator) => { await locator.click(); n.approvals += 1; },
  };
}

test('C-04 card to landed takes at most 3 clicks plus approvals', async ({ page }) => {
  t = await boot({ steps: ['brief'] });
  const { cards } = await withCards(t, ['Greet']);
  const c = counter();
  await page.goto(t.deckUrl);
  await c.click(lane(page, 'Inbox').getByRole('button', { name: 'Shape', exact: true }));
  const brief = item(page, 'brief');
  await expect(brief).toContainText('Greet');
  await c.approve(brief.getByRole('button', { name: 'Approve' }));
  await expect(lane(page, 'Done').getByRole('heading', { name: 'Greet' })).toBeVisible({ timeout: 15_000 });
  expect(c.n.clicks).toBeLessThanOrEqual(3);
  expect(c.n.approvals).toBe(1);
  const s = await stateOf(t);
  expect(s.cards.find((x) => x.id === cards[0].id).lane).toBe('Done');
  expect(s.jobs.find((j) => j.stage === 'run').status).toBe('done');
});

// why: a main checkout on main plus a linked worktree on feat-x with one changed file, as Shape leaves them.
function shapedRepo() {
  const main = tmp('deck-run-main-');
  const g = gitIn(main);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  const worktree = join(tmp('deck-run-wtp-'), 'wt');
  g('worktree', 'add', '-q', '-b', 'feat-x', worktree);
  writeFileSync(join(worktree, 'a.txt'), 'two\n');
  gitIn(worktree)('commit', '-q', '-am', 'feat');
  const brief = join(worktree, 'plan.md');
  writeFileSync(brief, '# Plan\nBranch: feat-x2\nLand: none\n');
  return { main, worktree, brief };
}

const parkedScenario = {
  id: 'g1', phase: 'parked', branch: 'feat-x', gates: [{ source: 'land', action: 'review the diff', reason: 'needs review' }],
  denied: 'rm -rf /\n', report: '# Report\nline\n', approve: { phase: 'landed' },
};

test('S-05 a parked run is a gate card with diff stat, per-file diff, report head and denied, and Approve lands it', async ({ page }) => {
  const r = shapedRepo();
  t = await boot({
    scenario: parkedScenario,
    seed: {
      projects: [{ key: 'local/p', path: r.main, origin: null }],
      cards: [{ id: 'c1', projectKey: 'local/p', title: 'Parked card', lane: 'Shaped' }],
      jobs: [{ id: 'shape1', cardId: 'c1', stage: 'spec', status: 'done', worktree: r.worktree, brief: r.brief, needsYou: { kind: 'brief', options: ['approve', 'reject'] } }],
    },
  });
  const c = counter();
  await page.goto(t.deckUrl);
  await c.approve(item(page, 'brief').getByRole('button', { name: 'Approve' }));
  const gate = item(page, 'gate');
  await expect(gate).toContainText('review the diff', { timeout: 15_000 });
  await expect(gate).toContainText('feat-x');
  await expect(gate.getByLabel('Diff stat')).toContainText('a.txt');
  await expect(gate.getByLabel('Report head')).toContainText('# Report');
  await expect(gate).toContainText('rm -rf /');
  await c.click(gate.getByRole('list', { name: 'Changed files' }).getByRole('button', { name: 'a.txt' }));
  await expect(gate.getByLabel('Diff of a.txt')).toContainText('+two');
  await c.approve(gate.getByRole('button', { name: 'Approve' }));
  await expect(lane(page, 'Done').getByRole('heading', { name: 'Parked card' })).toBeVisible({ timeout: 15_000 });
  await expect(item(page, 'gate')).toHaveCount(0);
  expect(c.n.approvals).toBe(2);
});
