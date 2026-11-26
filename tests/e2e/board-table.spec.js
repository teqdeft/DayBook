// CONTRACT 28 (Daybook 1.13): the Table. The PM switches Board | Table: the address gets
// ?view=table, a reload keeps the Table (a cookie) and the server draws it in the first paint, and
// ?view=board wins over the cookie. Sorting by Due marks the header with aria-sort (ascending, then
// descending) and "Group by phase again" brings the groups back. Two of Simran's tasks are picked:
// Give to… Vishal Saini says "2 tasks are now for Vishal Saini." and Undo gives both back; with a
// private file linked to one of them meanwhile, the window asks the share confirm with the tasks
// read again. Move to phase… moves both to Testing ("Moved 2 tasks to Testing.") and Undo moves
// them back. A member's Table has no select boxes. At 390 px the Table is a stacked list.
//
// The contract's example gives the tasks to Sneha Patil; she isn't on acme-store in the demo, so
// Vishal Saini, a member, takes her place. Everything is put back with Undo. Every /api/ai/**
// request is answered in the browser (support/projectPlan.js).
import { closeDemoData, projectIdByName, taskByTitle, userIdByEmail } from './support/demoData.js';
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const PICKED = ['Shipping options at checkout', 'Stock sync with the warehouse']; // Simran's
const CONTRACT = 'acme-store-contract-signed.pdf'; // only PM and Admins, on no task

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

const table = (page) => page.getByRole('table', { name: `Tasks of ${PROJECT}` });
const view = (page) => page.getByRole('group', { name: 'View' });
const bar = (page) => page.getByRole('region', { name: 'Selected tasks' });
/** A task's row in the Table. */
const row = (page, title) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
/** The phase group each task's row sits under: { [title]: 'Development' }. */
const groupOf = (page) =>
  table(page).evaluate((element) => {
    const groups = {};
    let group = null;
    for (const tr of element.querySelectorAll('tbody tr')) {
      const heading = tr.querySelector('h3');
      if (heading) group = heading.textContent.trim();
      const title = tr.querySelector('[data-row-title]');
      if (title) groups[title.textContent.trim()] = group;
    }
    return groups;
  });
/** The answer of a bulk action, and what it sent. */
const bulkSent = (page) =>
  page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/tasks/bulk'),
  );

/** Picks the two tasks' select boxes. */
async function pickBoth(page) {
  for (const title of PICKED) {
    await table(page)
      .getByRole('checkbox', { name: `Select ${title}` })
      .check();
  }
  await expect(bar(page)).toContainText('2 selected');
}

test('Board | Table: the address, a reload and the first paint keep the Table', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  await expect(view(page).getByRole('button', { name: 'Board' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await view(page).getByRole('button', { name: 'Table' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?view=table$`));
  await expect(table(page)).toBeVisible();
  await expect(view(page).getByRole('button', { name: 'Table' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await open(page, `/projects/${projectId}`);
  await expect(table(page)).toBeVisible();
  const html = await (await page.request.get(`/projects/${projectId}`)).text();
  expect(html, 'the server draws the Table first').toContain(`aria-label="Tasks of ${PROJECT}"`);

  await open(page, `/projects/${projectId}?view=board`);
  await expect(table(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Development', exact: true })).toBeVisible();
  await view(page).getByRole('button', { name: 'Table' }).click();
  await expect(table(page)).toBeVisible();
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('sorting by Due marks the header, and Group by phase again undoes it', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?view=table`);
  const due = table(page).getByRole('columnheader', { name: 'Due' });
  await expect(table(page).locator('th[aria-sort]')).toHaveCount(0);
  await due.getByRole('button', { name: 'Due' }).click();
  await expect(due).toHaveAttribute('aria-sort', 'ascending');
  await expect(table(page).locator('th[aria-sort]')).toHaveCount(1);
  await expect(table(page).getByRole('columnheader', { name: 'Phase' })).toBeVisible();
  await due.getByRole('button', { name: 'Due' }).click();
  await expect(due).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Group by phase again' }).focus();
  await page.keyboard.press('Enter');
  await expect(table(page).locator('th[aria-sort]')).toHaveCount(0);
  // The button went with the sort: the focus is on the switch's Table button, not the page.
  await expect(view(page).getByRole('button', { name: 'Table' })).toBeFocused();
  await expect(table(page).getByRole('heading', { name: 'Development', level: 3 })).toBeVisible();
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Give to… two tasks, then Undo gives both back', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?view=table`);
  const simran = await userIdByEmail(PEOPLE.simran.email);
  const vishal = await userIdByEmail(PEOPLE.vishal.email);
  await pickBoth(page);
  await bar(page).getByRole('button', { name: 'Give to…' }).click();
  const people = page.getByRole('dialog', { name: 'Give 2 tasks to' });
  await expect(people).toBeVisible();
  const given = bulkSent(page);
  await people.getByRole('button', { name: new RegExp(`^${PEOPLE.vishal.name}`) }).click();
  const answer = await given;
  expect(answer.status()).toBe(200);
  const { changes } = answer.request().postDataJSON();
  expect(changes.map((change) => change.assigneeId)).toEqual([vishal, vishal]);

  const toast = toasts(page)
    .getByRole('status')
    .filter({ hasText: `2 tasks are now for ${PEOPLE.vishal.name}.` });
  await expect(toast).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select all shown tasks' })).toBeFocused();
  for (const title of PICKED) {
    await expect(row(page, title)).toContainText(PEOPLE.vishal.name);
  }

  const back = bulkSent(page);
  await toast.getByRole('button', { name: 'Undo' }).click();
  const undone = await back;
  expect(undone.status()).toBe(200);
  const sent = undone.request().postDataJSON();
  expect(sent.shareConfirmed).toBe(true);
  expect(sent.changes.map((change) => change.assigneeId)).toEqual([simran, simran]);
  for (const title of PICKED) {
    await expect(row(page, title)).toContainText(PEOPLE.simran.name);
  }
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a private file linked meanwhile: Give to… asks with the tasks read again', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?view=table`);
  const simran = await userIdByEmail(PEOPLE.simran.email);
  const { id: taskId } = await taskByTitle(projectId, PICKED[0]);
  await pickBoth(page);
  // Another tab links the contract to one of them: this page's counts are stale.
  const picker = await (await page.request.get(`/api/projects/${projectId}/files`)).json();
  const contract = picker.data.files.find((file) => file.name === CONTRACT);
  const linked = await write(page, baseURL, 'post', `/api/project-tasks/${taskId}/files`, {
    linkFileIds: [contract.id],
    shareConfirmed: true,
    shareWith: simran,
  });
  expect(linked.status()).toBe(201);
  try {
    await bar(page).getByRole('button', { name: 'Give to…' }).click();
    const people = page.getByRole('dialog', { name: 'Give 2 tasks to' });
    const refused = bulkSent(page);
    await people.getByRole('button', { name: new RegExp(`^${PEOPLE.vishal.name}`) }).click();
    expect((await refused).status()).toBe(400);
    await expect(people).toContainText(
      `1 of these tasks has a file only for PM and Admins. ${PEOPLE.vishal.name} will be able to open it from that task.`,
    );
    const given = bulkSent(page);
    await people.getByRole('button', { name: 'Give and share' }).click();
    const answer = await given;
    expect(answer.status()).toBe(200);
    expect(answer.request().postDataJSON().shareConfirmed).toBe(true);
    const toast = toasts(page)
      .getByRole('status')
      .filter({ hasText: `2 tasks are now for ${PEOPLE.vishal.name}.` });
    await expect(people).toHaveCount(0);
    const back = bulkSent(page);
    await toast.getByRole('button', { name: 'Undo' }).click();
    expect((await back).status()).toBe(200);
    for (const title of PICKED) {
      await expect(row(page, title)).toContainText(PEOPLE.simran.name);
    }
  } finally {
    const path = `/api/project-tasks/${taskId}/links/${contract.id}`;
    expect((await write(page, baseURL, 'delete', path)).status()).toBe(200);
  }
  // The browser logs the one refusal (400) as a failed resource; nothing else went wrong.
  const problems = problemsOf(page).filter((text) => !text.includes('400'));
  expect(problems, 'console and page errors').toEqual([]);
});

test('Move to phase… two tasks to Testing, then Undo moves them back', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?view=table`);
  await pickBoth(page);
  await bar(page).getByRole('button', { name: 'Move to phase…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move 2 tasks' });
  const moved = bulkSent(page);
  await dialog.getByRole('button', { name: /^Testing/ }).click();
  const answer = await moved;
  expect(answer.status()).toBe(200);
  expect(
    answer
      .request()
      .postDataJSON()
      .changes.map((change) => change.phase),
  ).toEqual(['testing', 'testing']);
  const toast = toasts(page).getByRole('status').filter({ hasText: 'Moved 2 tasks to Testing.' });
  await expect(toast).toBeVisible();
  const groups = async () => {
    const all = await groupOf(page);
    return PICKED.map((title) => all[title]);
  };
  await expect.poll(groups).toEqual(['Testing', 'Testing']);

  const back = bulkSent(page);
  await toast.getByRole('button', { name: 'Undo' }).click();
  const undone = await back;
  expect(undone.status()).toBe(200);
  expect(
    undone
      .request()
      .postDataJSON()
      .changes.map((change) => change.phase),
  ).toEqual(['development', 'development']);
  await expect.poll(groups).toEqual(['Development', 'Development']);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a member’s Table has no select boxes; at 390 px it is a stacked list', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.vishal, `/projects/${projectId}?view=table`);
  await expect(table(page)).toBeVisible();
  await expect(table(page).getByRole('columnheader')).toHaveText([
    '#',
    'Task',
    'Person',
    'Priority',
    'Due',
    'Status',
    'Files',
  ]);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(table(page).getByRole('button', { name: 'Payment settings page' })).toBeVisible();
  await expect(table(page)).toContainText('For you');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table(page)).toBeHidden();
  const stack = page.locator('[data-stack]');
  await expect(stack).toBeVisible();
  await expect(stack.getByRole('button', { name: 'Payment settings page' })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, 'no sideways scroll at 390 px').toBeLessThanOrEqual(390);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
