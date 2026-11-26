// CONTRACT 28 (Daybook 1.13): files from the project on a task. The PM adds a task for Vishal Saini
// from the toolbar's Add task and picks two Whole project files with "From project files": the
// brand guide (everyone on the project) and the signed contract (only PM and Admins). The picker
// asks before sharing the contract with Vishal; after "Attach and share" both show as linked chips
// and the task is saved with them. Vishal then sees the paperclip 2 on Today (and its new Due
// column), both files in the task window ("From Files: Whole project"), downloads the contract,
// and finds it in his Files tab only under On tasks and in All files ("Shared with you on …"),
// never in its place. The PM takes the contract off the task in the task window; once the Undo
// toast ends, Vishal's link answers 404 and Today counts 1.
//
// The task is deleted at the end, so the files stay as the demo has them (the contract unlinked).
// Every /api/ai/** request is answered in the browser (support/projectPlan.js).
import { closeDemoData, projectIdByName, userIdByEmail } from './support/demoData.js';
import { answerOf } from './support/files.js';
import { PEOPLE, cellUnder, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const TITLE = 'Check the brand guide against the contract';
const GUIDE = 'acme-brand-guide.pdf'; // Whole project, everyone on the project
const CONTRACT = 'acme-store-contract-signed.pdf'; // Whole project, only PM and Admins

let projectId;
/** Filled as the tests go: the task's id and the contract's download link. */
const made = { taskId: null, contractLink: null };

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

/** The row of the task on Vishal's Today (Priority tasks) and its Task cell. */
async function todayTask(page) {
  const table = page
    .getByRole('region', { name: 'Priority tasks' })
    .getByRole('table', { name: 'Priority tasks' });
  const row = table.getByRole('row').filter({ hasText: TITLE });
  return cellUnder(table, row, 'Task');
}

test('the PM adds a task for Vishal with two project files, sharing the contract', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  await page
    .getByRole('group', { name: 'Task tools' })
    .getByRole('button', { name: 'Add task', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Task title').fill(TITLE);
  const assign = dialog.getByRole('group', { name: 'Assign to' });
  await expect(assign.getByRole('radio', { name: 'Anyone on the project' })).toBeChecked();
  await assign.getByRole('radio', { name: PEOPLE.vishal.name, exact: true }).check();
  // project-plan.spec.js, which runs first, moves acme-store on to Testing: the phase is picked.
  await dialog.getByLabel('Phase').selectOption('development');

  await dialog.getByRole('button', { name: 'From project files' }).click();
  const picker = page.getByRole('dialog', { name: 'Attach from project files' });
  await expect(picker).toContainText('Files stay in Files. The task gets a link to them.');
  // The picker opens on the task's phase when it has files (project-plan.spec.js adds some to
  // Development), so the files are picked from Whole project.
  const place = picker
    .getByRole('navigation', { name: 'Places' })
    .getByRole('button', { name: /^Whole project/ });
  await place.click();
  await expect(place).toHaveAttribute('aria-pressed', 'true');
  const files = picker.getByRole('group', { name: 'Project files' });
  await files.getByRole('checkbox', { name: new RegExp(`^${GUIDE}`) }).check();
  await files.getByRole('checkbox', { name: new RegExp(`^${CONTRACT}`) }).check();
  await expect(picker.getByText('2 picked')).toBeVisible();
  await picker.getByRole('button', { name: 'Attach 2 files' }).click();

  const confirm = picker.getByRole('status').filter({ hasText: 'only for PM and Admins' });
  await expect(
    confirm.getByText(
      `${CONTRACT} is only for PM and Admins. ${PEOPLE.vishal.name} will be able to open it from this task.`,
      { exact: true },
    ),
  ).toBeVisible();
  const share = picker.getByRole('button', { name: 'Attach and share' });
  await expect(share).toBeFocused();
  await share.click();
  await expect(picker).toHaveCount(0);

  for (const name of [GUIDE, CONTRACT]) {
    await expect(
      dialog.getByRole('button', { name: `Remove ${name} from this task`, exact: true }),
    ).toBeVisible();
  }
  await expect(dialog).toContainText(/From Files · PDF/);

  const posted = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/tasks'),
  );
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const vishalId = await userIdByEmail(PEOPLE.vishal.email);
  const body = response.request().postDataJSON();
  expect(body).toMatchObject({
    title: TITLE,
    assigneeId: vishalId,
    shareConfirmed: true,
    shareWith: vishalId,
  });
  expect(body.linkFileIds).toHaveLength(2);
  made.taskId = (await response.json()).data.id;

  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).getByText('Task added to Development.')).toBeVisible();
  const added = card(page, TITLE);
  await expect(
    page.getByRole('region', { name: 'Development', exact: true }).getByRole('button', {
      name: TITLE,
      exact: true,
    }),
  ).toBeVisible();
  await expect(added).toContainText(GUIDE);
  await expect(added).toContainText(CONTRACT);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Vishal sees both files on Today and in the task window, and opens the contract', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.vishal, '/today');
  const task = await todayTask(page);
  await expect(task.getByRole('img', { name: '2 files' })).toBeVisible();

  await test.step('Today has a Due column (CONTRACT 28): a date, or nothing', async () => {
    const table = page.getByRole('table', { name: 'Priority tasks' });
    const due = (title) =>
      cellUnder(table, table.getByRole('row').filter({ hasText: title }), 'Due');
    await expect(await due('Payment settings page')).toHaveText(/^\d+ days? late$/);
    await expect(await due(TITLE)).toHaveText('');
  });

  await task.getByRole('button', { name: TITLE, exact: true }).click();
  const window = page.getByRole('dialog', { name: TITLE });
  await expect(window.getByRole('heading', { name: /^Files/ })).toContainText('2');
  for (const name of [GUIDE, CONTRACT]) {
    const download = page.getByRole('link', { name: `Download ${name}` });
    await expect(
      window.getByRole('listitem').filter({ has: download }),
      `${name} is linked from Files`,
    ).toContainText('From Files: Whole project');
  }
  await expect(window.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  made.contractLink = await window
    .getByRole('link', { name: `Download ${CONTRACT}` })
    .getAttribute('href');
  const download = await answerOf(page, made.contractLink);
  expect(download.status, 'the contract downloads').toBe(200);
  expect(download.headers['content-disposition']).toContain(CONTRACT);

  await test.step('his Files tab: the contract only on his task and in All files', async () => {
    await open(page, `/projects/${projectId}?tab=files&place=all`);
    const main = page.getByRole('main');
    await expect(main.getByText(`Shared with you on ${TITLE}`)).toBeVisible();
    await expect(main.getByText('Only PM and Admins')).toHaveCount(0);
    await expect(main.getByText(/On \d+ tasks?$/)).toHaveCount(0);

    await open(page, `/projects/${projectId}?tab=files&place=project`);
    await expect(main.getByRole('link', { name: GUIDE, exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: CONTRACT, exact: true })).toHaveCount(0);

    await open(page, `/projects/${projectId}?tab=files&place=tasks`);
    const contract = main
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: CONTRACT, exact: true }) });
    await expect(contract).toBeVisible();
    await expect(contract).toContainText('From Files');
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the PM takes the contract off the task; Vishal then gets 404 and Today counts 1', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?task=${made.taskId}`);
  const window = page.getByRole('dialog', { name: TITLE });
  const remove = window.getByRole('button', {
    name: `Remove ${CONTRACT} from this task`,
    exact: true,
  });
  await expect(remove).toBeVisible();
  const unlinked = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.startsWith(`/api/project-tasks/${made.taskId}/links/`),
    { timeout: 30_000 },
  );
  await remove.click();
  const toast = toasts(page)
    .getByRole('status')
    .filter({ hasText: 'Removed from this task. It stays in Files.' });
  await expect(toast).toBeVisible();
  await expect(window.getByRole('link', { name: `Download ${CONTRACT}` })).toHaveCount(0);
  expect((await unlinked).status()).toBe(200);
  await expect(toast).toHaveCount(0);

  const vishal = await signInAs(PEOPLE.vishal);
  expect((await answerOf(vishal, made.contractLink)).status, 'the contract after').toBe(404);
  await open(vishal, '/today');
  await expect((await todayTask(vishal)).getByRole('img', { name: '1 file' })).toBeVisible();

  await test.step('the task goes again; both files stay in Files', async () => {
    const removed = await write(page, baseURL, 'delete', `/api/project-tasks/${made.taskId}`);
    expect(removed.status()).toBe(200);
    await open(page, `/projects/${projectId}?tab=files&place=project`);
    for (const name of [GUIDE, CONTRACT]) {
      await expect(page.getByRole('main').getByRole('link', { name, exact: true })).toBeVisible();
    }
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
