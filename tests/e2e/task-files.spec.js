// CONTRACT 27 (Daybook 1.12) and 28 (1.13): files on tasks. The PM creates a task in Development
// for Vishal Saini (the "Assign to" radio chips) with a PNG and a PDF picked through the real file
// chooser ("Upload files"); the card shows both as chips. Vishal sees the paperclip "2" on Today's
// Priority tasks card, opens the task window, sees the picture's thumbnail, opens it in the
// picture viewer and downloads the PDF (the same bytes as the fixture). Karan Mehta, an employee
// who isn't on the project, gets 404 for the files and the task. The PM then drops notes.txt on the
// task's card and the card shows "+1" (3 files). Cancelling the only upload in the task window
// (Add files → Upload files) keeps focus in the window, on Add files.
//
// project-plan.spec.js, which runs first, moves acme-store on to Testing, so the task's phase is
// picked rather than left at the current one. Every /api/ai/** request is answered in the
// browser (support/projectPlan.js).
import { readFileSync } from 'node:fs';
import { closeDemoData, projectIdByName, userIdByEmail } from './support/demoData.js';
import { chooseFiles, dropFiles, fileFixture } from './support/files.js';
import { PEOPLE, cellUnder, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const TITLE = 'Payment page copy and screenshots';
const PICTURE = 'logo.png';
const PDF = 'two-pages.pdf';

let projectId;
/** Filled by the first test: the task's id and its files' links. */
const made = { taskId: null, links: {} };

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

const card = (page, title) =>
  page.locator('li[id^="board-card-"]').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  });

test('the PM creates a task for Vishal with a PNG and a PDF', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const starts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/uploads')) {
      starts.push(request.postDataJSON());
    }
  });

  await page
    .getByRole('group', { name: 'Task tools' })
    .getByRole('button', { name: 'Add task', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Task title').fill(TITLE);
  await dialog
    .getByRole('group', { name: 'Assign to' })
    .getByRole('radio', { name: PEOPLE.vishal.name, exact: true })
    .check();
  await dialog.getByLabel('Phase').selectOption('development');
  await expect(dialog).toContainText(
    'Up to 20 files, each up to 500 MB. Any type of file. Files from the project stay in Files.',
  );
  await chooseFiles(page, dialog.getByText('Upload files', { exact: true }), [
    fileFixture(PICTURE),
    fileFixture(`pdf/${PDF}`),
  ]);
  for (const name of [PICTURE, PDF]) {
    await expect(
      dialog.getByRole('button', { name: new RegExp(`^(Remove|Cancel uploading) ${name}$`) }),
    ).toBeVisible();
  }
  // While the files go up the button reads "Uploading 2 files…"; it reads Add task once they're in.
  const add = dialog.getByRole('button', { name: 'Add task', exact: true });
  await expect(add).toBeVisible({ timeout: 60_000 });
  expect(starts.map(({ name, target, taskId }) => [name, target, taskId])).toEqual([
    [PICTURE, 'task', null],
    [PDF, 'task', null],
  ]);

  const posted = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/tasks'),
  );
  await add.click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const body = response.request().postDataJSON();
  expect(body).toMatchObject({
    title: TITLE,
    phase: 'development',
    assigneeId: await userIdByEmail(PEOPLE.vishal.email),
  });
  expect(body.uploadKeys).toHaveLength(2);
  made.taskId = (await response.json()).data.id;

  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).getByText('Task added to Development.')).toBeVisible();
  await expect(
    toasts(page).getByText(`${PEOPLE.vishal.name} gets a notification with the 2 file names.`),
  ).toBeVisible();
  const development = page.getByRole('region', { name: 'Development', exact: true });
  await expect(development.getByRole('button', { name: TITLE, exact: true })).toBeVisible();
  // The files line: the picture first (its thumbnail opens the viewer), then the PDF's chip.
  await expect(
    card(page, TITLE).getByRole('button', { name: `Open picture ${PICTURE}` }),
  ).toBeVisible();
  await expect(card(page, TITLE).getByText(PDF, { exact: true })).toBeVisible();
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Vishal sees the paperclip on Today, the thumbnail and the viewer, and downloads the PDF', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.vishal, '/today');
  const priority = page.getByRole('region', { name: 'Priority tasks' });
  const table = priority.getByRole('table', { name: 'Priority tasks' });
  const row = table.getByRole('row').filter({ hasText: TITLE });
  // The Task cell: the Priority cell holds a copy of both for the stacked rows of a phone.
  const task = await cellUnder(table, row, 'Task');
  await expect(task.getByRole('img', { name: '2 files' })).toBeVisible();

  await task.getByRole('button', { name: TITLE, exact: true }).click();
  const window = page.getByRole('dialog', { name: TITLE });
  await expect(window).toContainText(PROJECT);
  await expect(window).toContainText('Development');
  await expect(window.getByRole('heading', { name: /^Files/ })).toContainText('2');
  for (const name of ['Mark done', 'Edit', 'Delete', `Remove ${PDF}`, /^Add files/]) {
    await expect(window.getByRole('button', { name })).toHaveCount(0);
  }

  await test.step('the thumbnail opens the picture viewer', async () => {
    const thumb = window.getByRole('button', { name: `Open ${PICTURE}` });
    await expect(thumb.locator('img')).toHaveAttribute(
      'src',
      /^\/api\/project-files\/\d+\/(thumb|view)$/,
    );
    await expect
      .poll(() => thumb.locator('img').evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0);
    await thumb.click();
    const viewer = page.getByRole('dialog', { name: PICTURE });
    const picture = viewer.getByRole('img');
    await expect(picture).toHaveAttribute('src', /^\/api\/project-files\/\d+\/view$/);
    await expect.poll(() => picture.evaluate((image) => image.naturalWidth)).toBe(48);
    await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
    made.links.view = await picture.getAttribute('src');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(thumb).toBeFocused();
    await expect(window).toBeVisible();
  });

  await test.step('the PDF downloads, byte for byte', async () => {
    const link = window.getByRole('link', { name: `Download ${PDF}` });
    made.links.pdf = await link.getAttribute('href');
    const downloading = page.waitForEvent('download');
    await link.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(PDF);
    const bytes = readFileSync(await download.path());
    expect(bytes.equals(readFileSync(fileFixture(`pdf/${PDF}`)))).toBe(true);
  });

  await window.getByRole('button', { name: 'Close' }).first().click();
  await expect(window).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('an employee who isn’t on the project gets 404 for the files and the task', async ({
  signInAs,
}) => {
  const page = await signInAs(PEOPLE.karan);
  for (const url of [made.links.pdf, made.links.view, `/api/project-tasks/${made.taskId}`]) {
    const response = await page.request.get(url);
    expect(response.status(), url).toBe(404);
  }
  // The page itself is the not-found page, with a real 404 (the [id] layout checks before the
  // page streams).
  const shown = await open(page, `/projects/${projectId}?task=${made.taskId}`);
  expect(shown.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.getByRole('main')).not.toContainText(TITLE);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the PM drops a file on the card and it shows "+1"', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const target = card(page, TITLE);
  await expect(target.getByText(PDF, { exact: true })).toBeVisible();
  await expect(target.getByTitle('3 files')).toHaveCount(0);

  const attached = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/project-tasks/${made.taskId}/files`),
    { timeout: 60_000 },
  );
  await dropFiles(page, target, [fileFixture('notes.txt')]);
  const response = await attached;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().uploadKeys).toHaveLength(1);
  await expect(toasts(page).getByText(`1 file added to ${TITLE}.`)).toBeVisible();
  await expect(toasts(page).getByText(`${PEOPLE.vishal.name} is told.`)).toBeVisible();
  await expect(target.getByTitle('3 files')).toHaveText('+1');

  await test.step('after a reload the card still counts 3', async () => {
    await open(page, `/projects/${projectId}`);
    await expect(card(page, TITLE).getByTitle('3 files')).toHaveText('+1');
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('cancelling the only upload in the task window keeps focus in it, on Add files', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?task=${made.taskId}`);
  const window = page.getByRole('dialog', { name: TITLE });
  const addFiles = window.getByRole('button', { name: 'Add files', exact: true });
  await expect(addFiles).toBeVisible();
  // The piece is never answered, so the file stays on its way until it is cancelled.
  const held = [];
  await page.route('**/api/uploads/*/pieces*', (route) => held.push(route));
  try {
    await addFiles.click();
    await chooseFiles(page, page.getByRole('menuitem', { name: 'Upload files' }), [
      fileFixture('drawing.svg'),
    ]);
    const cancel = window.getByRole('button', { name: 'Cancel uploading drawing.svg' });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(cancel).toHaveCount(0);
    await expect(window.getByRole('button', { name: 'Add files', exact: true })).toBeFocused();
  } finally {
    await page.unroute('**/api/uploads/*/pieces*');
    await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  }
});
