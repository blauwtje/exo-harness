import { test, expect } from '@playwright/test';
import { boot, repo, stateOf, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const inHours = (hours) => Math.floor(Date.now() / 1000) + hours * 3600;

const seedWith = (extra) => ({
  projects: [{ key: 'local/p', path: repo(), origin: null }],
  cards: [
    { id: 'c1', projectKey: 'local/p', title: 'First card', lane: 'Approved' },
    { id: 'c2', projectKey: 'local/p', title: 'Second card', lane: 'Approved' },
  ],
  jobs: [
    { id: 'j1', cardId: 'c1', stage: 'spec', status: 'queued', queued: { reason: 'paused' } },
    { id: 'j2', cardId: 'c2', stage: 'spec', status: 'queued', queued: { reason: 'paused' } },
  ],
  ...extra,
});

test('F-4-15 shows the stop pause banner and Resume queue clears it', async ({ page }) => {
  t = await boot({ seed: seedWith({ queue: { order: ['j1', 'j2'], pauses: [{ reason: 'stopped' }] } }) });
  await page.goto(t.deckUrl);
  await expect(page.getByRole('status').filter({ hasText: 'Stop all was used' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume queue' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stop all was used' })).toHaveCount(0);
  expect((await stateOf(t)).queue.paused).toBeNull();
});

test('F-4-07 the gauge names the ceiling and resume time and the queue reorders', async ({ page }) => {
  t = await boot({ seed: seedWith({ queue: { order: ['j1', 'j2'], pauses: [{ reason: 'limit', rateLimitType: 'five_hour', resetsAt: inHours(2) }] } }) });
  await page.goto(t.deckUrl);
  const gauge = page.locator('[data-gauge="five_hour"]');
  await expect(gauge).toContainText('ceiling 80%');
  await expect(gauge).toContainText('resumes in 2h');
  await page.getByRole('button', { name: 'Queue order' }).click();
  const items = page.getByRole('list', { name: 'Queued sessions' }).getByRole('listitem');
  await expect(items.first()).toContainText('First card');
  await page.getByRole('button', { name: 'Move First card down' }).click();
  await expect(items.first()).toContainText('Second card');
  expect((await stateOf(t)).queue.order).toEqual(['j2', 'j1']);
});

test('F-4-13 the job view labels every cost estimate and flags the idle cache write', async ({ page }) => {
  const at = Date.now();
  const row = { input: 4, output: 90, cacheRead: 7000, cacheCreation1h: 25000, cacheCreation5m: 500, costUsd: 0.0421, estimate: true };
  t = await boot({
    seed: seedWith({ jobs: [{ id: 'j1', cardId: 'c1', stage: 'spec', status: 'done', ledger: [{ at, ...row }, { at: at + 400000, ...row, idleCacheWrite: true }] }] }),
  });
  await page.goto(t.deckUrl);
  await page.evaluate(() => { location.hash = '#/jobs/j1'; });
  await page.getByRole('tab', { name: /^Cost/ }).click();
  const rows = page.getByRole('region', { name: 'Cost rows' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await expect(r).toContainText('estimate');
  await expect(rows.nth(1)).toContainText('idle cache write');
  await expect(rows.first()).not.toContainText('idle cache write');
});

test('Task 11 the top bar shows two usage bars with a label, a used percent and a reset time, and no Pause motion switch', async ({ page }) => {
  t = await boot({ steps: ['rate'] });
  const { cards } = await withCards(t, ['Ring card']);
  await page.goto(t.deckUrl);
  await t.api('POST', `/api/cards/${cards[0].id}/shape`);
  const top = page.locator('header.top');
  await expect(top.locator('[data-gauge="five_hour"]')).toContainText('42% used');
  await expect(top.locator('[data-gauge="five_hour"]')).toContainText('Session');
  await expect(top.locator('[data-gauge="five_hour"]')).toContainText(/resets in \d/);
  await expect(top.locator('[data-gauge="seven_day"]')).toContainText('18% used');
  await expect(top.locator('[data-gauge="seven_day"]')).toContainText('Week');
  await expect(top.getByRole('link', { name: 'Usage limits: Session 42% used, Week 18% used' })).toBeVisible();
  await expect(top.getByRole('switch', { name: 'Pause motion' })).toHaveCount(0);
});

test('390 the usage bars fit the top bar', async ({ page }) => {
  t = await boot({ steps: ['rate'] });
  const { cards } = await withCards(t, ['Ring card']);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(t.deckUrl);
  await t.api('POST', `/api/cards/${cards[0].id}/shape`);
  for (const id of ['five_hour', 'seven_day']) {
    const bar = page.locator(`header.top [data-gauge="${id}"]`);
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test('Task 11 the Agents page lists live sessions with plain status words and Stop all stays calm', async ({ page }) => {
  t = await boot({ seed: seedWith({ queue: { order: ['j1', 'j2'], pauses: [{ reason: 'stopped' }] } }) });
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  const rows = page.getByRole('group', { name: 'Live sessions' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('First card');
  await expect(rows.first()).toContainText('Queued');
  await expect(rows.first()).toContainText('Spec session');
  await expect(rows.first().getByRole('link')).toHaveAttribute('href', '#/jobs/j1');
  await expect(page.locator('header.top').getByRole('button', { name: 'Stop all' })).not.toHaveClass(/btn-danger/);
});
