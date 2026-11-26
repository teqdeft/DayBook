// CONTRACT 27 (Daybook 1.12) and 28 (1.13): the phase board. The PM drags a card from Development
// to Testing with the mouse (a pointer drag) and takes it back with Undo, moves one from its menu
// with the keyboard (Move to phase… → Launch) and adds a task with quick add ("Add task to
// Testing"). Vishal Saini, an employee on the project, gets the read-only page: no health tag, no
// forecast, no Hours tab and no Add task. Another PM who isn't on the project sees no file chips,
// no "With files" filter and the Files tab's lock line, and a file's link answers 404.
//
// Everything this spec changes on acme-store is put back (Undo, and the added task and the file
// are deleted), so project-plan.spec.js, which runs later, finds the demo plan as it is. Every
// /api/ai/** request is answered in the browser (support/projectPlan.js).
import { pointerDrag } from './support/board.js';
import { closeDemoData, projectIdByName } from './support/demoData.js';
import { fileFixture, uploadByApi } from './support/files.js';
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const DRAGGED = 'Stock sync with the warehouse'; // Simran's, open, in Development
const MOVED = 'Shipping options at checkout'; // Simran's, open, in Development
const PM_TASK = 'Get the payment gateway keys from Acme'; // the PM's own: no one is told

let projectId;
test.beforeAll(async () => {
  projectId = await projectIdByName(PROJECT);
});
test.afterAll(closeDemoData);

/** Signs in with every AI request stubbed, and opens a path. */
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
/** The file chip of logo.png on a card: the picture's thumbnail button, or a chip with its name. */
const fileChip = (page, title) =>
  card(page, title)
    .getByRole('button', { name: 'Open picture logo.png' })
    .or(card(page, title).getByText('logo.png', { exact: true }));
/** The undo toast of a move or a delete. */
const undoToast = (page, text) => toasts(page).getByRole('status').filter({ hasText: text });
/** Waits for the PATCH of a move and checks the phase it sent. */
const movePatched = (page, phase) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/project-tasks\/\d+$/.test(response.url()) &&
      response.request().postDataJSON()?.phase === phase,
  );

test('the PM drags a card to Testing and Undo puts it back', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const development = column(page, 'Development');
  const testing = column(page, 'Testing');
  await expect(development.getByRole('button', { name: DRAGGED, exact: true })).toBeVisible();

  const moved = movePatched(page, 'testing');
  await pointerDrag(
    page,
    card(page, DRAGGED).getByRole('button', { name: DRAGGED, exact: true }),
    testing,
  );
  expect((await moved).status()).toBe(200);
  await expect(testing.getByRole('button', { name: DRAGGED, exact: true })).toBeVisible();
  await expect(development.getByRole('button', { name: DRAGGED, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: DRAGGED, exact: true })).toBeFocused();

  const back = movePatched(page, 'development');
  await undoToast(page, 'Moved to Testing.').getByRole('button', { name: 'Undo' }).click();
  expect((await back).status()).toBe(200);
  await expect(development.getByRole('button', { name: DRAGGED, exact: true })).toBeVisible();

  await test.step('the server kept it in Development', async () => {
    await open(page, `/projects/${projectId}`);
    await expect(development.getByRole('button', { name: DRAGGED, exact: true })).toBeVisible();
    await expect(testing.getByRole('button', { name: DRAGGED, exact: true })).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the keyboard way: the card menu, Move to phase…, then Launch', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const menu = page.getByRole('button', { name: `More for ${MOVED}`, exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Move to phase…' }).press('Enter');

  const dialog = page.getByRole('dialog', { name: `Move ${MOVED}` });
  await expect(dialog.getByRole('button')).toContainText([
    'Requirement gathering',
    'Design',
    'Development (here now)',
    'Testing',
    'Launch',
    'Support',
    'Cancel',
  ]);
  await expect(dialog.getByRole('button', { name: /^Development \(here now\)/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  const moved = movePatched(page, 'launch');
  await dialog.getByRole('button', { name: /^Launch/ }).press('Enter');
  expect((await moved).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(
    column(page, 'Launch').getByRole('button', { name: MOVED, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `More for ${MOVED}`, exact: true })).toBeFocused();

  const back = movePatched(page, 'development');
  await undoToast(page, 'Moved to Launch.').getByRole('button', { name: 'Undo' }).click();
  expect((await back).status()).toBe(200);
  await expect(
    column(page, 'Development').getByRole('button', { name: MOVED, exact: true }),
  ).toBeVisible();
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('quick add: a short title is refused, then the task is added and deleted', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const testing = column(page, 'Testing');
  const title = 'Book the test phones';
  const add = testing.getByRole('button', { name: 'Add task to Testing', exact: true });
  await add.click();
  const input = testing.getByRole('textbox', { name: 'Task title for Testing' });
  await expect(input).toBeFocused();
  await expect(testing).toContainText(
    'Anyone, P2, no date. More options for a person, a date or files.',
  );

  await input.fill('Q');
  await input.press('Enter');
  await expect(testing.getByRole('alert')).toHaveText('Write a title of at least 2 characters.');

  const posted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/${projectId}/tasks`),
  );
  await input.fill(title);
  await input.press('Enter');
  expect((await posted).postDataJSON()).toEqual({
    title,
    phase: 'testing',
    priority: 'p2',
    assigneeId: null,
  });
  await expect(toasts(page).getByText('Task added to Testing.')).toBeVisible();
  await expect(
    toasts(page).getByText('Everyone on the project gets a notification.'),
  ).toBeVisible();
  await expect(testing.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(add).toBeFocused();

  await test.step('delete it again: Undo first, then let the toast end', async () => {
    await page.getByRole('button', { name: `More for ${title}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(testing.getByRole('button', { name: title, exact: true })).toHaveCount(0);
    await undoToast(page, 'Task deleted.').getByRole('button', { name: 'Undo' }).click();
    await expect(testing.getByRole('button', { name: title, exact: true })).toBeVisible();

    // From the keyboard the toast's Undo keeps the focus (the next card mustn't take it), so
    // Enter takes the delete back and focus returns to the card.
    await page.getByRole('button', { name: `More for ${title}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    const undo = undoToast(page, 'Task deleted.').getByRole('button', { name: 'Undo' });
    await page.waitForTimeout(400); // past the frame in which the board used to move focus on
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(testing.getByRole('button', { name: title, exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE', {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: `More for ${title}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect((await deleted).status()).toBe(200);
    await open(page, `/projects/${projectId}`);
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('an employee on the project gets the read-only page', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.vishal, `/projects/${projectId}`);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText(PROJECT);
  await expect(heading).not.toContainText(/Off track|At risk|On track/);
  const tabs = page.getByRole('navigation', { name: 'Project sections' });
  await expect(tabs.getByRole('link')).toHaveText(['Board', 'Files']);

  const band = page.getByRole('region', { name: 'Progress and phases' });
  await expect(band).toContainText(/19 of 29 tasks done/);
  await expect(band).toContainText('Your hours this month');
  await expect(page.getByText(/^Off track:|^At risk:|^On track:/)).toHaveCount(0);
  for (const name of ['Change deadline', /^Move to /, 'More phase actions', 'New task']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  const tools = page.getByRole('group', { name: 'Task tools' });
  await expect(tools.getByRole('group', { name: 'View' })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Filter' })).toBeVisible();
  await expect(tools.getByRole('button', { name: /^Add task|^Mine/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: "Show one person's tasks" })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add task/ })).toHaveCount(0);

  const development = column(page, 'Development');
  await expect(development.getByRole('button', { name: 'Payment settings page' })).toBeVisible();
  await expect(development.getByText('For you', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: DRAGGED, exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      'Only your tasks and tasks for anyone on the project are shown. Progress counts all 29 tasks.',
    ),
  ).toBeVisible();

  await test.step('Summary, Timeline and Hours open the Board', async () => {
    for (const tab of ['hours', 'summary', 'timeline']) {
      await open(page, `/projects/${projectId}?tab=${tab}`);
      await expect(tabs.getByRole('link', { name: 'Board' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('region', { name: 'AI summary' })).toHaveCount(0);
    }
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('another PM not on the project: no file chips, the lock line, and 404 for a file', async ({
  signInAs,
  baseURL,
}) => {
  const pm = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const taskId = Number(
    (await card(pm, PM_TASK).getAttribute('id')).replace(/^board-card-(\d+)$/, '$1'),
  );
  const held = await uploadByApi(
    pm,
    baseURL,
    { projectId, target: 'task', taskId },
    fileFixture('logo.png'),
  );
  const attached = await write(pm, baseURL, 'post', `/api/project-tasks/${taskId}/files`, {
    uploadKeys: [held.key],
  });
  expect(attached.status()).toBe(201);
  const [file] = (await attached.json()).data.files;
  const shared = await uploadByApi(
    pm,
    baseURL,
    { projectId, target: 'project', phase: 'design', visibility: 'everyone' },
    fileFixture('notes.txt'),
  );

  try {
    await test.step('the PM sees the file on the card and "With files" in Filter', async () => {
      await open(pm, `/projects/${projectId}`);
      await expect(fileChip(pm, PM_TASK)).toBeVisible();
      await pm.getByRole('button', { name: 'Filter' }).click();
      await expect(
        pm.getByRole('menuitemcheckbox', { name: /^With files \(\d+\)$/ }),
      ).toBeVisible();
      await pm.keyboard.press('Escape');
    });

    const page = await openAs(signInAs, PEOPLE.pm2, `/projects/${projectId}`);
    await expect(
      page.getByText(`Only ${PEOPLE.pm.name} and Admins can change tasks and phases.`),
    ).toBeVisible();
    await expect(card(page, PM_TASK)).toBeVisible();
    await expect(fileChip(page, PM_TASK)).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: /^Critical \(\d+\)$/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /^With files/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^More for / })).toHaveCount(0);

    await open(page, `/projects/${projectId}?tab=files`);
    await expect(
      page.getByText(`Files are only for ${PEOPLE.pm.name}, Admins and people on the project.`),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Places' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload files' })).toHaveCount(0);

    for (const url of [
      file.downloadUrl,
      file.viewUrl,
      shared.file.downloadUrl,
      `/api/project-tasks/${taskId}`,
    ]) {
      const response = await page.request.get(url);
      if (url.startsWith('/api/project-tasks/')) {
        expect((await response.json()).data.files, url).toEqual([]);
      } else {
        expect(response.status(), url).toBe(404);
      }
    }
    expect(problemsOf(page), 'console and page errors').toEqual([]);
  } finally {
    for (const id of [file.id, shared.file.id]) {
      expect((await write(pm, baseURL, 'delete', `/api/project-files/${id}`)).status()).toBe(200);
    }
  }
});
