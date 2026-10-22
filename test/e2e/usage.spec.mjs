import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, until, stateOf, withCards } from './fixture.mjs';

let t;
test.afterEach(async () => { await t?.close(); t = null; });

const RESETS = /Resets (today|tomorrow|Sun|Mon|Tue|Wed|Thu|Fri|Sat|\d{1,2} [A-Z][a-z]{2}) \d\d:\d\d/;
const STAGES = Object.keys(JSON.parse(readFileSync(new URL('../../config/stages.json', import.meta.url), 'utf8')).stages);

const bootWithAccounts = async () => {
  t = await boot({ accounts: true });
  await withCards(t, ['Usage card']);
};

const openUsage = async (page) => {
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Usage', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Usage' })).toBeVisible();
};

test('U1 every limit of each account shows a bar, percent used, reset time and time left', async ({ page }) => {
  await bootWithAccounts();
  await openUsage(page);
  const accounts = (await stateOf(t)).accounts;
  expect(accounts.length).toBe(2);
  for (const account of accounts) {
    const list = page.getByRole('list', { name: `Limits for ${account.name}` });
    await expect(list.getByRole('listitem')).toHaveCount(account.limits.length);
    for (const limit of account.limits) {
      const row = list.locator(`[data-limit="${limit.id}"]`);
      await expect(row).toContainText(limit.label);
      await expect(row).toContainText(`${Math.round(limit.percent)}% used`);
      await expect(row.locator('.limit-bar')).toBeVisible();
      await expect(row.locator('.limit-when')).toHaveText(RESETS);
      await expect(row.locator('.limit-left')).toHaveText(/^in \d/);
    }
  }
  await expect(page.getByRole('list', { name: 'Limits for Main' })).toContainText('Fable');
});

test('U2 each account shows its plan and renewal, marked when counted from the start date', async ({ page }) => {
  await bootWithAccounts();
  await openUsage(page);
  for (const account of (await stateOf(t)).accounts) {
    const section = page.locator(`[data-account="${account.id}"]`);
    await expect(section.locator('.acct-plan')).toHaveText(account.plan.label);
    const day = new Date(account.renewsAt).getDate();
    await expect(section.locator('.acct-renews')).toContainText(new RegExp(`Renews ${day} [A-Z][a-z]{2}`));
    if (account.renewsEstimated) await expect(section.locator('.acct-renews')).toContainText('counted from your start date');
  }
  await expect(page.locator('[data-account="default"] .acct-plan')).toHaveText('Max (5x)');
});

test('U1 a session or weekly limit names its ceiling and links to the Settings explanation', async ({ page }) => {
  await bootWithAccounts();
  await openUsage(page);
  const ceilings = await page.locator('.limit-ceiling');
  await expect(ceilings.first()).toBeVisible();
  const link = ceilings.first().getByRole('link');
  await expect(link).toHaveText(/^Ceiling \d+%/);
  await expect(link).toHaveAttribute('href', '#/settings');
  for (const text of await page.locator('.limit-when').allInnerTexts()) expect(text).not.toMatch(/ {2}/);
});

test('U3 a limit whose reset time has passed shows No fresh reading, not the old percent', async ({ page }) => {
  await bootWithAccounts();
  const file = join(t.dir, 'accounts', 'work', '.claude.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const session = raw.cachedUsageUtilization.limits.find((l) => l.kind === 'session');
  session.resets_at = new Date(Date.now() - 60_000).toISOString();
  writeFileSync(file, JSON.stringify(raw));
  await until(async () => (await stateOf(t)).accounts.find((a) => a.id === 'work').limits.some((l) => l.stale));

  await openUsage(page);
  const row = page.getByRole('list', { name: 'Limits for Work' }).locator('[data-limit][data-fresh="false"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('No fresh reading');
  await expect(row).not.toContainText(`${session.percent}%`);
});

test('adds an account and removes it', async ({ page }) => {
  await bootWithAccounts();
  await openUsage(page);
  await page.getByLabel('Name').fill('Side');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Side.' })).toBeVisible();
  const side = page.locator('section.acct', { has: page.getByRole('heading', { name: 'Side' }) });
  await expect(side).toBeVisible();
  expect((await stateOf(t)).accounts.map((a) => a.name)).toContain('Side');

  await side.getByRole('button', { name: 'Remove', exact: true }).click();
  await side.getByRole('button', { name: 'Remove Side' }).click();
  await expect(side).toHaveCount(0);
  expect((await stateOf(t)).accounts.map((a) => a.name)).not.toContain('Side');
});

test('A1 picks the account per agent kind on the Agents page and saves it', async ({ page }) => {
  await bootWithAccounts();
  await page.goto(t.deckUrl);
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  const rows = page.locator('.aa-row');
  await expect(rows).toHaveCount(STAGES.length);
  for (const stage of STAGES) await expect(page.locator(`.aa-row[data-stage="${stage}"]`)).toHaveCount(1);

  const plan = page.getByRole('radiogroup', { name: 'Plan' });
  await plan.getByRole('radio', { name: 'Work' }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Plan uses Work.' })).toBeVisible();
  expect((await t.api('GET', '/api/settings')).body.accountByStage.spec).toBe('work');

  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Plan' }).getByRole('radio', { name: 'Work' })).toBeChecked();
});
