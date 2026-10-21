import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { boot, repo, stateOf, until, withCards } from './fixture.mjs';

const LANES = ['Inbox', 'Shaped', 'Approved', 'Queued', 'Running', 'Review', 'Done'];
let t;
test.afterEach(async () => { await t?.close(); t = null; });

const board = (page) => page.getByRole('group', { name: /^Board for / });
const lane = (page, name) => page.getByRole('region', { name: new RegExp(`^${name}, \\d+ cards?$`) });

async function settledBox(locator) {
  let previous = null;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const unchanged = previous !== null && ['x', 'y', 'width', 'height'].every((key) => box[key] === previous[key]);
    previous = box;
    return unchanged;
  }).toBe(true);
  return previous;
}

async function drag(page, from, to) {
  const a = await from.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await expect(to).not.toHaveClass(/lane-collapsed/);
  const b = await settledBox(to);
  await page.mouse.move(b.x + b.width / 2, b.y + 80, { steps: 12 });
  await page.mouse.up();
}

test.describe('gauges and frame', () => {
  test('each gauge draws its used fraction; no reading draws no arc', async ({ page }) => {
    t = await boot({ steps: ['rate'] });
    const { cards } = await withCards(t, ['Gauge card']);
    await page.goto(t.deckUrl);
    await expect(page.locator('[data-gauge] .arc-fill')).toHaveCount(0);
    await t.api('POST', `/api/cards/${cards[0].id}/shape`);
    const dash = async (id) => Number((await page.locator(`[data-gauge="${id}"] .arc-fill`).getAttribute('stroke-dasharray')).split(' ')[0]);
    await expect.poll(() => dash('five_hour')).toBeCloseTo(42, 0);
    expect(await dash('seven_day')).toBeCloseTo(18, 0);
  });

  test('a loaded lane has a loaded joint and an empty lane does not', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Loaded card']);
    await page.goto(t.deckUrl);
    await expect(lane(page, 'Inbox')).toHaveAttribute('data-load', 'true');
    await expect(lane(page, 'Shaped')).toHaveAttribute('data-load', 'false');
  });

  test('without a connection Stop all is disabled and no gauge arc or crew panel is drawn', async ({ page }) => {
    t = await boot();
    await page.goto(`http://127.0.0.1:${t.port}/#token=${'x'.repeat(40)}`);
    await expect(page.getByRole('button', { name: 'Stop all' })).toBeDisabled();
    await expect(page.locator('.arc-fill')).toHaveCount(0);
    await expect(page.locator('.crew')).toHaveCount(0);
  });

  test('one failed state load recovers without a new server event', async ({ page }) => {
    t = await boot();
    const { project } = await withCards(t, ['First']);
    await page.goto(t.deckUrl);
    const linkState = page.locator('.linkstate');
    await expect(linkState).toHaveText('Connected');
    await expect(lane(page, 'Inbox')).toContainText('First');
    let loads = 0;
    await page.route('**/api/state', (route) => (loads++ === 0 ? route.abort() : route.continue()));
    await t.api('POST', '/api/cards', { projectKey: project.key, title: 'Second' });
    await expect.poll(() => loads).toBeGreaterThan(0);
    expect((await stateOf(t)).cards).toHaveLength(2);
    await expect(linkState).toHaveText('Connected');
    await expect(lane(page, 'Inbox')).toContainText('Second');
  });
});

test.describe('lanes and cards', () => {
  test('shows the lanes from Inbox to Done in order', async ({ page }) => {
    t = await boot();
    await withCards(t, ['First card']);
    await page.goto(t.deckUrl);
    await expect(board(page)).toBeVisible();
    await expect(board(page).getByRole('heading', { level: 2 })).toHaveText(LANES);
    await expect(lane(page, 'Inbox')).toContainText('First card');
  });

  test('adds a manual card to Inbox', async ({ page }) => {
    t = await boot();
    await withCards(t);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'New card' }).click();
    const dialog = page.getByRole('dialog', { name: 'New card' });
    await dialog.getByLabel('Title').fill('Write the greeting');
    await dialog.getByRole('button', { name: 'Add card' }).click();
    await expect(lane(page, 'Inbox').getByRole('heading', { name: 'Write the greeting' })).toBeVisible();
    const cards = (await stateOf(t)).cards;
    expect(cards.map((c) => [c.title, c.lane])).toEqual([['Write the greeting', 'Inbox']]);
  });

  test('the Shape button runs Shape and the card ends in Shaped', async ({ page }) => {
    t = await boot({ steps: ['brief'] });
    const { cards } = await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await lane(page, 'Inbox').getByRole('button', { name: 'Shape', exact: true }).click();
    await expect(lane(page, 'Shaped').getByRole('heading', { name: 'Greet' })).toBeVisible();
    const s = await stateOf(t);
    expect(s.cards.find((c) => c.id === cards[0].id).lane).toBe('Shaped');
    expect(s.jobs).toHaveLength(1);
  });

  test('dragging Inbox to Shaped runs Shape', async ({ page }) => {
    t = await boot({ steps: ['brief'] });
    const { cards } = await withCards(t, ['Dragged']);
    await page.goto(t.deckUrl);
    await drag(page, page.locator(`[data-card="${cards[0].id}"]`), lane(page, 'Shaped'));
    await expect(lane(page, 'Shaped').getByRole('heading', { name: 'Dragged' })).toBeVisible();
    expect((await stateOf(t)).jobs).toHaveLength(1);
  });

  test('any other drop snaps back and says why', async ({ page }) => {
    t = await boot({ steps: ['brief'] });
    const { cards } = await withCards(t, ['Stays put']);
    await page.goto(t.deckUrl);
    await drag(page, page.locator(`[data-card="${cards[0].id}"]`), lane(page, 'Approved'));
    await expect(page.getByRole('status').filter({ hasText: /stays in Inbox/ })).toContainText('Inbox to Approved');
    await expect(lane(page, 'Inbox').getByRole('heading', { name: 'Stays put' })).toBeVisible();
    const s = await stateOf(t);
    expect(s.jobs).toHaveLength(0);
    expect(s.cards[0].lane).toBe('Inbox');
  });
});

test.describe('Needs you', () => {
  const needs = (page) => page.getByRole('region', { name: 'Needs you' });

  test('is calm when nothing waits', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Idle']);
    await page.goto(t.deckUrl);
    await expect(needs(page)).toContainText('Nothing is waiting on you.');
  });

  test('a question card takes a choice and answers the agent', async ({ page }) => {
    t = await boot({ steps: ['ask', 'brief'] });
    await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const card = needs(page).getByRole('listitem').filter({ hasText: 'Which greeting style?' });
    await expect(card).toContainText('Question');
    await expect(card.getByRole('button', { name: 'Answer' })).toBeDisabled();
    await card.getByRole('radio', { name: /Casual/ }).click();
    await card.getByRole('button', { name: 'Answer' }).click();
    await expect(lane(page, 'Shaped')).toContainText('Greet');
    await expect(card).toHaveCount(0);
    await expect(needs(page).locator('li[data-kind="brief"]')).toContainText('Greet');
  });

  test('a lettered text question sends the chosen letters as the reply', async ({ page }) => {
    t = await boot({ steps: ['text-question', 'brief'] });
    await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const card = needs(page).getByRole('listitem').filter({ hasText: 'Greeting style' });
    await card.getByRole('radio', { name: /Formal/ }).click();
    await card.getByRole('button', { name: 'Send answers' }).click();
    await expect(lane(page, 'Shaped')).toContainText('Greet');
  });

  test('a permission card allows once', async ({ page }) => {
    t = await boot({ steps: ['perm', 'brief'] });
    await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const card = needs(page).getByRole('listitem').filter({ hasText: 'Permission' });
    await expect(card).toContainText('ls docs');
    await card.getByRole('button', { name: 'Allow once' }).click();
    await expect(lane(page, 'Shaped')).toContainText('Greet');
  });

  test('a permission card can be denied and the agent carries on', async ({ page }) => {
    t = await boot({ steps: ['perm', 'brief'] });
    await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const card = needs(page).getByRole('listitem').filter({ hasText: 'Permission' });
    await card.getByRole('button', { name: 'Deny' }).click();
    await expect(card).toBeHidden();
    const job = (await stateOf(t)).jobs[0];
    await until(async () => (await stateOf(t)).jobs[0].status === 'done');
    expect(job.id).toBeTruthy();
  });

  test('an invariant card names the mismatch and opens the job', async ({ page }) => {
    t = await boot({ steps: ['brief'], init: { permissionMode: 'bypassPermissions' } });
    await withCards(t, ['Greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const card = needs(page).getByRole('listitem').filter({ hasText: 'Invariant' });
    await expect(card).toContainText('permissionMode');
    await card.getByRole('button', { name: 'Open job' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Greet' })).toBeVisible();
    await expect(page).toHaveURL(/#\/jobs\/.+/);
  });

  test('a health card shows the failing check with its fix and can be rechecked', async ({ page }) => {
    t = await boot({ claudeMissing: true });
    await withCards(t);
    await page.goto(t.deckUrl);
    const card = needs(page).getByRole('listitem').filter({ hasText: 'claude check failed' });
    await expect(card).toContainText('claude binary not found');
    await expect(card).toContainText('npm install -g @anthropic-ai/claude-code');
    await card.getByRole('button', { name: 'Check again' }).click();
    await expect(card).toBeVisible();
  });
});

test.describe('runs', () => {
  const needs = (page) => page.getByRole('region', { name: 'Needs you' });

  test('a brief whose branch already exists cannot be approved and its card says why', async ({ page }) => {
    t = await boot({ steps: ['brief'] });
    const { project, cards } = await withCards(t, ['Greet']);
    execFileSync('git', ['-C', project.path, 'branch', 'greet']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const brief = needs(page).locator('li[data-kind="brief"]');
    await brief.getByRole('button', { name: 'Approve' }).click();
    const card = page.locator(`[data-card="${cards[0].id}"]`);
    await expect(card.getByRole('note')).toHaveText('Cannot approve: branch greet already exists as a local branch');
    const s = await stateOf(t);
    expect(s.jobs.filter((j) => j.stage === 'run')).toHaveLength(0);
    await expect(brief).toBeVisible();
  });

  test('Find cause on an Inbox card with a worktree starts a find-cause job there', async ({ page }) => {
    const worktree = repo('deck-wt-');
    const seed = {
      projects: [{ key: 'local/p', path: repo(), origin: null }],
      cards: [{ id: 'c1', projectKey: 'local/p', title: 'Crashed card', lane: 'Inbox' }],
      jobs: [{ id: 'spec1', cardId: 'c1', stage: 'spec', status: 'crashed', worktree }],
    };
    t = await boot({ steps: ['say:Looking at the crash'], seed });
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Actions for Crashed card' }).click();
    await page.getByRole('menuitem', { name: 'Find cause' }).click();
    const job = await until(async () => (await stateOf(t)).jobs.find((j) => j.stage === 'find-cause'));
    expect(job.worktree).toBe(worktree);
    expect(job.cardId).toBe('c1');
  });

  test('Find cause is disabled on an Inbox card without a worktree', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Fresh card']);
    await page.goto(t.deckUrl);
    await page.getByRole('button', { name: 'Actions for Fresh card' }).click();
    await expect(page.getByRole('menuitem', { name: 'Find cause' })).toHaveAttribute('data-disabled', '');
  });
});

test.describe('token', () => {
  test('is read from the URL fragment and removed from the address', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Visible']);
    await page.goto(t.deckUrl);
    await expect(board(page)).toBeVisible();
    expect(page.url()).not.toContain(t.token);
    await page.reload();
    await expect(board(page)).toBeVisible();
  });

  test('is also read from the ?token= form the daemon prints', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Visible']);
    await page.goto(t.queryUrl);
    await expect(lane(page, 'Inbox')).toContainText('Visible');
    expect(page.url()).not.toContain(t.token);
  });

  test('F-2-01 is read from the ?token= URL form', async ({ page }) => {
    t = await boot();
    await withCards(t, ['Visible']);
    const res = await page.goto(t.queryUrl);
    expect(res.url()).toContain('?token=');
    expect(res.url()).not.toContain('#token=');
    await expect(lane(page, 'Inbox')).toContainText('Visible');
  });

  test('a wrong token shows an error state', async ({ page }) => {
    t = await boot();
    await page.goto(`http://127.0.0.1:${t.port}/#token=${'x'.repeat(40)}`);
    await expect(page.getByRole('heading', { name: 'Token not accepted' })).toBeVisible();
    await expect(board(page)).toHaveCount(0);
  });

  test('a missing token shows an error state', async ({ page }) => {
    t = await boot();
    await page.goto(`http://127.0.0.1:${t.port}/`);
    await expect(page.getByRole('heading', { name: 'No access token' })).toBeVisible();
  });
});
