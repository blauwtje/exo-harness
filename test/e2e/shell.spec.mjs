import { test, expect } from '@playwright/test';
import { boot, repo, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const seed = (jobs) => ({
  projects: [{ key: 'local/p', path: repo(), origin: null }],
  cards: [{ id: 'c1', projectKey: 'local/p', title: 'Running card', lane: 'Running' }, { id: 'c2', projectKey: 'local/p', title: 'Queued card', lane: 'Queued' }],
  jobs,
});

test('T1 the top bar draws no rings; usage shows as flat bars with a label, % used and a reset time', async ({ page }) => {
  t = await boot({ steps: ['rate'] });
  const { cards } = await withCards(t, ['Bar card']);
  await page.goto(t.deckUrl);
  await t.api('POST', `/api/cards/${cards[0].id}/shape`);
  const top = page.locator('header.top');
  await expect(top.locator('[data-gauge="five_hour"]')).toContainText('% used');
  await expect(top.locator('.ring, circle')).toHaveCount(0);
  for (const [id, label] of [['five_hour', 'Session'], ['seven_day', 'Week']]) {
    const bar = top.locator(`[data-gauge="${id}"]`);
    await expect(bar).toContainText(label);
    await expect(bar).toContainText(/\d+% used/);
    await expect(bar).toContainText(/resets in \d/);
    await expect(bar.locator('.gbar-track')).toBeVisible();
  }
});

test('T2 the top bar never says "live" and counts agents working', async ({ page }) => {
  t = await boot({ seed: seed([{ id: 'j1', cardId: 'c1', stage: 'run', status: 'running' }, { id: 'j2', cardId: 'c2', stage: 'spec', status: 'queued', queued: { reason: 'paused' } }]) });
  await page.goto(t.deckUrl);
  const top = page.locator('header.top');
  await expect(top).toContainText('1 agent working');
  expect(await top.innerText()).not.toMatch(/\blive\b/i);
});

test('T2 the top bar and the sidebar badge count working agents with one rule: live, not queued, not waiting on you', async ({ page }) => {
  t = await boot({ seed: {
    projects: [{ key: 'local/p', path: repo(), origin: null }],
    cards: [
      { id: 'c1', projectKey: 'local/p', title: 'Running card', lane: 'Running' },
      { id: 'c2', projectKey: 'local/p', title: 'Queued card', lane: 'Queued' },
      { id: 'c3', projectKey: 'local/p', title: 'Asking card', lane: 'Running' },
    ],
    jobs: [
      { id: 'j1', cardId: 'c1', stage: 'run', status: 'running' },
      { id: 'j2', cardId: 'c2', stage: 'spec', status: 'queued', queued: { reason: 'paused' } },
      { id: 'j3', cardId: 'c3', stage: 'spec', status: 'waiting', needsYou: { kind: 'brief' } },
    ],
  } });
  await page.goto(t.deckUrl);
  await expect(page.locator('header.top')).toContainText('1 agent working');
  await expect(page.getByRole('button', { name: /^local\/p, 1 working/ })).toBeVisible();
});

test('MUST 9 Agents, Usage and Settings show their title once, as the page h1', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Header card']);
  await page.goto(t.deckUrl);
  for (const [hash, title] of [['#/agents', 'Agents'], ['#/usage', 'Usage'], ['#/settings', 'Settings']]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('header.top h1')).toHaveCount(0);
  }
});

test('S1 a live link shows no "Connected"; a bad token shows Not connected', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Link card']);
  await page.goto(t.deckUrl);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  await expect(page.getByText('Connected', { exact: false })).toHaveCount(0);
  await expect(page.locator('[aria-label="Connected"]')).toHaveCount(0);
  await page.goto(`http://127.0.0.1:${t.port}/#token=${'x'.repeat(40)}`);
  await page.reload();
  await expect(page.locator('.sidebar .linkstate')).toHaveText('Not connected');
});

test('S2 Agents goes to a full page with h1 Agents and no side panel', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Agents card']);
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page).toHaveURL(/#\/agents$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(page.locator('.crew, aside#crew-panel')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects' })).toContainText('Add project');
  await page.getByRole('link', { name: 'Usage', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Usage' })).toBeVisible();
});

test('L1 body, sidebar, top bar and main are dark (relative luminance below 0.08)', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Dark card']);
  await page.goto(t.deckUrl);
  await expect(page.getByRole('group', { name: /^Board for / })).toBeVisible();
  const lum = await page.evaluate(() => {
    const paintedBackgroundOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g).map(Number);
        if (m.length < 4 || m[3] > 0) return m;
      }
      return [255, 255, 255];
    };
    const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return Object.fromEntries(['body', '.sidebar', 'header.top', 'main'].map((s) => [s, L(paintedBackgroundOf(document.querySelector(s)))]));
  });
  for (const [surface, l] of Object.entries(lum)) expect(l, surface).toBeLessThan(0.08);
});
