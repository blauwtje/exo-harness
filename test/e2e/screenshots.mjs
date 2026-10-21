import { chromium } from '@playwright/test';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { boot, stateOf, until, withCards } from './fixture.mjs';

const OUT = fileURLToPath(new URL('../../docs/design/', import.meta.url));
mkdirSync(OUT, { recursive: true });
execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });

const browser = await chromium.launch();
const shot = async (url, name, { width, height = 900, then } = {}) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  await page.getByRole('main').or(page.locator('main')).first().waitFor();
  await then?.(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.close();
};
const ready = (page) => page.getByRole('group', { name: /^Board for / }).waitFor();

{
  const t = await boot({ steps: ['rate', 'tool', 'say:Reading the existing greeting helpers before writing the brief.', 'ask', 'brief'] });
  const { cards } = await withCards(t, ['Add a greeting command', 'Fix the --help output', 'Document the config file']);
  const job = (await t.api('POST', `/api/cards/${cards[0].id}/shape`)).body;
  await until(async () => (await stateOf(t)).pending.length);
  const ask = (await stateOf(t)).pending[0];
  await t.api('POST', `/api/jobs/${job.id}/permission`, { requestId: ask.requestId, allow: true, answers: { 'Which greeting style?': 'Casual' } });
  await until(async () => (await stateOf(t)).jobs[0].status === 'done');
  for (const width of [1440, 1024]) {
    await shot(t.deckUrl, `board-${width}`, { width, then: ready });
    await shot(t.deckUrl, `job-${width}`, { width, then: async (page) => { await ready(page); await page.evaluate((id) => { location.hash = `#/jobs/${id}`; }, job.id); await page.getByRole('region', { name: 'Ledger' }).waitFor(); } });
  }
  await t.close();
}

{
  const t = await boot();
  await withCards(t);
  await shot(t.deckUrl, 'board-empty', { width: 1440, then: ready });
  await t.close();
}

{
  const titles = ['Add a greeting command', 'Fix the --help output', 'Document the config file', 'Rename the data dir flag', 'Handle a missing token', 'Add retry to gh calls', 'Trim the transcript view', 'Show cache split in ledger', 'Warn on stale worktrees', 'Pin the plugin version', 'Explain the five hour gauge', 'Add keyboard shortcuts', 'Cut cold start time', 'Write the release notes'];
  const t = await boot({ initFor: { 8: { permissionMode: 'bypassPermissions' } }, steps: ['rate', 'tool', 'say:Working through the plan.', '@2:ask', '@3:perm', '@4:perm', '@5:text-question', '@1,6,7:say:Still building.'] });
  const { cards } = await withCards(t, titles);
  for (const c of cards.slice(0, 8)) {
    await t.api('POST', `/api/cards/${c.id}/shape`);
    await until(async () => (await stateOf(t)).jobs.length > 0);
    await new Promise((r) => setTimeout(r, 400));
  }
  await until(async () => { const s = await stateOf(t); return s.pending.length >= 3 && s.jobs.every((j) => j.status !== 'queued'); });
  await until(async () => (await stateOf(t)).jobs.some((j) => j.outcome === 'invariant'), 15000).catch(() => {});
  unlinkSync(join(t.dir, 'claude'));
  await shot(t.deckUrl, 'board-busy', { width: 1440, height: 1100, then: ready });
  await t.close();
}

{
  const t = await boot();
  await shot(`http://127.0.0.1:${t.port}/#token=${'x'.repeat(40)}`, 'board-error', { width: 1440 });
  await t.close();
}

await browser.close();
console.log('screenshots saved to docs/design/');
process.exit(0);
