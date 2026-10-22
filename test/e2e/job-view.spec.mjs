import { test, expect } from '@playwright/test';
import { boot, repo, stateOf, until, USAGE, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const num = (n) => Number(n).toLocaleString('en-US');
const openTab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
const ledgerRow = (page, label) => page.getByRole('region', { name: 'Cost' }).locator('.ledger-row').filter({ has: page.getByText(label, { exact: true }) });

async function shapeAndOpen(page, steps, title = 'Greet') {
  t = await boot({ steps });
  const { cards } = await withCards(t, [title]);
  const { body: job } = await t.api('POST', `/api/cards/${cards[0].id}/shape`);
  await page.goto(`${t.deckUrl}`);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await page.evaluate((id) => { location.hash = `#/jobs/${id}`; }, job.id);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return job;
}

test('the timeline updates live as events arrive', async ({ page }) => {
  const job = await shapeAndOpen(page, ['rate', 'say:Reading the repo first', 'tool', 'ask', 'say:Second line after the answer', 'brief']);
  const timeline = page.getByRole('tabpanel', { name: /^Agent output/ });
  await expect(timeline).toContainText('Reading the repo first');
  await expect(timeline).not.toContainText('src/greet.mjs');
  await timeline.getByRole('button', { name: /system events?$/ }).click();
  await expect(timeline).toContainText('Read');
  await expect(timeline).toContainText('src/greet.mjs');
  await expect(timeline).not.toContainText('Second line after the answer');
  const ask = await until(async () => (await stateOf(t)).pending[0]);
  await t.api('POST', `/api/jobs/${job.id}/permission`, { requestId: ask.requestId, allow: true, answers: { 'Which greeting style?': 'Casual' } });
  await expect(timeline).toContainText('Second line after the answer');
  await expect(timeline).toContainText('Turn finished');
});

test('the raw transcript is one click away', async ({ page }) => {
  await shapeAndOpen(page, ['say:Hello from the agent', 'ask']);
  await page.getByRole('tab', { name: /^History/ }).click();
  const raw = page.getByRole('tabpanel', { name: /^History/ });
  await expect(raw).toContainText('"subtype":"init"');
  await expect(raw).toContainText('Hello from the agent');
  await page.getByRole('tab', { name: /^Agent output/ }).click();
  await expect(page.getByRole('tabpanel', { name: /^Agent output/ })).toContainText('Hello from the agent');
});

test('the cost shows tokens, cache fields, estimated cost, model and versions', async ({ page }) => {
  await shapeAndOpen(page, ['tool', 'brief']);
  await openTab(page, 'Cost');
  const mu = Object.values(USAGE.modelUsage)[0];
  const c = USAGE.usage.cache_creation;
  await expect(ledgerRow(page, 'Input tokens')).toContainText(num(mu.inputTokens));
  await expect(ledgerRow(page, 'Output tokens')).toContainText(num(mu.outputTokens));
  await expect(ledgerRow(page, 'Cache read')).toContainText(num(mu.cacheReadInputTokens));
  await expect(ledgerRow(page, 'Cache write')).toContainText(num(mu.cacheCreationInputTokens));
  await expect(ledgerRow(page, 'of which 1 hour')).toContainText(num(c.ephemeral_1h_input_tokens));
  await expect(ledgerRow(page, 'of which 5 minute')).toContainText(num(c.ephemeral_5m_input_tokens));
  await expect(ledgerRow(page, 'All tokens')).toContainText(num(mu.inputTokens + mu.outputTokens + mu.cacheReadInputTokens + mu.cacheCreationInputTokens));
  await expect(ledgerRow(page, 'Estimated cost')).toContainText(`$${USAGE.total_cost_usd.toFixed(4)}`);
  await expect(ledgerRow(page, 'Estimated cost')).toContainText('est.');
  const job = (await stateOf(t)).jobs[0];
  await expect(ledgerRow(page, 'Model')).toContainText(Object.keys(USAGE.modelUsage)[0]);
  await expect(ledgerRow(page, 'Claude Code')).toContainText(job.claudeCodeVersion);
  await expect(ledgerRow(page, 'exo plugin')).toContainText(job.exoVersion);
});

test('the cache-write split never exceeds or contradicts its parent', async ({ page }) => {
  await shapeAndOpen(page, ['say:one', 'say:two', 'brief']);
  await openTab(page, 'Cost');
  const write = USAGE.usage.cache_creation_input_tokens;
  await expect(ledgerRow(page, 'Cache write')).toContainText(num(write));
  await expect(ledgerRow(page, 'of which 1 hour')).toContainText(num(USAGE.usage.cache_creation.ephemeral_1h_input_tokens));
  await expect(ledgerRow(page, 'of which 5 minute')).toContainText(num(USAGE.usage.cache_creation.ephemeral_5m_input_tokens));
});

test('Stop ends one live session', async ({ page }) => {
  const job = await shapeAndOpen(page, ['ask']);
  const stop = page.getByRole('button', { name: 'Stop session' });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.locator('.job-sub').getByText('Stopped')).toBeVisible();
  expect((await stateOf(t)).jobs.find((j) => j.id === job.id).status).toBe('stopped');
});

test('a live session with a main action still offers Stop session', async ({ page }) => {
  t = await boot({
    seed: {
      projects: [{ key: 'local/p', path: repo(), origin: null }],
      cards: [{ id: 'c1', projectKey: 'local/p', title: 'Limit card', lane: 'Running' }],
      jobs: [{ id: 'j1', cardId: 'c1', stage: 'run', status: 'running', needsYou: { kind: 'limit' } }],
    },
  });
  await page.goto(t.deckUrl);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/jobs/j1'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Limit card' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop session' })).toBeVisible();
});

test('Stop all asks first, then stops every live session', async ({ page }) => {
  t = await boot({ steps: ['ask'] });
  const { cards } = await withCards(t, ['One', 'Two']);
  for (const c of cards) await t.api('POST', `/api/cards/${c.id}/shape`);
  await page.goto(t.deckUrl);
  const all = page.getByRole('button', { name: 'Stop all' });
  await expect(all).toBeEnabled();
  await all.click();
  const dialog = page.getByRole('dialog', { name: 'Stop all sessions' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await stateOf(t)).jobs.every((j) => j.status !== 'stopped')).toBe(true);
  await all.click();
  await page.getByRole('dialog', { name: 'Stop all sessions' }).getByRole('button', { name: /^Stop \d+ sessions?$/ }).click();
  await until(async () => (await stateOf(t)).jobs.every((j) => j.status === 'stopped'));
  await expect(all).toHaveCount(0);
});

test('a run session shows its exo run fields', async ({ page }) => {
  const run = { id: 'run-7', phase: 'parked', stage: 'build', branch: 'feat-greet', task: 3, landed: 2, total: 5, reason: 'gate: review the diff', runRoot: '/tmp/deck-run-root' };
  t = await boot({
    seed: {
      projects: [{ key: 'local/p', path: repo(), origin: null }],
      cards: [{ id: 'c1', projectKey: 'local/p', title: 'Run card', lane: 'Review' }],
      jobs: [{ id: 'run1', cardId: 'c1', stage: 'run', status: 'stopped', run }],
    },
  });
  await page.goto(`${t.deckUrl}`);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/jobs/run1'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Run card' })).toBeVisible();
  await openTab(page, 'Sessions');
  const runRow = (label) => page.getByRole('region', { name: 'Run' }).locator('.ledger-row').filter({ has: page.getByText(label, { exact: true }) });
  const want = { 'Run id': run.id, Phase: run.phase, Stage: run.stage, Branch: run.branch, Task: '3', Landed: '2', 'Total tasks': '5', Reason: run.reason, 'Run root': run.runRoot };
  for (const [label, value] of Object.entries(want)) await expect(runRow(label)).toContainText(value);
  await expect(page.getByRole('button', { name: 'Send reply' })).toHaveCount(0);
});

test('Back to board returns home', async ({ page }) => {
  await shapeAndOpen(page, ['ask']);
  await page.getByRole('link', { name: 'Back to board', exact: true }).click();
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Greet' })).toHaveCount(0);
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);
});

test('the footer main action label follows the stage', async ({ page }) => {
  const run = { id: 'run-8', phase: 'parked', stage: 'build', branch: 'feat-greet', reason: 'gate: review the diff' };
  t = await boot({
    seed: {
      projects: [{ key: 'local/p', path: repo(), origin: null }],
      cards: [
        { id: 'c1', projectKey: 'local/p', title: 'Brief card', lane: 'Shaped' },
        { id: 'c2', projectKey: 'local/p', title: 'Build gate card', lane: 'Approved' },
        { id: 'c3', projectKey: 'local/p', title: 'Review gate card', lane: 'Review' },
      ],
      jobs: [
        { id: 'j1', cardId: 'c1', stage: 'spec', status: 'done', needsYou: { kind: 'brief', options: ['approve', 'reject'] } },
        { id: 'j2', cardId: 'c2', stage: 'run', status: 'stopped', run, needsYou: { kind: 'gate' } },
        { id: 'j3', cardId: 'c3', stage: 'run', status: 'stopped', run, needsYou: { kind: 'gate' } },
      ],
    },
  });
  await page.goto(`${t.deckUrl}`);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  const want = { j1: ['Brief card', 'Approve'], j2: ['Build gate card', 'Approve'], j3: ['Review gate card', 'Merge'] };
  for (const [id, [title, label]] of Object.entries(want)) {
    await page.evaluate((h) => { location.hash = h; }, `#/jobs/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const main = page.locator('footer.job-foot').getByRole('button');
    await expect(main).toHaveCount(1);
    await expect(main).toHaveText(label);
  }
});
