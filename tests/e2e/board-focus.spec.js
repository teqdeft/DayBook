// CONTRACT 27 (Daybook 1.12): focus on the board and in the task window, from the keyboard. Mark
// done in the window keeps the focus in it while it works, then on Reopen (and back on Mark done);
// Escape gives it to the card's "› 6 done" fold while the card sits there, or to the card again
// once it is open. A move that fails puts the card back with the focus on its "⋯". A card's title
// shows in the window at once while the task loads. Vishal, whose report is in (the demo's evening
// state), gets no "Add to to-do" in the window. Files dropped where nothing takes them are
// swallowed on every tab of the PM's page.
//
// Everything is put back (the task is reopened, the failed move never reached the server), so
// the later specs find the demo data as it is. Every /api/ai/** request is answered in the browser.
import { closeDemoData, projectIdByName } from './support/demoData.js';
import { PEOPLE, expect, open, problemsOf, test } from './support/fixtures.js';
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
    // Asked again until the page's effects have run (the guard is added after hydration).
    const swallowed = () =>
      page.evaluate(() => {
        const files = new DataTransfer();
        files.items.add(new File(['hello'], 'brief.txt', { type: 'text/plain' }));
        const heading = document.querySelector('h1');
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
