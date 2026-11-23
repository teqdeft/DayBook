// CONTRACT 25 A and 2 (Daybook 1.10): time removed from a timer is a break, and HR fixes breaks.
// The e2e browser can't run Idle Detection, so the demo data has the Removes already answered
// (db/demo/hrTimers.js): Nikhil Arora removed 45 minutes from his acme-app timer at 11:00 today,
// and on the working day before, Priya Sharma removed 25 minutes of lunch from hers and took a
// break at 10:30 she forgot to end (the timer she started at 11:00 ended it). Nikhil puts his time
// back from Today; HR opens Priya's Present cell on that day, sees the away break, moves the
// forgotten break's end back with a reason and sees who changed it; a PM opens the same list and
// can't change anything. Then HR ends Manish Tiwari's break from the On break filter (the spec puts
// him on one): the refresh takes his row out of the filter, but the list stays open with the
// answer. No other spec uses Nikhil, Priya or Manish.
import { awayBreakDay, closeDemoData, startBreakToday } from './support/demoData.js';
import {
  PEOPLE,
  cellUnder,
  dayShort,
  expect,
  open,
  problemsOf,
  test,
  toasts,
} from './support/fixtures.js';

const NIKHIL = { email: 'nikhil@company.com', name: 'Nikhil Arora' };
const MANISH = { email: 'manish@company.com', name: 'Manish Tiwari' };
const PRIYA = 'Priya Sharma';
const REASON = 'She was back at 10:40 and forgot to end the break.';
const END_REASON = 'He was back after five minutes and forgot to end the break.';

test.describe.configure({ mode: 'serial' });
test.afterAll(closeDemoData);

let priyasDay;

test.beforeAll(async () => {
  priyasDay = await awayBreakDay('priya@company.com');
});

/** The dialog's footer button (the × in its title bar has the same name). */
const closeButton = (dialog) =>
  dialog.getByRole('button', { name: 'Close' }).filter({ hasText: 'Close' });

/** Priya's break list, opened from her Present cell on that day's Attendance. */
async function openPriyasBreaks(page) {
  await open(page, `/attendance?date=${priyasDay}`);
  const table = page.getByRole('table', { name: `Everyone, ${dayShort(priyasDay)}` });
  const row = table.getByRole('row').filter({ hasText: PRIYA });
  await expect(row).toBeVisible();
  const present = await cellUnder(table, row, 'Present');
  await present.getByRole('button', { name: /See breaks$/ }).click();
  const dialog = page.getByRole('dialog', { name: `${PRIYA}'s breaks` });
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  return { dialog, present };
}

test('an employee puts time removed from the timer back on it', async ({ signInAs }) => {
  const nikhil = await signInAs(NIKHIL);
  await open(nikhil, '/today');
  const entries = nikhil
    .getByRole('region', { name: 'Working on' })
    .getByRole('list', { name: "Today's time" });
  const removed = entries
    .getByRole('listitem')
    .filter({ hasText: 'Away, removed from your acme-app timer' });

  await expect(removed).toContainText('11:00–11:45');
  await expect(removed).toContainText('45m');
  await removed.getByRole('button', { name: 'Put back 11:00 to 11:45 AM on your timer' }).click();

  await expect(toasts(nikhil)).toContainText('Time put back');
  await expect(toasts(nikhil)).toContainText('45 min went back on your acme-app timer.');
  await expect(removed).toHaveCount(0);
  // The copy after the Remove starts at 11:00 again: no gap in the timer.
  await expect(entries.getByRole('listitem').filter({ hasText: '11:00–12:30' })).toHaveCount(1);
  await nikhil.waitForLoadState('networkidle');
  expect(problemsOf(nikhil), 'console and page errors').toEqual([]);
});

test('HR sees time removed from a timer and fixes a forgotten break', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);
  const { dialog, present } = await openPriyasBreaks(neha);
  const items = dialog.getByRole('listitem');

  await test.step('the away break and the forgotten one', async () => {
    await expect(dialog).toContainText('Breaks 55m');
    await expect(items.filter({ hasText: 'Away, removed from timer' })).toContainText(
      '1:00–1:25 PM',
    );
    const forgotten = items.filter({ hasText: 'Ended when a timer started' });
    await expect(forgotten).toContainText('10:30–11:00 AM');
    await expect(forgotten).toContainText('30m');
    await expect(
      dialog.getByText(
        'Fix a break someone forgot to end. Your reason is saved with every change.',
      ),
    ).toBeVisible();
  });

  await test.step('a reason is needed, then the new end saves', async () => {
    const forgotten = items.filter({ hasText: '10:30–11:00 AM' });
    await forgotten.getByRole('button', { name: 'Change end' }).click();
    const endsAt = forgotten.getByLabel('Ends at');
    await expect(endsAt).toBeFocused();
    await expect(endsAt).toHaveValue('11:00');
    await endsAt.fill('10:40');
    await forgotten.getByRole('button', { name: 'Save' }).click();
    await expect(forgotten.getByText('Add a reason.')).toBeVisible();

    await forgotten.getByRole('textbox', { name: 'Reason' }).fill(REASON);
    await forgotten.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(neha)).toContainText('Break changed');
    const changed = items.filter({ hasText: '10:30–10:40 AM' });
    await expect(changed).toContainText(`Changed by ${PEOPLE.neha.name}`);
    await expect(changed).toContainText('10m');
    await expect(dialog).toContainText('Breaks 35m');
  });

  await closeButton(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(present).toContainText('Breaks 35m');
  // The save without a reason answered 400 on purpose; the browser logs that response.
  const problems = problemsOf(neha).filter((text) => !text.includes('status of 400'));
  expect(problems, 'console and page errors').toEqual([]);
});

test('a PM opens the break list but changes nothing', async ({ signInAs }) => {
  const pm = await signInAs(PEOPLE.pm);
  const { dialog } = await openPriyasBreaks(pm);
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'Away, removed from timer' }),
  ).toBeVisible();
  for (const name of ['Change end', 'End break', 'Delete']) {
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(dialog.getByText(/^Fix a break someone forgot to end/)).toHaveCount(0);
  await closeButton(dialog).click();
  await expect(dialog).toBeHidden();
  expect(problemsOf(pm), 'console and page errors').toEqual([]);
});

test('HR ends a break from the On break filter and the list stays open', async ({ signInAs }) => {
  const endClock = await startBreakToday(MANISH.email);
  const neha = await signInAs(PEOPLE.neha);
  await open(neha, '/attendance?filter=on_break');
  const table = neha.getByRole('table', { name: 'Everyone today' });
  const row = table.getByRole('row').filter({ hasText: MANISH.name });
  const present = await cellUnder(table, row, 'Present');
  await expect(present).toContainText('On break');
  await present.getByRole('button', { name: /See breaks$/ }).click();
  const dialog = neha.getByRole('dialog', { name: `${MANISH.name}'s breaks` });
  const item = dialog.getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('On break now');

  await item.getByRole('button', { name: 'End break' }).click();
  await item.getByLabel('Ends at').fill(endClock);
  await item.getByRole('textbox', { name: 'Reason' }).fill(END_REASON);
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(toasts(neha)).toContainText('Break changed');

  // The refresh takes Manish out of the filter; his list stays open with the answer.
  await expect(row).toHaveCount(0);
  await expect(neha.getByText('Nobody is on a break')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`Changed by ${PEOPLE.neha.name}`);
  await expect(item).toContainText('5m');
  await expect(item).not.toContainText('On break now');
  await expect(dialog.getByRole('status').filter({ hasText: 'Break changed' })).toBeAttached();
  await expect(dialog.getByText(`${MANISH.name}'s breaks`)).toBeFocused();

  // Closed, focus goes to the card's title: the cell that opened the list is gone.
  await closeButton(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(neha.getByRole('heading', { name: 'Everyone today' })).toBeFocused();
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});
