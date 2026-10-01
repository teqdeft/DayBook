// Guide 15.3: edit request approve. Vishal asks to change a locked report, his PM approves it on
// Requests, the report opens again for him and the request shows as handled.
import { closeDemoData, lockedReportDay } from './support/demoData.js';
import { PEOPLE, dayMonthShort, dayShort, expect, open, test, toasts } from './support/fixtures.js';

const REASON = 'Forgot 30 minutes of code review on this day.';

test.afterAll(closeDemoData);

test('a locked report gets an edit request, the PM approves it and it opens again', async ({
  signInAs,
}) => {
  const day = await lockedReportDay(PEOPLE.vishal.email);
  const vishal = await signInAs(PEOPLE.vishal);
  const firstHours = vishal.getByRole('textbox', { name: /^Hours for / }).first();

  await test.step('the employee asks to edit the locked report', async () => {
    await open(vishal, `/report?date=${day}`);
    await expect(
      vishal.getByRole('status').filter({ hasText: 'This report locked at' }),
    ).toBeVisible();
    await expect(firstHours).toHaveAttribute('readonly', '');
    await expect(vishal.getByRole('button', { name: 'Submit report' })).toHaveCount(0);

    await vishal.getByRole('button', { name: 'Request an edit' }).click();
    const dialog = vishal.getByRole('dialog', { name: 'Request an edit' });
    await expect(dialog).toContainText(`Report for ${dayShort(day)}`);
    await dialog.getByRole('textbox', { name: 'What needs to change?' }).fill(REASON);
    await dialog.getByRole('button', { name: 'Send request' }).click();

    await expect(toasts(vishal)).toContainText('Edit request sent');
    await expect(dialog).toBeHidden();
    await expect(vishal.getByRole('button', { name: 'Edit requested' })).toBeDisabled();
    await expect(
      vishal.getByRole('status').filter({ hasText: 'You asked to edit this report today' }),
    ).toBeVisible();
  });

  const pm = await signInAs(PEOPLE.pm);

  await test.step('the PM approves it on Requests', async () => {
    await open(pm, '/requests');
    const card = pm
      .getByRole('article', { name: `Wants to edit the report for ${dayShort(day)}` })
      .filter({ hasText: PEOPLE.vishal.name });
    await expect(card).toContainText(REASON);
    await expect(card).toContainText('Sent today at');
    await card.getByRole('button', { name: 'Approve edit' }).click();

    await expect(toasts(pm)).toContainText('Edit approved');
    await expect(card).toHaveCount(0);
    const handled = pm
      .getByRole('complementary')
      .getByRole('listitem')
      .filter({ hasText: `${PEOPLE.vishal.name}, report for ${dayMonthShort(day)}` });
    await expect(handled).toContainText('Approved');
  });

  await test.step('the report is open again and the employee updates it', async () => {
    await open(vishal, `/report?date=${day}`);
    await expect(
      vishal.getByRole('status').filter({ hasText: 'Your edit request was approved' }),
    ).toBeVisible();
    await expect(firstHours).not.toHaveAttribute('readonly', '');
    const hours = Number(await firstHours.inputValue()) + 0.5;
    await firstHours.fill(String(hours));
    await vishal.getByRole('button', { name: 'Update report' }).click();
    await expect(toasts(vishal)).toContainText('Report updated');

    await open(vishal, `/report?date=${day}`);
    await expect(firstHours).toHaveValue(String(hours));
  });

  await test.step('My log shows the request as approved', async () => {
    await open(vishal, `/log?month=${day.slice(0, 7)}`);
    const request = vishal
      .getByRole('region', { name: 'Edit requests' })
      .getByRole('listitem')
      .filter({ hasText: `Report for ${dayShort(day)}` });
    await expect(request).toContainText(REASON);
    await expect(request).toContainText('Approved');
  });
});
