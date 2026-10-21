import { test, expect } from '@playwright/test';
import { boot, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

test('F-4-02 saves settings and refuses an out-of-range ceiling', async ({ page }) => {
  t = await boot();
  await withCards(t, ['Settings card']);
  await page.goto(t.deckUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await page.getByLabel('Seven-day ceiling').fill('50');
  await page.getByLabel('Concurrent jobs').fill('3');
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
