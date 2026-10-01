// Guide 15.3: HR correction. In the demo data Deepak Joshi forgot to check out on the last working
// day (the midnight job marked it missing) and already asked HR to fix it. HR rejects that
// request (a note is required), Deepak asks again from Today, and HR approves it: the missing
// check-out is gone and the day shows his check-out time.
import { closeDemoData, missingCheckoutDay } from './support/demoData.js';
import { PEOPLE, cellUnder, dayShort, expect, open, test, toasts } from './support/fixtures.js';

const LEFT_AT = '18:40';
const REASON = 'Left at 6:40 PM and forgot to check out in the rush.';

test.describe.configure({ mode: 'serial' });
test.afterAll(closeDemoData);

/** A waiting correction request on Attendance (the cards with Reject / Approve). */
function correctionRequest(page, text) {
  return page
    .getByRole('listitem')
    .filter({ hasText: PEOPLE.deepak.name })
    .filter({ hasText: text })
    .filter({ has: page.getByRole('button', { name: 'Approve' }) });
}

/** Deepak's line in the "Missing check-outs" card. */
function missingCheckout(page, day) {
  const title = `${PEOPLE.deepak.name}, ${dayShort(day).replace(',', '')}`;
  return page.getByRole('listitem').filter({ hasText: title });
}

let day;

test.beforeAll(async () => {
  day = await missingCheckoutDay(PEOPLE.deepak.email);
});

test('HR has to add a note to reject a correction request', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);
  await open(neha, '/attendance');
  await expect(missingCheckout(neha, day)).toBeVisible();

  const request = correctionRequest(neha, `on ${dayShort(day)}`);
  await expect(request).toHaveCount(1);
  await request.getByRole('button', { name: 'Reject' }).click();

  const dialog = neha.getByRole('dialog', { name: 'Reject correction' });
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Add a note for them.');
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole('textbox', { name: 'Note for them' })
    .fill('Please send the exact time you left.');
  await dialog.getByRole('button', { name: 'Reject' }).click();

  await expect(toasts(neha)).toContainText('Correction rejected');
  await expect(dialog).toBeHidden();
  await expect(request).toHaveCount(0);
  // Rejecting changes nothing: the check-out is still missing.
  await expect(missingCheckout(neha, day)).toBeVisible();
});

test('an employee asks HR to fix a forgotten check-out and HR approves it', async ({
  signInAs,
}) => {
  const deepak = await signInAs(PEOPLE.deepak);

  await test.step('the employee asks from Today', async () => {
    await open(deepak, '/today');
    await deepak.getByRole('button', { name: 'Request a correction' }).click();
    const dialog = deepak.getByRole('dialog', { name: 'Request a correction' });
    await dialog
      .getByRole('combobox', { name: 'What needs fixing?' })
      .selectOption({ label: 'I forgot to check out' });
    await dialog.getByLabel('Day', { exact: true }).fill(day);
    await dialog.getByLabel('Left at', { exact: true }).fill(LEFT_AT);
    await dialog.getByRole('textbox', { name: 'Reason' }).fill(REASON);
    await dialog.getByRole('button', { name: 'Send to HR' }).click();

    await expect(toasts(deepak)).toContainText('Sent to HR');
    await expect(dialog).toBeHidden();
    await expect(
      deepak.getByText(`Waiting for HR: Check-out time on ${dayShort(day)}.`),
    ).toBeVisible();
  });

  const neha = await signInAs(PEOPLE.neha);

  await test.step('HR approves it on Attendance', async () => {
    await open(neha, '/attendance');
    const request = correctionRequest(neha, REASON);
    await expect(request).toContainText(`Says they left at 6:40 PM on ${dayShort(day)}.`);
    await request.getByRole('button', { name: 'Approve' }).click();

    await expect(toasts(neha)).toContainText('Correction approved');
    await expect(request).toHaveCount(0);
    await expect(missingCheckout(neha, day)).toHaveCount(0);
  });

  await test.step("the day's table shows the check-out", async () => {
    await open(neha, `/attendance?date=${day}`);
    const table = neha.getByRole('table', { name: `Everyone, ${dayShort(day)}` });
    const row = table.getByRole('row').filter({ hasText: PEOPLE.deepak.name });
    await expect(await cellUnder(table, row, 'Out')).toHaveText('6:40');
  });
});
