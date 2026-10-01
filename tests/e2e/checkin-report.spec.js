// Guide 15.3: check in, write and submit a report, the PM sees it. Karan Mehta has not checked in
// today in the demo data. The demo saves this computer's addresses (127.0.0.1 and ::1) as office
// networks, so the check-in is an Office one.
import { PEOPLE, cellUnder, expect, open, test, toasts } from './support/fixtures.js';

const PROJECT = 'acme-app';
const TASK = 'Booking screen tests';

test('an employee checks in, submits the daily report and the PM sees it', async ({
  signInAs,
  baseURL,
}) => {
  const karan = await signInAs(PEOPLE.karan);

  await test.step('check in from Today', async () => {
    await open(karan, '/today');
    const day = karan.getByRole('region', { name: 'Your day' });
    await expect(day.getByRole('heading', { name: 'Check in' })).toBeVisible();
    await expect(day.getByText('On the office network')).toBeVisible();
    await expect(day.getByRole('radio', { name: /^Office/ })).toBeChecked();
    await expect(day.getByRole('radio', { name: /^Working from home/ })).toBeDisabled();
    await day.getByLabel('Note for your PM (optional)').fill('Dentist in the morning');
    await day.getByRole('button', { name: 'Check in' }).click();

    await expect(toasts(karan)).toContainText(/Checked in at the office at \d{1,2}:\d{2} [AP]M/);
    await expect(day.getByRole('heading', { name: 'Your day' })).toBeVisible();
    await expect(day.getByRole('heading', { name: 'Check in' })).toHaveCount(0);
    await expect(karan.getByText(/^In office since \d{1,2}:\d{2}$/)).toBeVisible();
    await expect(karan.getByRole('button', { name: 'Check out' })).toBeVisible();
  });

  await test.step('write and submit the daily report', async () => {
    await karan.getByRole('link', { name: "Write today's report" }).click();
    await expect(karan).toHaveURL(/\/report$/);
    await expect(karan.getByRole('heading', { level: 1 })).toHaveText('Daily report');

    await karan.getByRole('button', { name: 'Add a project' }).click();
    const picker = karan.getByRole('dialog', { name: 'Pick a project' });
    await picker.getByRole('combobox', { name: 'Find a project' }).fill(PROJECT);
    await picker.getByRole('option', { name: PROJECT, exact: true }).click();

    const card = karan.getByRole('region', { name: PROJECT });
    await card.getByRole('textbox', { name: `Hours for ${PROJECT}` }).fill('6.5');
    await card.getByRole('textbox', { name: `Task 1 for ${PROJECT}` }).fill(TASK);
    await card
      .getByRole('combobox', { name: `Status of task 1 for ${PROJECT}` })
      .selectOption({ label: 'In progress' });
    await expect(karan.getByText('6.5h logged')).toBeVisible();

    await karan.getByRole('button', { name: 'Submit report' }).click();
    await expect(toasts(karan)).toContainText('Report submitted');
    await expect(karan.getByRole('button', { name: 'Update report' })).toBeVisible();
    const preview = karan.getByRole('region', { name: 'Slack preview' });
    await expect(preview).toContainText(`Project: ${PROJECT}`);
    await expect(preview).toContainText(`${TASK} (In Progress)`);
  });

  await test.step('Today shows the report as submitted', async () => {
    await open(karan, '/today');
    await expect(karan.getByRole('heading', { name: 'Your report is in' })).toBeVisible();
    await expect(karan.getByText('Report submitted', { exact: true })).toBeVisible();
  });

  const pm = await signInAs(PEOPLE.pm);

  await test.step('the PM sees the report on the team board', async () => {
    await open(pm, '/team');
    const board = pm.getByRole('table', { name: 'Team board' });
    const inOffice = board
      .getByRole('rowgroup')
      .filter({ has: pm.getByRole('button', { name: /^In office/ }) });
    const row = inOffice
      .getByRole('row')
      .filter({ has: pm.getByRole('link', { name: PEOPLE.karan.name, exact: true }) });
    // The group shows its first few people; the rest are behind "Show N more".
    const more = inOffice.getByRole('button', { name: /^Show \d+ more$/ });
    if ((await row.count()) === 0 && (await more.count()) > 0) await more.click();

    await expect(row).toBeVisible();
    await expect(await cellUnder(board, row, 'Report')).toHaveText('Submitted');
    await expect(await cellUnder(board, row, 'Logged')).toHaveText('6h 30m');
    await expect(await cellUnder(board, row, 'Projects today')).toHaveText(PROJECT);
  });

  await test.step('the PM has no Today or Daily report (company rule)', async () => {
    for (const path of ['/today', '/report']) {
      await open(pm, path);
      await expect(pm).toHaveURL(/\/no-access$/);
      await expect(pm.getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(pm.getByText("You don't have access to this page")).toBeVisible();
    }
    const checkIn = await pm.request.post('/api/attendance/check-in', {
      data: { location: 'office' },
      headers: { Origin: new URL(baseURL).origin },
    });
    expect(checkIn.status()).toBe(403);
  });
});
