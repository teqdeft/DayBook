// CONTRACT 28 (Daybook 1.13): a Completed project. The PM opens acme-landing (Completed in the
// demo): the note says new tasks can't be added and how to add them again, the toolbar holds
// Reopen project instead of Add task, and the columns have no "+", no "+ Add task" and the
// completed sentence. Reopen project asks first; then "Project reopened." and Add task is there
// with the focus; Undo makes the project Completed again. Vishal Saini, a member, sees the note
// without the Reopen part, and no Reopen project.
//
// Undo puts the project back as the demo has it. Every /api/ai/** request is answered in the
// browser (support/projectPlan.js).
import { closeDemoData, projectIdByName } from './support/demoData.js';
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-landing'; // Completed, PM: the demo PM, members Vishal Saini and Kavya Reddy
const NOTE = "This project is completed, so new tasks can't be added.";
const REOPEN_HINT = ' Use Reopen project to add tasks again.';

let projectId;
test.beforeAll(async () => {
  projectId = await projectIdByName(PROJECT);
});
test.afterAll(closeDemoData);

/** Signs in with every AI request stubbed, and opens the project's Board. */
async function openAs(signInAs, person) {
  const page = await signInAs(person);
  await stubAi(page);
  await open(page, `/projects/${projectId}`);
  return page;
}

const tools = (page) => page.getByRole('group', { name: 'Task tools' });
const statusPatched = (page, status) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === `/api/projects/${projectId}` &&
      response.request().postDataJSON()?.status === status,
  );

test('the PM: the note, no way to add, then Reopen project and Undo', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Completed');
  await expect(page.getByText(NOTE + REOPEN_HINT, { exact: true })).toBeVisible();
  await expect(tools(page).getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^New task in / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add task to / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move to / })).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Development', exact: true })
      .getByText('No tasks here. This project is completed.'),
  ).toBeVisible();

  const reopen = tools(page).getByRole('button', { name: 'Reopen project' });
  await reopen.click();
  const dialog = page.getByRole('dialog', { name: `Reopen ${PROJECT}?` });
  await expect(dialog).toContainText('It goes back to Active, and tasks can be added again.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reopen).toBeFocused();

  await reopen.click();
  const reopened = statusPatched(page, 'active');
  await dialog.getByRole('button', { name: 'Reopen project' }).click();
  expect((await reopened).status()).toBe(200);
  const toast = toasts(page).getByRole('status').filter({ hasText: 'Project reopened.' });
  await expect(toast).toBeVisible();
  const add = tools(page).getByRole('button', { name: 'Add task', exact: true });
  await expect(add).toBeFocused();
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add task to Development' })).toBeVisible();

  const completed = statusPatched(page, 'completed');
  await toast.getByRole('button', { name: 'Undo' }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByText(NOTE + REOPEN_HINT, { exact: true })).toBeVisible();
  await expect(tools(page).getByRole('button', { name: 'Reopen project' })).toBeFocused();

  await open(page, `/projects/${projectId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Completed');
  await expect(tools(page).getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a member sees the sentence only', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.vishal);
  await expect(page.getByText(NOTE, { exact: true })).toBeVisible();
  await expect(page.getByText(REOPEN_HINT.trim())).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add task/ })).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
