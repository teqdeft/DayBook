// CONTRACT 28 (Daybook 1.13), The sideways scroll: the page itself never scrolls sideways, from
// 390 to 2560 px, light and dark, in Chrome with real scrollbars (the `scrollbars` project in
// playwright.config.js). Checked on the board (the PM, an Admin, a member and another PM; a
// Completed project; a long title), the Table, the task window, the Files tab, /my-tasks, /team,
// /overview, /today and /projects. On the board every column header is inside the board's box or
// reachable by the board's own scroll, and with `data-fill` the board's bottom is inside the window
// once the board is scrolled to; during and after a drag at 1280 and 1440 px too.
//
// The long title is a task added here through the API and deleted at the end; the drag is taken
// back with Undo. Every /api/ai/** request is answered in the browser (support/projectPlan.js).
import { expectNoSidewaysScroll, pointerDrag } from './support/board.js';
import { closeDemoData, currentPhaseOf, projectIdByName, taskByTitle } from './support/demoData.js';
import { PEOPLE, expect, open, problemsOf, signIn, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const WIDTHS = [390, 1024, 1280, 1366, 1440, 1536, 1920, 2560];
const LONG_TITLE =
  'Check that a long title like https://acme-retail.example/checkout/payment-gateway/configuration?step=final wraps on its card';
const DRAGGED = 'Stock sync with the warehouse'; // Simran's, open, in Development

const ids = { store: null, landing: null, task: null, long: null };

/** A browser context signed in as a person, with every AI request stubbed. */
async function pageAs(browser, baseURL, person) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  await signIn(context, person.email, baseURL);
  const page = await context.newPage();
  await stubAi(page);
  return page;
}

test.beforeAll(async ({ browser, baseURL }) => {
  ids.store = await projectIdByName('acme-store');
  ids.landing = await projectIdByName('acme-landing');
  ids.task = (await taskByTitle(ids.store, 'Checkout fix before client demo')).id;
  const pm = await pageAs(browser, baseURL, PEOPLE.pm);
  const added = await write(pm, baseURL, 'post', `/api/projects/${ids.store}/tasks`, {
    title: LONG_TITLE,
    // The current phase: the phone's board shows that column first.
    phase: (await currentPhaseOf(ids.store)) ?? 'development',
    priority: 'p2',
    assigneeId: null,
  });
  expect(added.status()).toBe(201);
  ids.long = (await added.json()).data.id;
  await pm.context().close();
});

test.afterAll(async ({ browser, baseURL }) => {
  if (ids.long) {
    const pm = await pageAs(browser, baseURL, PEOPLE.pm);
    await write(pm, baseURL, 'delete', `/api/project-tasks/${ids.long}`);
    await pm.context().close();
  }
  await closeDemoData();
});

/** The pages each person opens, by name. */
const PAGES = {
  pm: () => [
    ['the board', `/projects/${ids.store}?view=board`],
    ['the Table', `/projects/${ids.store}?view=table`],
    ['the task window', `/projects/${ids.store}?view=board&task=${ids.task}`],
    ['the Files tab', `/projects/${ids.store}?tab=files`],
    ['a Completed project', `/projects/${ids.landing}?view=board`],
    ['/my-tasks', '/my-tasks'],
    ['/team', '/team'],
    ['/projects', '/projects'],
  ],
  ceo: () => [
    ['the board (Admin)', `/projects/${ids.store}?view=board`],
    ['/overview', '/overview'],
  ],
  vishal: () => [
    ['the board (member)', `/projects/${ids.store}?view=board`],
    ['/today', '/today'],
  ],
  pm2: () => [['the board (another PM)', `/projects/${ids.store}?view=board`]],
};

/**
 * On a computer's board: each column header is inside the board's box or the board scrolls
 * sideways to it, and with `data-fill` the board ends inside the window once scrolled to.
 * @param {import('@playwright/test').Page} page
 * @param {string} where
 */
async function expectBoardFits(page, where) {
  const sizes = await page.evaluate(() => {
    const board = document.getElementById('project-board');
    const view = board.closest('[aria-label="Tasks"]');
    view.scrollIntoView({ block: 'start' });
    const box = board.getBoundingClientRect();
    const heads = [...board.querySelectorAll('section[data-column]:not([hidden]) h3')].map(
      (head) => {
        const rect = head.getBoundingClientRect();
        return {
          name: head.textContent,
          inside: rect.left >= box.left - 1 && rect.right <= box.right + 1,
        };
      },
    );
    return {
      heads,
      scrolls: board.scrollWidth > board.clientWidth,
      fill: view.hasAttribute('data-fill'),
      bottom: box.bottom,
      height: window.innerHeight,
    };
  });
  for (const head of sizes.heads) {
    expect(head.inside || sizes.scrolls, `${where}: ${head.name} can be reached`).toBe(true);
  }
  if (sizes.fill) {
    expect(sizes.bottom, `${where}: the board ends inside the window`).toBeLessThanOrEqual(
      sizes.height + 1,
    );
  }
}

/** Checks a page in light and in dark. */
async function checkBoth(page, where, { board = false } = {}) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoSidewaysScroll(page, `${where}, ${colorScheme}`);
    if (board) await expectBoardFits(page, `${where}, ${colorScheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('the scrollbars are real (they take room, as on Windows)', async ({ signInAs }) => {
  const page = await signInAs(PEOPLE.pm);
  // A short window: the demo's 12 projects fit 1000 px, and a page that fits has no scrollbar.
  await page.setViewportSize({ width: 1440, height: 600 });
  await open(page, '/projects');
  const bar = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
  expect(bar, 'the page’s vertical scrollbar has a width').toBeGreaterThan(0);
});

for (const width of WIDTHS) {
  test(`no page scrolls sideways at ${width} px`, async ({ signInAs }) => {
    test.setTimeout(300_000);
    const height = width <= 640 ? 844 : 1000;
    for (const [key, list] of Object.entries(PAGES)) {
      const page = await signInAs(PEOPLE[key]);
      await stubAi(page);
      await page.setViewportSize({ width, height });
      for (const [where, path] of list()) {
        await test.step(`${key}: ${where}`, async () => {
          await open(page, path);
          if (path.includes('task=')) {
            await expect(
              page.getByRole('dialog', { name: 'Checkout fix before client demo' }),
            ).toBeVisible();
          }
          if (where === 'the board') {
            await expect(
              page.getByRole('button', { name: LONG_TITLE, exact: true }),
            ).toBeAttached();
          }
          const board = width > 640 && where.startsWith('the board');
          await checkBoth(page, `${where} at ${width} px`, { board });
        });
      }
      expect(problemsOf(page), 'console and page errors').toEqual([]);
    }
  });
}

for (const width of [1280, 1440]) {
  test(`a drag at ${width} px never widens the page`, async ({ signInAs }) => {
    const page = await signInAs(PEOPLE.pm);
    await stubAi(page);
    await page.setViewportSize({ width, height: 1000 });
    await open(page, `/projects/${ids.store}?view=board`);
    const title = page
      .locator('li[id^="board-card-"]')
      .getByRole('button', { name: DRAGGED, exact: true });
    const testing = page.getByRole('region', { name: 'Testing', exact: true });
    await pointerDrag(page, title, testing, { release: false });
    await expect(page.locator('[data-drag-preview]')).toHaveCount(1);
    await expectNoSidewaysScroll(page, `during a drag at ${width} px`);
    const moved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.request().postDataJSON()?.phase === 'testing',
    );
    await page.mouse.up();
    expect((await moved).status()).toBe(200);
    await expectNoSidewaysScroll(page, `after a drag at ${width} px`);
    await expectBoardFits(page, `after a drag at ${width} px`);

    const back = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.request().postDataJSON()?.phase === 'development',
    );
    await toasts(page)
      .getByRole('status')
      .filter({ hasText: 'Moved to Testing.' })
      .getByRole('button', { name: 'Undo' })
      .click();
    expect((await back).status()).toBe(200);
    expect(problemsOf(page), 'console and page errors').toEqual([]);
  });
}
