import { test, expect } from '@playwright/test';
import { boot, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

test('F-4-02 saves settings and refuses an out-of-range ceiling', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Settings card']);
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  await page.getByLabel('Seven-day ceiling').fill('50');
  await page.getByLabel('Concurrent sessions').fill('3');
  await page.getByLabel('Landing default').selectOption('pr');
  await page.getByLabel('Scouts enabled').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const saved = (await t.api('GET', '/api/settings')).body;
  expect(saved).toMatchObject({ ceilings: { sevenDay: 0.5 }, maxConcurrent: 3, landDefault: 'pr', scouts: { enabled: true } });

  await page.getByLabel('Five-hour ceiling').fill('150');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ceilings' })).toBeVisible();
  expect((await t.api('GET', '/api/settings')).body.ceilings.fiveHour).toBe(saved.ceilings.fiveHour);
});

test('F-7-01 picks Needs you kinds and an alert per kind, sending every alert', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Settings card']);
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  const healthAlert = page.getByLabel('Alert for Health', { exact: true });
  await expect(page.getByLabel('Question', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Health', { exact: true })).not.toBeChecked();
  await expect(healthAlert).toBeDisabled();

  await page.getByLabel('Health', { exact: true }).check();
  await expect(healthAlert).toBeEnabled();
  await healthAlert.selectOption('app');
  await page.getByLabel('Sound for Health', { exact: true }).check();
  await page.getByLabel('Alert for Question', { exact: true }).selectOption('app');
  await page.getByLabel('Permission', { exact: true }).uncheck();
  await expect(page.getByLabel('Alert for Permission', { exact: true })).toBeDisabled();
  await expect(page.locator('#set-needs').getByText('Not saved')).toBeVisible();

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const saved = (await t.api('GET', '/api/settings')).body;
  expect(saved.needsYou).toContain('health');
  expect(saved.needsYou).not.toContain('permission');
  expect(saved.alerts.health).toEqual({ where: 'app', sound: true });
  expect(saved.alerts.question).toEqual({ where: 'app', sound: false });
  expect(Object.keys(saved.alerts)).toHaveLength(16);

  await page.getByLabel('Alert for Health', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const again = (await t.api('GET', '/api/settings')).body;
  expect(again.alerts.health).toEqual({ where: 'none', sound: true });
  expect(again.alerts.question).toEqual({ where: 'app', sound: false });
});

const openSettings = async (page) => {
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#set-display')).toBeVisible();
};

test('T3 Pause motion lives in Settings, pauses motion and persists after a reload', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Settings card']);
  await openSettings(page);
  const pause = page.locator('#set-display').getByRole('switch', { name: 'Pause motion' });
  await expect(pause).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'paused');

  await pause.click();
  await expect(pause).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
  const looping = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.animation = 'spin 1s infinite';
    document.body.append(probe);
    const count = getComputedStyle(probe).animationIterationCount;
    probe.remove();
    return count;
  });
  expect(looping).toBe('1');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#set-display').getByRole('switch', { name: 'Pause motion' })).toHaveAttribute('aria-checked', 'true');
});

test('T3 at 390 px the Pause motion label fits inside its section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  t = await boot();
  await withCards(t, ['Settings card']);
  await page.goto(t.deckUrl);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#set-display')).toBeVisible();
  const pause = page.locator('#set-display').getByRole('switch', { name: 'Pause motion' });
  await pause.scrollIntoViewIfNeeded();
  const fit = await pause.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const sec = el.closest('.set-sec').getBoundingClientRect();
    return { inside: box.left >= sec.left && box.right <= sec.right, clipped: el.scrollWidth > el.clientWidth, right: box.right, width: innerWidth };
  });
  expect(fit.inside).toBe(true);
  expect(fit.clipped).toBe(false);
  expect(fit.right).toBeLessThanOrEqual(fit.width);
});

test('C1 Settings explains in plain words why a ceiling sits below 100%', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Settings card']);
  await openSettings(page);
  const why = page.locator('#set-limits').getByRole('note', { name: 'Why a ceiling sits below 100%' });
  await expect(why).toBeVisible();
  await expect(why).toContainText('only holds back new sessions');
  await expect(why).toContainText('Sessions already running keep spending');
  await expect(why).toContainText('weekly limit');
});
