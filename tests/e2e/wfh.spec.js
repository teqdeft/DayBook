// CONTRACT 17: working from home needs HR's approval. An employee asks HR from Today ("Working
// from home another day? Ask HR"), a mistake in the days shows under the right field, HR approves
// the request on Attendance and the employee's Today then shows the approved day.
//
// The check-in card's WFH option (approved / "Needs HR's approval" with Ask HR / "Waiting for HR")
// can't be reached here: the demo saves this computer's addresses (127.0.0.1 and ::1) as office
// networks, where the only option is Office, and the people the demo leaves without a check-in
// today (Karan, Deepak) are checked in by the specs that run first. The options are covered by
// tests/unit/wfhOptions.test.js and the server's rule by tests/services/attendance.wfhCheckIn.
// Sahil Khan is the person: no other spec uses him.
import { PEOPLE, dayShort, expect, open, test, toasts } from './support/fixtures.js';

const SAHIL = { email: 'sahil@company.com', name: 'Sahil Khan' };
const REASON = 'Waiting in for the broadband engineer at home.';

/** '2026-10-14', -1 -> '2026-10-13' */
function addDays(date, days) {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

test('an employee asks HR to work from home and HR approves it', async ({ signInAs }) => {
  const sahil = await signInAs(SAHIL);
  let day;

  await test.step('the employee asks from Today', async () => {
    await open(sahil, '/today');
    await sahil.getByRole('button', { name: 'Ask HR', exact: true }).click();
    const dialog = sahil.getByRole('dialog', { name: 'Ask to work from home' });
    const from = dialog.getByLabel('From', { exact: true });
    const to = dialog.getByLabel('To', { exact: true });

    // "Another day" starts on the next working day, and To follows From until it is picked.
    day = await from.inputValue();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(to).toHaveValue(day);
    await from.fill(addDays(day, 1));
    await expect(to).toHaveValue(addDays(day, 1));
    await from.fill(day);
    await expect(to).toHaveValue(day);

    // A last day before the first: the server's message shows under To.
    await to.fill(addDays(day, -1));
    await dialog.getByRole('textbox', { name: 'Reason' }).fill(REASON);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      "The last day can't be before the first day.",
    );
    await expect(to).toHaveAttribute('aria-invalid', 'true');
    await expect(from).not.toHaveAttribute('aria-invalid', 'true');

    await to.fill(day);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(toasts(sahil)).toContainText('Request sent to HR');
    await expect(dialog).toBeHidden();
    await expect(
      sahil.getByText(`Waiting for HR: Working from home on ${dayShort(day)}.`),
    ).toBeVisible();
  });

  const neha = await signInAs(PEOPLE.neha);

  await test.step('HR approves it on Attendance', async () => {
    await open(neha, '/attendance');
    const card = neha.getByRole('region', { name: 'Work from home requests' });
    const request = card
      .getByRole('listitem')
      .filter({ hasText: SAHIL.name })
      .filter({ hasText: REASON });
    await expect(request).toContainText(dayShort(day));
    await request.getByRole('button', { name: 'Approve' }).click();

    await expect(toasts(neha)).toContainText('Working from home approved');
    await expect(request).toHaveCount(0);
    const handled = card
      .getByRole('listitem')
      .filter({ hasText: SAHIL.name })
      .filter({ hasText: dayShort(day) });
    await expect(handled).toContainText('Approved');
  });

  await test.step("the employee's Today shows the approved day", async () => {
    await open(sahil, '/today');
    await expect(sahil.getByText(`Working from home approved for ${dayShort(day)}.`)).toBeVisible();
    await expect(sahil.getByText(/^Waiting for HR: Working from home/)).toHaveCount(0);
  });
});
