// CONTRACT 25 items 6 and 9 (Daybook 1.10): company holidays and leave. HR adds a holiday for
// today: Attendance says so and nobody is "Not checked in", and an employee's Today says it is a
// holiday with no late mark. HR deletes it again, then marks first-half leave for another employee
// from the row's "..." menu: that employee's Today shows the leave and the later late mark. On a
// phone the row menu, its items and the Edit leave sheet are 44 px to tap. A PM sees who is on
// leave, without the type, and has no Leave page.
//
// Both employees must not have checked in today (the Check in card shows the late mark). The demo
// leaves Deepak Joshi without a check-in (timers.spec.js, later, checks him in). Yash Thakur checks
// in on the demo's today and no other spec uses him, so this spec removes that check-in first
// (the teardown loads the demo data again).
import { closeDemoData, companyToday, removeCheckInToday } from './support/demoData.js';
import {
  PEOPLE,
  dayShort,
  expect,
  expectTapSize,
  open,
  problemsOf,
  test,
  toasts,
} from './support/fixtures.js';

const YASH = { email: 'yash@company.com', name: 'Yash Thakur' };
const HOLIDAY = 'Foundation Day';

test.describe.configure({ mode: 'serial' });
test.afterAll(closeDemoData);

let today;

test.beforeAll(async () => {
  today = await companyToday();
  await removeCheckInToday(YASH.email);
});

/** The Check in card's subtitle ("Office hours 9:30 to 6:30. Late after 9:30."). */
const checkInCard = (page) => page.getByRole('region', { name: 'Your day' });

test('a holiday today: no late marks and nobody "Not checked in"', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);

  await test.step('HR adds the holiday', async () => {
    await open(neha, '/attendance/holidays');
    await neha.getByRole('button', { name: 'Add holiday' }).click();
    const dialog = neha.getByRole('dialog', { name: 'Add holiday' });
    // 480 px wide, so Cancel, "Save and add another" and "Add holiday" share one line.
    const footer = dialog.getByRole('button', {
      name: /^(Cancel|Save and add another|Add holiday)$/,
    });
    await expect(footer).toHaveCount(3);
    const tops = await footer.evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, `footer button tops ${tops.join(', ')}`).toBe(1);
    await dialog.getByLabel('Date', { exact: true }).fill(today);
    await expect(dialog.getByText(/^This is today\. Late marks of anyone/)).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(HOLIDAY);
    await dialog.getByRole('button', { name: 'Add holiday' }).click();
    await expect(toasts(neha)).toContainText('Holiday added');
    await expect(toasts(neha)).toContainText(`${HOLIDAY}, ${dayShort(today)}`);
    await expect(dialog).toBeHidden();
    const row = neha.getByRole('row').filter({ hasText: HOLIDAY });
    await expect(row).toContainText(dayShort(today));
    await expect(row).toContainText('Today');
  });

  await test.step('Attendance: a holiday, nobody expected in', async () => {
    await open(neha, '/attendance');
    await expect(
      neha.getByText(
        `Holiday: ${HOLIDAY}. Nobody is expected in, so there are no late marks or reminders.`,
      ),
    ).toBeVisible();
    await expect(neha.getByRole('link', { name: 'Not checked in (0)' })).toBeVisible();
    const table = neha.getByRole('table', { name: 'Everyone today' });
    await expect(table.getByText('Not checked in', { exact: true })).toHaveCount(0);
    await expect(table.getByRole('row').filter({ hasText: PEOPLE.deepak.name })).toContainText(
      'Holiday',
    );
  });

  const deepak = await signInAs(PEOPLE.deepak);

  await test.step("an employee's Today", async () => {
    await open(deepak, '/today');
    await expect(
      deepak.getByText(`Today is a holiday: ${HOLIDAY}. Check in only if you're working.`),
    ).toBeVisible();
    await expect(checkInCard(deepak)).toContainText('No late mark today.');
  });

  await test.step('HR deletes the holiday', async () => {
    await open(neha, '/attendance/holidays');
    await neha.getByRole('button', { name: `Actions for ${HOLIDAY}` }).click();
    await neha.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = neha.getByRole('dialog', { name: `Delete ${HOLIDAY}?` });
    await expect(confirm).toContainText(`${dayShort(today)} becomes a working day again.`);
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(toasts(neha)).toContainText('Holiday deleted');
    await expect(neha.getByRole('row').filter({ hasText: HOLIDAY })).toHaveCount(0);
  });

  await test.step('the late mark is back on Today', async () => {
    await open(deepak, '/today');
    await expect(deepak.getByText(/^Today is a holiday/)).toHaveCount(0);
    await expect(checkInCard(deepak)).toContainText('Late after 9:30.');
  });
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});

test('HR marks first-half leave from the row menu', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);

  await test.step('Mark leave from the row', async () => {
    await open(neha, '/attendance');
    const table = neha.getByRole('table', { name: 'Everyone today' });
    const row = table.getByRole('row').filter({ hasText: YASH.name });
    await row.getByRole('button', { name: `More for ${YASH.name}` }).click();
    await neha.getByRole('menuitem', { name: 'Mark leave' }).click();
    const dialog = neha.getByRole('dialog', { name: 'Mark leave' });
    await expect(dialog.getByLabel('Person', { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('First day', { exact: true })).toHaveValue(today);
    await dialog
      .getByRole('group', { name: 'Part of the day' })
      .getByRole('button', { name: 'First half' })
      .click();
    await expect(dialog.getByText('Half a working day.')).toBeVisible();
    await expect(dialog.getByText('First half: until 2:00. Second half: from 2:00.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Mark leave' }).click();
    await expect(toasts(neha)).toContainText('Leave saved');
    await expect(dialog).toBeHidden();
  });

  const yash = await signInAs(YASH);

  await test.step("the employee's Today", async () => {
    await open(yash, '/today');
    await expect(
      yash.getByText("You're on leave for the first half of today, until 2:00."),
    ).toBeVisible();
    await expect(
      yash.getByText(`Casual leave, paid. Marked by ${PEOPLE.neha.name}.`),
    ).toBeVisible();
    await expect(checkInCard(yash)).toContainText('Late after 2:00.');
  });
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});

test('on a phone the row menu and the leave sheet are 44 px to tap', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);
  await neha.setViewportSize({ width: 390, height: 844 });
  await open(neha, '/attendance');
  const row = neha
    .getByRole('table', { name: 'Everyone today' })
    .getByRole('row')
    .filter({ hasText: YASH.name });
  const more = row.getByRole('button', { name: `More for ${YASH.name}` });
  await expectTapSize(more, 'the row menu');
  await more.click();
  const items = neha.getByRole('menu', { name: `More for ${YASH.name}` }).getByRole('menuitem');
  await expect(items.filter({ hasText: 'Edit leave' })).toBeVisible();
  for (const item of await items.all()) await expectTapSize(item);

  await items.filter({ hasText: 'Edit leave' }).click();
  const sheet = neha.getByRole('dialog', { name: 'Edit leave' });
  await expectTapSize(sheet.getByRole('button', { name: 'Delete leave' }));
  for (const name of ['Part of the day', 'Pay']) {
    const choices = sheet.getByRole('group', { name }).getByRole('button');
    await expect(choices.first()).toBeVisible();
    for (const choice of await choices.all()) await expectTapSize(choice);
  }
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});

test('a PM sees who is on leave, not the type, and has no Leave page', async ({ signInAs }) => {
  const pm = await signInAs(PEOPLE.pm);
  await open(pm, '/attendance');
  await expect(pm.getByText('On leave today', { exact: true })).toBeVisible();
  const onLeave = pm.getByRole('listitem').filter({ hasText: YASH.name });
  await expect(onLeave).toContainText('First half');
  await expect(onLeave).not.toContainText('Casual');
  await expect(onLeave).not.toContainText('paid');

  await open(pm, '/attendance/leave');
  await expect(pm).toHaveURL(/\/no-access$/);
  await expect(pm.getByRole('heading', { level: 1 })).toHaveText('No access');
});
