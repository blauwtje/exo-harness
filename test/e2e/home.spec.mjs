import { test, expect } from '@playwright/test';
import { boot, stateOf, until, withCards } from './fixture.mjs';

const LANES = ['Inbox', 'Planned', 'Approved', 'Queued', 'Running', 'Review', 'Done'];
const STAGES = ['Inbox', 'Shaped', 'Approved', 'Queued', 'Running', 'Review', 'Done'];
const BUSY_TITLES = ['Add a greeting command', 'Fix the --help output', 'Document the config file', 'Rename the data dir flag', 'Handle a missing token', 'Add retry to gh calls', 'Trim the transcript view', 'Show cache split in ledger', 'Warn on stale worktrees', 'Pin the plugin version', 'Explain the five hour gauge', 'Add keyboard shortcuts', 'Cut cold start time', 'Write the release notes'];
let t;
test.afterEach(async () => { await t?.close(); t = null; });

const stops = (page) => page.getByRole('list', { name: 'Stations' }).locator('.stop');
const stop = (page, name) => page.getByRole('list', { name: 'Stations' }).locator(`.stop[data-lane="${name}"]`);
const lane = (page, word) => page.getByRole('region', { name: new RegExp(`^${word}, \\d+ tasks?$`) });
const needs = (page) => page.getByRole('region', { name: 'Needs you' });

async function drag({ page, from, to }) {
  const a = await from.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  const b = await to.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('stations render in stage order', async ({ page }) => {
  t = await boot();
  await withCards(t, ['First car']);
  await page.goto(t.deckUrl);
  await expect(stops(page)).toHaveCount(LANES.length);
  const order = await stops(page).evaluateAll((els) => els.map((el) => el.dataset.lane));
  expect(order).toEqual(STAGES);
  await expect(stops(page).locator('.stop-name')).toHaveText(LANES);
  await expect(lane(page, 'Inbox')).toContainText('First car');
});

test('a busy station folds to three cars plus "+N more"', async ({ page }) => {
  t = await boot();
  await withCards(t, ['One', 'Two', 'Three', 'Four', 'Five']);
  await page.goto(t.deckUrl);
  const inbox = lane(page, 'Inbox');
  await expect(inbox.locator('[data-card]')).toHaveCount(3);
  const more = inbox.getByRole('button', { name: '+2 more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(inbox.locator('[data-card]')).toHaveCount(5);
  await expect(inbox.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
});

test('H1 an empty station shrinks to its name and 0 on the line, with no "Nothing here" box', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Only car']);
  await page.goto(t.deckUrl);
  await expect(lane(page, 'Inbox')).toContainText('Only car');
  const planned = stop(page, 'Shaped');
  await expect(planned.locator('.stop-name')).toHaveText('Planned');
  await expect(planned.locator('.stop-count')).toHaveText('0 tasks');
  await expect(planned).toHaveAttribute('data-load', 'false');
  await expect(stop(page, 'Inbox').locator('.stop-count')).toHaveText('1 task');
  await expect(lane(page, 'Planned')).toHaveCount(0);
  await expect(page.getByText('Nothing here')).toHaveCount(0);
});

test('H2 with nothing waiting, Needs you is one quiet line at most 48 px high at 1440', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Calm car']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(t.deckUrl);
  await expect(needs(page)).toContainText('Nothing waits for you');
  const block = page.locator('[data-block="needs"]');
  expect((await block.boundingBox()).height).toBeLessThanOrEqual(48);
  expect((await needs(page).boundingBox()).height).toBeLessThanOrEqual(48);
});

test('H3 home has three blocks only: Needs you, the station line, the task cards', async ({ page }) => {
  t = await boot();
  await withCards(t, ['One car', 'Two car']);
  await page.goto(t.deckUrl);
  await expect(lane(page, 'Inbox')).toContainText('Two car');
  const main = page.locator('main');
  const blocks = await main.locator('[data-block]').evaluateAll((els) => els.map((el) => el.dataset.block));
  expect(blocks).toEqual(['needs', 'line', 'cards']);
  await expect(main.locator('h2:visible')).toHaveText(['Needs you']);
  await expect(main.getByRole('heading', { name: 'Board', exact: true })).toHaveCount(0);
  const stray = await main.evaluate((home) => [...home.querySelectorAll('h2, h3, h4, section, article')]
    .filter((el) => !el.closest('[data-block]') && el.offsetParent !== null && !el.querySelector('[data-block]'))
    .map((el) => `${el.tagName}: ${el.textContent.trim().slice(0, 40)}`));
  expect(stray).toEqual([]);
});

test('H4 at 1440x900 with the busy setup, waiting items and running tasks show without scrolling', async ({ page }) => {
  test.setTimeout(60_000);
  t = await boot({ initFor: { 8: { permissionMode: 'bypassPermissions' } }, steps: ['rate', 'tool', 'say:Working through the plan.', '@2:ask', '@3:perm', '@4:perm', '@5:text-question', '@1,6,7:say:Still building.'] });
  const { cards } = await withCards(t, BUSY_TITLES);
  for (const c of cards.slice(0, 8)) {
    await t.api('POST', `/api/cards/${c.id}/shape`);
    await until(async () => (await stateOf(t)).jobs.length > 0);
    await new Promise((r) => setTimeout(r, 400));
  }
  await until(async () => (await stateOf(t)).pending.length >= 3);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(t.deckUrl);
  const running = lane(page, 'Running');
  await expect(running.locator('[data-card]').first()).toBeVisible();
  await expect(needs(page).getByRole('button').first()).toBeVisible();
  const viewport = await page.evaluate(() => ({ h: innerHeight, scrollY }));
  expect(viewport.scrollY).toBe(0);
  const needsBox = await needs(page).boundingBox();
  expect(needsBox.y + needsBox.height).toBeLessThanOrEqual(viewport.h);
  const runningBoxes = await running.locator('[data-card]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
  expect(runningBoxes.length).toBeGreaterThan(0);
  await expect(running.getByRole('button', { name: /more$/ })).toHaveCount(0);
  await expect(stop(page, 'Running').locator('.stop-count')).toHaveText(`${runningBoxes.length} task${runningBoxes.length === 1 ? '' : 's'}`);
  for (const bottom of runningBoxes) expect(bottom).toBeLessThanOrEqual(viewport.h);
});

for (const width of [1440, 1024, 390]) {
  test(`H5 home has no horizontal scroll at ${width}`, async ({ page }) => {
    t = await boot({ steps: ['brief'] });
    const { cards } = await withCards(t, ['Add a greeting command', 'Fix the --help output', 'Document the config file']);
    await t.api('POST', `/api/cards/${cards[0].id}/shape`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(t.deckUrl);
    await expect(needs(page)).toContainText('Approve the brief?');
    await expect(lane(page, 'Inbox')).toContainText('Fix the --help output');
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement;
      const main = document.querySelector('main');
      return { page: el.scrollWidth - el.clientWidth, main: main.scrollWidth - main.clientWidth };
    });
    expect(overflow).toEqual({ page: 0, main: 0 });
  });
}

test('a car opens its job page on click', async ({ page }) => {
  t = await boot({ steps: ['brief'] });
  const { cards } = await withCards(t, ['Greet']);
  await t.api('POST', `/api/cards/${cards[0].id}/shape`);
  const job = await until(async () => (await stateOf(t)).jobs.find((j) => j.cardId === cards[0].id));
  await page.goto(t.deckUrl);
  await lane(page, 'Planned').getByRole('button', { name: 'Greet', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/jobs/${job.id}$`));
});

test('dragging a car from Inbox to Planned calls the plan API', async ({ page }) => {
  t = await boot({ steps: ['brief'] });
  const { cards } = await withCards(t, ['Dragged']);
  await page.goto(t.deckUrl);
  const planned = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/cards/${cards[0].id}/shape`));
  await drag({ page, from: page.locator(`[data-card="${cards[0].id}"]`), to: stop(page, 'Shaped') });
  await planned;
  await expect(lane(page, 'Planned').getByRole('heading', { name: 'Dragged' })).toBeVisible();
  expect((await stateOf(t)).jobs).toHaveLength(1);
});
