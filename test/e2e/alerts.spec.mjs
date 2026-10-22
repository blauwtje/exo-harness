import { test, expect } from '@playwright/test';
import { boot, repo, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const stubs = () => {
  window.__sounds = 0;
  window.__desktop = [];
  window.AudioContext = class {
    constructor() { window.__sounds += 1; this.destination = {}; this.currentTime = 0; }
    createOscillator() { return { connect() {}, start() {}, stop() { setTimeout(() => this.onended?.(), 0); } }; }
    close() {}
  };
  window.Notification = class {
    static permission = 'granted';
    constructor(title, opts) { window.__desktop.push({ title, body: opts.body }); }
  };
};

const plan = (page) => page.getByRole('button', { name: 'Plan', exact: true }).click();

test('an in-app alert with sound fires once for a new picked item', async ({ page }) => {
  t = await boot({ steps: ['ask', 'brief'] });
  await withCards(t, ['Greet']);
  await t.api('PUT', '/api/settings', { alerts: { question: { where: 'app', sound: true } } });
  await page.addInitScript(stubs);
  await page.goto(t.deckUrl);
  await expect(page.getByRole('button', { name: 'Plan', exact: true })).toBeVisible();
  await plan(page);
  const toast = page.getByRole('status', { name: 'Alerts' }).locator('.toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('Question');
  await expect(toast).toContainText('Greet');
  expect(await page.evaluate(() => window.__sounds)).toBe(1);
  expect(await page.evaluate(() => window.__desktop.length)).toBe(0);
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
});

test('a desktop alert goes to the system and stays out of the app', async ({ page }) => {
  t = await boot({ steps: ['ask', 'brief'] });
  await withCards(t, ['Greet']);
  await t.api('PUT', '/api/settings', { alerts: { question: { where: 'system', sound: false } } });
  await page.addInitScript(stubs);
  await page.goto(t.deckUrl);
  await plan(page);
  await expect.poll(() => page.evaluate(() => window.__desktop.length)).toBe(1);
  expect(await page.evaluate(() => window.__desktop[0].title)).toBe('Question');
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sounds)).toBe(0);
});

test('a kind with no alert, or one not picked, stays quiet', async ({ page }) => {
  t = await boot({ steps: ['ask', 'brief'] });
  await withCards(t, ['Greet']);
  await t.api('PUT', '/api/settings', { needsYou: ['brief'], alerts: { question: { where: 'app', sound: true }, brief: { where: 'none', sound: true } } });
  await page.addInitScript(stubs);
  await page.goto(t.deckUrl);
  await plan(page);
  await expect(page.getByRole('button', { name: /^Quiet history/ })).toContainText('1');
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sounds)).toBe(0);
});

test('items already there raise no alert when the settings arrive after the state', async ({ page }) => {
  t = await boot({
    seed: {
      projects: [{ key: 'local/p', path: repo(), origin: null }],
      cards: [{ id: 'c1', projectKey: 'local/p', title: 'Crashed card', lane: 'Approved' }],
      jobs: [{ id: 'j1', cardId: 'c1', stage: 'run', status: 'crashed' }],
    },
  });
  await t.api('PUT', '/api/settings', { needsYou: ['failure'], alerts: { failure: { where: 'app', sound: true } } });
  await page.addInitScript(stubs);
  await page.route('**/api/settings', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto(t.deckUrl);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Quiet history/ })).toContainText('1');
  await expect(page.getByText('Crashed card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('li[data-kind="failure"]').length)).toBe(1);
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sounds)).toBe(0);
});

test('a blocked sound is reported in the console and the toast still shows', async ({ page }) => {
  t = await boot({ steps: ['ask', 'brief'] });
  await withCards(t, ['Greet']);
  await t.api('PUT', '/api/settings', { alerts: { question: { where: 'app', sound: true } } });
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.addInitScript(() => { window.AudioContext = class { constructor() { throw new Error('autoplay blocked'); } }; });
  await page.goto(t.deckUrl);
  await plan(page);
  await expect(page.locator('.toast')).toHaveCount(1);
  expect(warnings.join('\n')).toContain('autoplay blocked');
});
