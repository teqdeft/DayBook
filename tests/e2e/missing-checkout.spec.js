// CONTRACT 25 B and 7 (Daybook 1.10): missing check-outs. The demo data has five on older days
// (db/demo/hrTools.js; Attendance's number still counts "1 from yesterday", Deepak's, and adds
// "to fix in all"), each with Daybook's suggested time from that day's screen time (6:30 PM):
// - Meena Das keeps the suggestion in Today's pop-up and saves it: it is within her limit;
// - Varun Chopra types a later time, past his limit (the suggestion plus 15 minutes), so it goes
//   to HR as a correction request and Today shows it under "Waiting for HR";
// - HR opens the list from the "Missing check-out" number, selects every row it can fix with the
//   head-row checkbox, leaves Sneha Patil out, fixes Arjun Nair's and Kavya Reddy's with one
//   reason, then reminds Sneha with Remind selected and sees the reminder on Attendance;
// - Sneha presses Not now, and the reminder in the bell on Today still opens the pop-up;
// - a PM sees the list without checkboxes, times or buttons;
// - on a laptop every row keeps its buttons in view, and on a phone they are 44 px to tap.
// Varun's row now waits under Corrections, so HR can't select it. No other spec uses these people.
import { closeDemoData, missingCheckoutDay } from './support/demoData.js';
import {
  PEOPLE,
  cutControls,
  dayShort,
  expect,
  expectTapSize,
  open,
  problemsOf,
  test,
  toasts,
} from './support/fixtures.js';

const MEENA = { email: 'meena@company.com', name: 'Meena Das' };
const VARUN = { email: 'varun@company.com', name: 'Varun Chopra' };
const SNEHA = { email: 'sneha@company.com', name: 'Sneha Patil' };
const FIXED = ['Arjun Nair', 'Kavya Reddy'];
const VARUN_REASON = 'I stayed late for the client call and forgot to check out.';

test.describe.configure({ mode: 'serial' });
test.afterAll(closeDemoData);

/** Today's pop-up for one missing day, which opens by itself after the page has loaded. */
async function popUpOn(page, email) {
  const day = await missingCheckoutDay(email);
  await open(page, '/today');
  const dialog = page.getByRole('dialog', { name: `You didn't check out on ${dayShort(day)}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('What time did you leave?')).toBeVisible();
  return { day, dialog, time: dialog.getByLabel('Time you left') };
}

test('an employee keeps the suggested time in the pop-up and saves it', async ({ signInAs }) => {
  const meena = await signInAs(MEENA);
  const { day, dialog, time } = await popUpOn(meena, MEENA.email);
  await expect(time).toHaveValue('18:30');
  await expect(time).toBeFocused();
  await expect(dialog.getByText('Daybook last saw you working at 6:30 PM.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(toasts(meena)).toContainText('Check-out saved');
  await expect(toasts(meena)).toContainText(`${dayShort(day)}, 6:30 PM.`);
  await expect(dialog).toBeHidden();
  await expect(meena.getByText(`You didn't check out on ${dayShort(day)}.`)).toHaveCount(0);
  expect(problemsOf(meena), 'console and page errors').toEqual([]);
});

test('a later time goes to HR with a reason', async ({ signInAs }) => {
  const varun = await signInAs(VARUN);
  const { day, dialog, time } = await popUpOn(varun, VARUN.email);
  await time.fill('21:00');
  await expect(dialog.getByRole('status').filter({ hasText: 'HR checks' })).toHaveText(
    'After 6:45 PM, HR checks the time first.',
  );
  await dialog.getByRole('button', { name: 'Send to HR' }).click();
  await expect(dialog.getByText('Add a reason for HR.')).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Reason for HR' }).fill(VARUN_REASON);
  await dialog.getByRole('button', { name: 'Send to HR' }).click();
  await expect(toasts(varun)).toContainText('Sent to HR');
  await expect(toasts(varun)).toContainText(`HR will check your check-out for ${dayShort(day)}.`);
  await expect(dialog).toBeHidden();
  await expect(
    varun.getByText(`Waiting for HR: Check-out time on ${dayShort(day)}.`),
  ).toBeVisible();
});

test('HR fixes two check-outs at once and reminds a third person', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);
  const table = neha.getByRole('table', { name: 'Still to fix' });
  const row = (name) => table.getByRole('row').filter({ hasText: name });

  await test.step('the "Missing check-out" number opens the full list', async () => {
    await open(neha, '/attendance');
    await neha.getByRole('link', { name: /^Missing check-out/ }).click();
    await expect(neha).toHaveURL(/\/attendance\/missing$/);
    await expect(neha.getByRole('heading', { level: 1 })).toHaveText('Missing check-outs');
    await expect(row(VARUN.name)).toContainText('Asked HR for 9:00 PM');
    await expect(row(VARUN.name)).toContainText('Handle it under Corrections');
    await expect(row(MEENA.name)).toHaveCount(0);
  });

  await test.step('select all, leave one out, fix the two with one reason', async () => {
    // The bulk bar takes the checkbox's place as soon as it is ticked, so a click, not check().
    await neha.getByRole('checkbox', { name: 'Select all on this page' }).click();
    await expect(neha.getByText('3 selected')).toBeVisible();
    await row(SNEHA.name).getByRole('checkbox').uncheck();
    await expect(neha.getByText('2 selected')).toBeVisible();
    for (const name of FIXED) {
      await expect(row(name).getByLabel(/^Check-out for /)).toHaveValue('18:30');
    }
    await neha.getByRole('button', { name: 'Fix selected' }).click();
    const dialog = neha.getByRole('dialog', { name: 'Fix 2 check-outs' });
    for (const name of FIXED) await expect(dialog).toContainText(`${name}, `);
    await expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue(
      "Used Daybook's suggested time.",
    );
    await dialog.getByRole('button', { name: 'Fix 2 check-outs' }).click();
    await expect(toasts(neha)).toContainText('Fixed 2 check-outs');
    await expect(dialog).toBeHidden();
    for (const name of FIXED) await expect(row(name)).toHaveCount(0);
  });

  await test.step('remind the third with Remind selected', async () => {
    await row(SNEHA.name).getByRole('checkbox').check();
    await expect(neha.getByText('1 selected')).toBeVisible();
    await neha.getByRole('button', { name: 'Remind selected' }).click();
    await expect(toasts(neha)).toContainText('Reminder sent');
    await expect(toasts(neha)).toContainText(`Sent to ${SNEHA.name}.`);
    await expect(row(SNEHA.name)).toContainText(/\d{1,2}:\d{2} by Neha/);
  });

  await test.step('Attendance shows who was reminded', async () => {
    const day = await missingCheckoutDay(SNEHA.email);
    await open(neha, '/attendance');
    const line = neha
      .getByRole('listitem')
      .filter({ hasText: `${SNEHA.name}, ${dayShort(day).replace(',', '')}` });
    await expect(line).toContainText(/Reminded \d{1,2}:\d{2} by Neha/);
  });
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});

test('after Not now, the reminder in the bell on Today opens the pop-up', async ({ signInAs }) => {
  const sneha = await signInAs(SNEHA);
  const { day, dialog } = await popUpOn(sneha, SNEHA.email);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();

  // Hidden for today: a new page load doesn't open it, the line under the check-in stays.
  await open(sneha, '/today');
  await expect(sneha.getByText(`You didn't check out on ${dayShort(day)}.`)).toBeVisible();
  await sneha.getByRole('button', { name: /^Notifications/ }).click();
  // The bell follows the link on the same page, without loading it again.
  await sneha
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('link', { name: new RegExp(`^${PEOPLE.neha.name} asked for your check-out time`) })
    .first()
    .click();
  await expect(dialog).toBeVisible();
  await expect(sneha).toHaveURL(/\/today$/);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  expect(problemsOf(sneha), 'console and page errors').toEqual([]);
});

test('a PM sees the list without anything to change', async ({ signInAs }) => {
  const pm = await signInAs(PEOPLE.pm);
  await open(pm, '/attendance/missing');
  const table = pm.getByRole('table', { name: 'Still to fix' });
  await expect(table.getByRole('row').filter({ hasText: SNEHA.name })).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Person', 'Day', 'Check-in']);
  await expect(pm.getByRole('checkbox')).toHaveCount(0);
  await expect(table.locator('input')).toHaveCount(0);
  await expect(table.getByRole('button')).toHaveCount(0);
  await expect(pm.getByText(/^Suggested times come from/)).toHaveCount(0);
  expect(problemsOf(pm), 'console and page errors').toEqual([]);
});

test('every row keeps its buttons in view on a laptop, 44 px to tap on a phone', async ({
  signInAs,
}) => {
  const neha = await signInAs(PEOPLE.neha);
  const table = neha.getByRole('table', { name: 'Still to fix' });
  const row = table.getByRole('row').filter({ hasText: SNEHA.name });

  for (const width of [1024, 1280, 1440]) {
    await neha.setViewportSize({ width, height: 900 });
    await open(neha, '/attendance/missing');
    await expect(row.getByRole('button', { name: /^Fix: / })).toBeVisible();
    expect(await cutControls(table), `cut off at ${width} px`).toEqual([]);
  }

  await neha.setViewportSize({ width: 390, height: 844 });
  await open(neha, '/attendance/missing');
  await expectTapSize(row.getByRole('button', { name: /^Fix: / }), 'Fix');
  await expectTapSize(row.getByRole('button', { name: /^Remind / }), 'Remind');
  await row.getByRole('checkbox').check();
  const clear = neha.getByRole('button', { name: 'Clear', exact: true });
  await expectTapSize(clear, 'Clear');
  await clear.click();
  await expect(neha.getByText('1 selected')).toHaveCount(0);
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});
