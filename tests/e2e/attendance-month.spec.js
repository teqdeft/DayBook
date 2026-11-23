// CONTRACT 25 items 4, 8 and 10 (Daybook 1.10): the month view for HR. HR switches Attendance to
// Month and finds Ankit Rana, late for the 4th time this payroll month today (db/demo/hrTools.js),
// with "Needs a look" and its reason; filters Late and opens Vishal Saini's month: each day, the
// check-out he entered himself long after Daybook last saw him working, and Neha's change of place
// with its reason; then downloads his month as Excel. A PM has no Month switch and no access to
// the month. On a laptop (1024 to 1440 px) both keep every column in view.
//
// This spec runs first, so the late marks are the demo's own (holidays-leave.spec.js works them
// out again for today later).
import { closeDemoData, userIdByEmail } from './support/demoData.js';
import {
  PEOPLE,
  cellUnder,
  cutControls,
  expect,
  open,
  problemsOf,
  test,
} from './support/fixtures.js';

const ANKIT = 'Ankit Rana';

test.afterAll(closeDemoData);
const HR_REASON = 'Picked working from home by mistake. He was in the office all day.';

test('HR reads the month, one person’s month and downloads it', async ({ signInAs }) => {
  const neha = await signInAs(PEOPLE.neha);
  const table = neha.getByRole('table', { name: /^Everyone, / });
  const row = (name) =>
    table.getByRole('row').filter({ has: neha.getByRole('link', { name, exact: true }) });

  await test.step('Attendance switches to Month', async () => {
    await open(neha, '/attendance');
    const view = neha.getByRole('group', { name: 'View' });
    await expect(view.getByRole('link', { name: 'Day' })).toHaveAttribute('aria-current', 'page');
    await view.getByRole('link', { name: 'Month' }).click();
    await expect(neha).toHaveURL(/\/attendance\/month$/);
    await expect(neha.getByRole('heading', { level: 1 })).toHaveText('Attendance');
    await expect(view.getByRole('link', { name: 'Month' })).toHaveAttribute('aria-current', 'page');
  });

  await test.step('a person who needs a look, with the reason', async () => {
    const ankit = row(ANKIT);
    await expect(await cellUnder(table, ankit, 'Late')).toContainText(/^4/);
    await expect(ankit).toContainText('Needs a look');
    await expect(ankit).toContainText('4 late days');
    await neha.getByRole('link', { name: /^Needs a look \(\d+\)$/ }).click();
    await expect(neha).toHaveURL(/filter=needs_look/);
    await expect(row(ANKIT)).toBeVisible();
  });

  await test.step('the Late filter, then Vishal’s month', async () => {
    await neha.getByRole('link', { name: /^Late \(\d+\)$/ }).click();
    await expect(neha).toHaveURL(/filter=late/);
    await expect(row(ANKIT)).toBeVisible();
    await row(PEOPLE.vishal.name).getByRole('link', { name: PEOPLE.vishal.name }).click();
    await expect(neha).toHaveURL(/\/attendance\/people\/\d+\?month=\d{4}-\d{2}$/);
    await expect(neha.getByRole('heading', { level: 1 })).toHaveText(PEOPLE.vishal.name);
  });

  await test.step('each day, and the changes with their reasons', async () => {
    const days = neha.getByRole('table', { name: 'Each day' });
    await expect(days.getByRole('row').filter({ hasText: 'By Vishal' })).toContainText('Check');
    await expect(days.getByRole('row').filter({ hasText: 'Today' })).toHaveCount(1);
    const changes = neha.getByRole('listitem').filter({ hasText: `Reason: ${HR_REASON}` });
    await expect(changes).toContainText(new RegExp(`${PEOPLE.neha.name} changed \\w{3}, \\d`));
    await expect(changes).toContainText('Place WFH to Office');
    await expect(
      neha.getByRole('listitem').filter({ hasText: 'Vishal Saini entered the check-out for' }),
    ).toContainText('Daybook last saw them at 1:05 PM');
  });

  await test.step('the month downloads as Excel', async () => {
    const month = new URL(neha.url()).searchParams.get('month');
    const [download] = await Promise.all([
      neha.waitForEvent('download'),
      neha.getByRole('link', { name: 'Download Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`attendance-${month}-vishal-saini.xlsx`);
    expect(await download.failure()).toBeNull();
  });
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});

test('a PM has no month view', async ({ signInAs }) => {
  const pm = await signInAs(PEOPLE.pm);
  await open(pm, '/attendance');
  await expect(pm.getByRole('heading', { level: 1 })).toHaveText('Attendance');
  await expect(pm.getByRole('group', { name: 'View' })).toHaveCount(0);
  await expect(pm.getByRole('link', { name: 'Month', exact: true })).toHaveCount(0);

  await open(pm, '/attendance/month');
  await expect(pm).toHaveURL(/\/no-access$/);
  await expect(pm.getByRole('heading', { level: 1 })).toHaveText('No access');
});

test('on a laptop the month and one person’s month keep every column in view', async ({
  signInAs,
}) => {
  const neha = await signInAs(PEOPLE.neha);
  const vishal = await userIdByEmail(PEOPLE.vishal.email);
  const days = neha.getByRole('table', { name: 'Each day' });
  const month = neha.getByRole('table', { name: /^Everyone, / });
  for (const width of [1024, 1280, 1366, 1440]) {
    await neha.setViewportSize({ width, height: 900 });
    await open(neha, `/attendance/people/${vishal}`);
    await expect(days.getByRole('button', { name: /^(Edit|Fix|Add): / }).first()).toBeVisible();
    expect(await cutControls(days), `Each day at ${width} px`).toEqual([]);
    await open(neha, '/attendance/month');
    await expect(month).toBeVisible();
    expect(await cutControls(month), `the month at ${width} px`).toEqual([]);
  }
  expect(problemsOf(neha), 'console and page errors').toEqual([]);
});
