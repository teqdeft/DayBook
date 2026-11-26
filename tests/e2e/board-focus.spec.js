// CONTRACT 27 (Daybook 1.12): focus on the board and in the task window, from the keyboard. Mark
// done in the window keeps the focus in it while it works, then on Reopen (and back on Mark done);
// Escape gives it to the card's "› 6 done" fold while the card sits there, or to the card again
// once it is open. A move that fails puts the card back with the focus on its "⋯". A card's title
// shows in the window at once while the task loads. Vishal, whose report is in (the demo's evening
// state), gets no "Add to to-do" in the window. Files dropped where nothing takes them are
// swallowed on every tab of the PM's page. A card's controls take Tab in their order (CONTRACT
// 28): the tick, the title, Assign to me, the grip, then "⋯"; the grip's click opens Move to
// phase… for its card. An open card menu is over the next card's own actions, on a computer and on
// a phone. After a tick from the keyboard whose answer comes late (the card has left), Tab and
// Escape leave the "Marked done." toast for the next card's title, or the next row's in the Table,
// never the page. A task reopened in its window is open on the board at once.
//
// Everything is put back (the task is reopened, the failed move never reached the server), so
// the later specs find the demo data as it is. Every /api/ai/** request is answered in the browser.
import { closeDemoData, projectIdByName, taskByTitle } from './support/demoData.js';
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const TASK = 'Shipping options at checkout'; // Simran's, open, in Development
const ANYONE = 'Product image zoom'; // for anyone on the project, open

let projectId;
test.beforeAll(async () => {
  projectId = await projectIdByName(PROJECT);
});
test.afterAll(closeDemoData);

async function openAs(signInAs, person, path) {
  const page = await signInAs(person);
  await stubAi(page);
  await open(page, path);
  return page;
}

const column = (page, name) => page.getByRole('region', { name, exact: true });
const card = (page, title) =>
  page.locator('li[id^="board-card-"]').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  });
/** What has the focus: its id, its name and whether it is inside a window. */
const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return {
      id: element?.id || null,
      name: (element?.getAttribute('aria-label') || element?.textContent || '').trim(),
      inDialog: Boolean(element?.closest('[role="dialog"]')),
    };
  });
const statusSent = (page) =>
  page.waitForResponse(
    (response) => /\/api\/project-tasks\/\d+\/status$/.test(response.url()) && response.ok(),
  );
/** The task is open again, whatever happened above. */
async function reopen(page, baseURL) {
  const { id } = await taskByTitle(projectId, TASK);
  const path = `/api/project-tasks/${id}/status`;
  expect((await write(page, baseURL, 'post', path, { status: 'open' })).status()).toBe(200);
}

test('Mark done and Reopen keep the focus in the task window, and Escape finds the card', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const development = column(page, 'Development');
  await development.getByRole('button', { name: TASK, exact: true }).focus();
  await page.keyboard.press('Enter');
  const window = page.getByRole('dialog', { name: TASK });
  await window.getByRole('button', { name: 'Mark done' }).focus();

  const done = statusSent(page);
  await page.keyboard.press('Enter');
  // While it works the button keeps the focus (aria-disabled, not disabled).
  for (let sample = 0; sample < 4; sample += 1) {
    expect((await focused(page)).inDialog).toBe(true);
    await page.waitForTimeout(60);
  }
  const taskId = (await done).url().match(/project-tasks\/(\d+)/)[1];
  await expect(window.getByRole('button', { name: 'Reopen' })).toBeFocused();

  // The card went under "› n done", which is closed: its button takes the focus, and keeps it
  // when the page's refresh lands.
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
  await expect.poll(async () => (await focused(page)).id).toBe('board-development-done');
  await page.waitForTimeout(1000);
  expect((await focused(page)).id).toBe('board-development-done');

  // Open the fold and the done card; Reopen gives the focus to Mark done; Escape to the card.
  await page.keyboard.press('Enter');
  await development.getByRole('button', { name: TASK, exact: true }).focus();
  await page.keyboard.press('Enter');
  await window.getByRole('button', { name: 'Reopen' }).focus();
  const reopened = statusSent(page);
  await page.keyboard.press('Enter');
  await reopened;
  await expect(window.getByRole('button', { name: 'Mark done' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
  await expect.poll(async () => (await focused(page)).id).toBe(`board-card-${taskId}-title`);

  // Open, as the demo has it, whatever happened above.
  const back = await write(page, baseURL, 'post', `/api/project-tasks/${taskId}/status`, {
    status: 'open',
  });
  expect(back.status()).toBe(200);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a move that fails puts the card back with the focus on its "⋯"', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  await page.route(/\/api\/project-tasks\/\d+$/, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Not now.' } }),
        })
      : route.continue(),
  );
  await card(page, TASK)
    .getByRole('button', { name: `More for ${TASK}` })
    .focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Move to phase…' }).click();
  await page
    .getByRole('dialog', { name: `Move ${TASK}` })
    .getByRole('button', { name: /^Testing/ })
    .click();
  await expect(page.getByText("Couldn't move the task")).toBeVisible();
  await expect(
    column(page, 'Development').getByRole('button', { name: TASK, exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await focused(page)).name).toBe(`More for ${TASK}`);
});

test('a card shows its title in the task window at once, while the task loads', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  await page.route(/\/api\/project-tasks\/\d+$/, async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 2000));
    await route.continue();
  });
  await card(page, TASK).getByRole('button', { name: TASK, exact: true }).click();
  const window = page.getByRole('dialog', { name: TASK });
  await expect(window.getByRole('heading', { level: 2 })).toHaveText(TASK, { timeout: 1000 });
});

test('a member whose report is in gets no "Add to to-do" in the task window', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.vishal, `/projects/${projectId}`);
  const { data: todo } = await (await page.request.get('/api/me/todo')).json();
  await card(page, ANYONE).getByRole('button', { name: ANYONE, exact: true }).click();
  const window = page.getByRole('dialog', { name: ANYONE });
  await expect(window.getByRole('heading', { level: 2 })).toHaveText(ANYONE);
  const takesLines = todo.editable && !todo.submitted;
  await expect(window.getByRole('button', { name: 'Add to to-do' })).toHaveCount(
    takesLines ? 1 : 0,
  );
});

test('files dropped off a card are swallowed on every tab of the PM’s page', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  for (const tab of ['board', 'summary', 'files', 'timeline', 'hours']) {
    await open(page, `/projects/${projectId}?tab=${tab}`);
    // Asked again until the page's effects have run (the guard is added after hydration) and its
    // header has streamed in.
    const swallowed = () =>
      page.evaluate(() => {
        const files = new DataTransfer();
        files.items.add(new File(['hello'], 'brief.txt', { type: 'text/plain' }));
        const heading = document.querySelector('h1');
        if (!heading) return [false, false];
        return ['dragover', 'drop'].map((type) => {
          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: files,
          });
          heading.dispatchEvent(event);
          return event.defaultPrevented;
        });
      });
    await expect.poll(swallowed, { message: tab }).toEqual([true, true]);
  }
});

test('a card’s controls take Tab in order, and the grip’s click opens Move to phase…', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const shipping = card(page, TASK);
  await shipping.getByRole('checkbox', { name: `Done: ${TASK}` }).focus();
  for (const name of [TASK, `Assign ${TASK} to me`, `Move ${TASK}`, `More for ${TASK}`]) {
    await page.keyboard.press('Tab');
    await expect(shipping.getByRole('button', { name, exact: true })).toBeFocused();
  }

  const grip = shipping.getByRole('button', { name: `Move ${TASK}`, exact: true });
  await expect(grip).toHaveAttribute('aria-describedby', 'move-help');
  await expect(page.locator('#move-help')).toHaveText(
    'Press Space to pick up. Use the Left and Right arrow keys to choose a phase. Press Space to drop or Escape to cancel.',
  );
  await grip.click();
  const dialog = page.getByRole('dialog', { name: `Move ${TASK}` });
  await expect(dialog.getByRole('button', { name: /^Development \(here now\)/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

for (const [where, viewport] of [
  ['a computer', { width: 1440, height: 900 }],
  ['a phone', { width: 390, height: 844 }],
]) {
  test(`an open card menu is over the next card’s actions on ${where}`, async ({ signInAs }) => {
    const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
    await page.setViewportSize(viewport);
    const shown = page.locator('ul[data-cards="development"] > li');
    const first = shown.first();
    await first.scrollIntoViewIfNeeded();
    await first.hover();
    await first.getByRole('button', { name: /^More for / }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // Every 5 px along each item, what a click would reach.
    const covered = await menu.evaluate((list) =>
      [...list.querySelectorAll('[role="menuitem"]')].flatMap((item) => {
        const box = item.getBoundingClientRect();
        const found = [];
        for (let x = box.left + 2; x < box.right - 2; x += 5) {
          const hit = document.elementFromPoint(x, box.top + box.height / 2);
          if (!list.contains(hit)) found.push(`${item.textContent} at ${Math.round(x)}`);
        }
        return found;
      }),
    );
    expect(covered).toEqual([]);
    // The line above Delete, as the prototype draws it.
    const roles = await menu.evaluate((list) =>
      [...list.children].map((one) => `${one.getAttribute('role')} ${one.textContent}`.trim()),
    );
    expect(roles.slice(-2)).toEqual(['separator', 'menuitem Delete']);
    await page.keyboard.press('Escape');
  });
}

for (const [name, query, rows, titles] of [
  ['card', '', 'ul[data-cards="development"] > li', '[data-card-title]'],
  ['row', '?view=table', 'tbody[data-table-body] > tr[data-flip^="row:"]', '[data-row-title]'],
]) {
  test(`after a tick from the keyboard, the toast gives the focus to the next ${name}`, async ({
    signInAs,
    baseURL,
  }) => {
    const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}${query}`);
    // The answer comes after the card has left (its leave plays 600 ms after the tick).
    await page.route(/\/api\/project-tasks\/\d+\/status$/, async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    const shown = () => page.locator(`${rows} ${titles}`).allInnerTexts();
    const before = await shown();
    const at = before.indexOf(TASK);
    const next = before[at + 1] ?? before[at - 1];
    try {
      await page.getByRole('checkbox', { name: `Done: ${TASK}` }).focus();
      const done = statusSent(page);
      await page.keyboard.press('Space');
      await done;
      const undo = toasts(page)
        .getByRole('status')
        .filter({ hasText: 'Marked done.' })
        .getByRole('button', { name: 'Undo' });
      await expect(undo).toBeFocused();
      expect(await shown(), 'the task has left by now').not.toContain(TASK);

      await page.keyboard.press('Tab');
      await expect.poll(async () => (await focused(page)).name).toBe(next);
      await undo.focus();
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await focused(page)).name).toBe(next);
      await expect(undo).toHaveCount(0);
      expect((await focused(page)).name, 'and it stays there').toBe(next);
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
      await reopen(page, baseURL);
    }
    expect(problemsOf(page), 'console and page errors').toEqual([]);
  });
}

test('a task reopened in its window is open on the board at once', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const development = column(page, 'Development');
  const openList = development.locator('ul[data-cards]');
  const title = { name: TASK, exact: true };
  try {
    const done = statusSent(page);
    await development.getByRole('checkbox', { name: `Done: ${TASK}` }).click();
    await done;
    await expect(openList.getByRole('button', title)).toHaveCount(0);
    await development.getByRole('button', { name: /^\d+ done$/ }).click();
    await development.getByRole('button', title).click();
    const window = page.getByRole('dialog', { name: TASK });
    const reopened = statusSent(page);
    await window.getByRole('button', { name: 'Reopen' }).click();
    await reopened;
    // Once the refresh draws it: the board no longer holds it as done (for up to 15 s).
    await expect(openList.getByRole('button', title)).toHaveCount(1, { timeout: 8000 });
  } finally {
    await reopen(page, baseURL);
  }
});
