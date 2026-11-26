// CONTRACT 28 (Daybook 1.13): Assign to me and My tasks. The CEO, an Admin who isn't on
// acme-store, takes Simran Kaur's task from its card: the toast says it is his and that Simran is
// told, and focus goes to the card's face. He finds it on /overview's My tasks card and on /my-tasks
// in its group, and the sidebar badge counts what is due now (overdue and today); there the task's
// window says "(you)", and a tick from the keyboard hands the focus on (Undo, then the next row's
// title). Simran's bell says who took it. The PM's people window never offers the CEO on other tasks, and on the CEO's task
// lists him last and checked. The PM takes a task from the card menu and Undo gives it back.
//
// Everything is put back (Undo, and the CEO's task goes back to Simran through the API), so the
// later specs find acme-store as the demo has it. Every /api/ai/** request is answered in the
// browser (support/projectPlan.js).
import {
  closeDemoData,
  companyToday,
  projectIdByName,
  taskByTitle,
  userIdByEmail,
} from './support/demoData.js';
import {
  PEOPLE,
  expect,
  open,
  problemsOf,
  sidebarLinks,
  test,
  toasts,
} from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const TAKEN = 'Checkout fix before client demo'; // Simran's, open, in Development
const OTHER = 'Shipping options at checkout'; // Simran's, open, in Development

let projectId;
const ids = { ceo: null, simran: null };

test.beforeAll(async () => {
  projectId = await projectIdByName(PROJECT);
  ids.ceo = await userIdByEmail(PEOPLE.ceo.email);
  ids.simran = await userIdByEmail(PEOPLE.simran.email);
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
/** A person-change PATCH of a task, and what it sent. */
const personPatched = (page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/project-tasks\/\d+$/.test(new URL(response.url()).pathname) &&
      'assigneeId' in (response.request().postDataJSON() ?? {}),
  );

/** The When group a due date falls in on My tasks (CONTRACT 28, whenOf), for the company today. */
function whenGroup(due, today) {
  if (!due) return 'No date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  const at = new Date(`${today}T00:00:00Z`);
  const sunday = new Date(at.getTime() + ((7 - at.getUTCDay()) % 7) * 86_400_000);
  return due <= sunday.toISOString().slice(0, 10) ? 'This week' : 'Later';
}

test('the CEO, not on acme-store, takes Simran’s task with Assign to me', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.ceo, `/projects/${projectId}`);
  const taken = card(page, TAKEN);
  await expect(
    taken.getByRole('button', { name: `Assigned to ${PEOPLE.simran.name}. Change person` }),
  ).toBeVisible();
  await taken.hover();
  const take = taken.getByRole('button', { name: `Assign ${TAKEN} to me`, exact: true });
  await expect(take).toBeVisible();
  await expect(take).toHaveAttribute('title', 'Assign to me');

  const patched = personPatched(page);
  await take.click();
  const response = await patched;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ assigneeId: ids.ceo });
  expect((await response.json()).data.toldEarlierName).toBe(PEOPLE.simran.name);

  const toast = toasts(page)
    .getByRole('status')
    .filter({ hasText: `${TAKEN} is now yours.` });
  await expect(toast).toContainText(`${PEOPLE.simran.name} gets a notification.`);
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  const face = taken.getByRole('button', {
    name: `Assigned to ${PEOPLE.ceo.name}. Change person`,
  });
  await expect(face).toBeFocused();
  await expect(taken.getByRole('button', { name: `Assign ${TAKEN} to me` })).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('he finds it on /overview and /my-tasks, and the badge counts what is due now', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.ceo, '/overview');
  const home = page.getByRole('region', { name: /^My tasks \d+ open$/ });
  await expect(home.getByRole('button', { name: TAKEN, exact: true })).toBeVisible();
  await expect(home.getByRole('link', { name: /^See all my tasks \(\d+\)$/ })).toHaveAttribute(
    'href',
    '/my-tasks',
  );

  await open(page, '/my-tasks');
  const table = page.getByRole('table', { name: 'My tasks' });
  await expect(table.getByRole('button', { name: TAKEN, exact: true })).toBeVisible();
  const groups = await table.evaluate((element) =>
    [...element.tBodies].map((body) => ({
      head: body.querySelector('th[scope="rowgroup"]')?.textContent.trim() ?? '',
      titles: [...body.querySelectorAll('[data-flip^="mine:"] [data-mine-title]')].map((title) =>
        title.textContent.trim(),
      ),
    })),
  );
  const { dueDate } = await taskByTitle(projectId, TAKEN);
  const expected = whenGroup(dueDate, await companyToday());
  const home2 = groups.find((group) => group.titles.includes(TAKEN));
  expect(home2?.head, `${TAKEN} (due ${dueDate}) is under ${expected}`).toMatch(
    new RegExp(`^${expected} ${home2?.titles.length}$`),
  );

  const dueNow = groups
    .filter((group) => /^(Overdue|Today) \d+$/.test(group.head))
    .reduce((sum, group) => sum + group.titles.length, 0);
  const item = sidebarLinks(page).filter({ hasText: /^My tasks/ });
  await expect(item).toHaveText(dueNow > 0 ? `My tasks${dueNow} due now` : 'My tasks', {
    useInnerText: false,
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('on My tasks his window says "(you)", and a keyboard tick hands the focus on', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.ceo, '/my-tasks');
  const table = page.getByRole('table', { name: 'My tasks' });
  const title = table.getByRole('button', { name: TAKEN, exact: true });
  await title.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('dl')).toContainText(`${PEOPLE.ceo.name} (you)`);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(title).toBeFocused();

  // The next row's title, or the previous one's after the last row.
  const titles = await table.locator('[data-mine-title]').allTextContents();
  const at = titles.indexOf(TAKEN);
  const next = titles[at + 1] ?? titles[at - 1];
  await table.getByRole('checkbox', { name: `Done: ${TAKEN}` }).focus();
  await page.keyboard.press('Space');
  const undo = toasts(page).getByRole('button', { name: 'Undo' });
  await expect(undo).toBeFocused();
  await expect(title).toHaveCount(0); // the row has left
  await page.keyboard.press('Tab');
  await expect(table.getByRole('button', { name: next, exact: true })).toBeFocused();
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(title).toBeVisible();
  await expect(table.getByRole('checkbox', { name: `Done: ${TAKEN}` })).not.toBeChecked();
  await expect(table.getByRole('button', { name: next, exact: true })).toBeFocused();
  expect((await taskByTitle(projectId, TAKEN)).status).toBe('open');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Simran’s bell says the CEO took it', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.simran, '/today');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const item = page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('link', { name: new RegExp(`^${TAKEN} on ${PROJECT} is now for `) })
    .first();
  await expect(item).toContainText(`${TAKEN} on ${PROJECT} is now for ${PEOPLE.ceo.name}`);
  await expect(item).toContainText(`${PEOPLE.ceo.name} took it.`);
  await expect(item).toHaveAttribute('href', `/projects/${projectId}`);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the PM’s people window offers the CEO only on his own task, last and checked', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const people = page.getByRole('dialog', { name: 'Assign to' });

  await card(page, OTHER)
    .getByRole('button', { name: `Assigned to ${PEOPLE.simran.name}. Change person` })
    .click();
  await expect(people.getByRole('searchbox', { name: 'Find a person' })).toBeFocused();
  const rows = people.getByRole('button', { pressed: undefined });
  await expect(people.getByRole('button', { name: new RegExp(`^Me \\(`) })).toBeVisible();
  await expect(
    people.getByRole('button', { name: new RegExp(PEOPLE.ceo.name.replace(/[[\]]/g, '\\$&')) }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(people).toHaveCount(0);

  await card(page, TAKEN)
    .getByRole('button', { name: `Assigned to ${PEOPLE.ceo.name}. Change person` })
    .click();
  const last = people.locator('button[aria-pressed]').last();
  await expect(last).toContainText(PEOPLE.ceo.name);
  await expect(last).toContainText('Admin');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(people.locator('button[aria-pressed="true"]')).toHaveCount(1);
  expect(await rows.count()).toBeGreaterThan(3);
  await page.keyboard.press('Escape');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the PM takes a task from the card menu, and Undo gives it back', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  await card(page, OTHER)
    .getByRole('button', { name: `More for ${OTHER}`, exact: true })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Assign to me',
    'Assign to…',
    'Open',
    'Edit',
    'Move to phase…',
    'Delete',
  ]);
  const pmId = await userIdByEmail(PEOPLE.pm.email);
  const taken = personPatched(page);
  await menu.getByRole('menuitem', { name: 'Assign to me' }).click();
  expect((await taken).request().postDataJSON()).toEqual({ assigneeId: pmId });
  const toast = toasts(page)
    .getByRole('status')
    .filter({ hasText: `${OTHER} is now yours.` });
  await expect(toast).toContainText(`${PEOPLE.simran.name} gets a notification.`);
  await expect(
    card(page, OTHER).getByRole('button', { name: `Assigned to ${PEOPLE.pm.name}. Change person` }),
  ).toBeFocused();

  const back = personPatched(page);
  await toast.getByRole('button', { name: 'Undo' }).click();
  const undone = await back;
  expect(undone.status()).toBe(200);
  expect(undone.request().postDataJSON()).toEqual({
    assigneeId: ids.simran,
    shareConfirmed: true,
    shareWith: ids.simran,
  });
  await expect(
    card(page, OTHER).getByRole('button', {
      name: `Assigned to ${PEOPLE.simran.name}. Change person`,
    }),
  ).toBeVisible();

  await test.step('the CEO’s task goes back to Simran', async () => {
    const { id } = await taskByTitle(projectId, TAKEN);
    const given = await write(page, baseURL, 'patch', `/api/project-tasks/${id}`, {
      assigneeId: ids.simran,
    });
    expect(given.status()).toBe(200);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
