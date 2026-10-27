// CONTRACT 15: project timers and breaks on Today. An employee checks in, starts a timer with a
// note and sees it in the sidebar chip, takes a break (the timer pauses) and ends it (the timer
// runs again), stops it, then adds time by hand, edits it and deletes it.
//
// Deepak Joshi is the person: the demo leaves him and Karan Mehta not checked in today, and
// checkin-report.spec.js (which runs first) checks Karan in and out, and there is no second
// check-in on a day. The hand-added time is 00:05-00:20 company time, before anyone's check-in,
// so the spec expects to run after 00:35 (India time).
//
// The second test is CONTRACT 21 "Timer lines remember their note" (the owner's report showed
// "Deploying new features" twice and "Deploting new features" once): a line written by "Fill
// report from timers" and then reworded still stands for its timer note, so the next Fill doesn't
// add the note again. The line is reworded by hand here; Polish with AI's Use changes it the same
// way, and the e2e server has no Gemini key. Rohit Verma is that person: the demo leaves him
// checked in today with no report yet, and no other spec uses him. His time is 00:10-00:30.
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';

const PROJECT = 'acme-seo';
const NOTE = 'Keyword research for the shop';
const MANUAL_PROJECT = 'urbanfit-seo';
const MANUAL_NOTE = 'Audit call with the client';

const ROHIT = { email: 'rohit@company.com', name: 'Rohit Verma' };
const FILL_PROJECT = 'internal-tool';
const TYPO_NOTE = 'Deploting new features';
const FIXED_TITLE = 'Deploying new features';

/** A running time on the card or the chip: '0:07', '12:03' or '1:24:10'. */
const RUNNING_TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * The task lines' text on a report card, top to bottom (a line linked to a priority task has
 * ", linked to the ..." after its name).
 * @param {import('@playwright/test').Locator} card
 * @param {string} project
 * @returns {Promise<string[]>}
 */
function taskTitles(card, project) {
  return card
    .getByLabel(new RegExp(`^Task \\d+ for ${project}`))
    .evaluateAll((inputs) => inputs.map((input) => input.value));
}

/**
 * Runs a change on a draft report and waits until its autosave answered and the top bar says
 * "Saved".
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} change
 */
async function saveReport(page, change) {
  const saved = page.waitForResponse(
    (response) =>
      /^\/api\/reports\/\d+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'PUT',
  );
  await change();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

test('an employee times their work, takes a break and fixes their times by hand', async ({
  signInAs,
}) => {
  const deepak = await signInAs(PEOPLE.deepak);
  const card = deepak.getByRole('region', { name: 'Working on' });
  const entries = card.getByRole('list', { name: "Today's time" });
  const chip = deepak.getByRole('group', { name: 'Your timer' });

  await test.step('check in', async () => {
    await open(deepak, '/today');
    const day = deepak.getByRole('region', { name: 'Your day' });
    await day.getByRole('button', { name: 'Check in' }).click();
    await expect(toasts(deepak)).toContainText(/Checked in/);
    await expect(deepak.getByRole('button', { name: 'Start break' })).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card.getByText('No time tracked yet today.')).toBeVisible();
    await expect(chip).toHaveCount(0);
  });

  await test.step('start a timer with a note', async () => {
    await card.getByRole('button', { name: /^Project/ }).click();
    const picker = deepak.getByRole('dialog', { name: 'Pick a project to time' });
    await expect(picker.getByRole('button', { name: 'Request a project' })).toHaveCount(0);
    await picker.getByRole('combobox', { name: 'Find a project' }).fill(PROJECT);
    await picker.getByRole('option', { name: PROJECT, exact: true }).click();
    await card.getByRole('textbox', { name: 'What are you working on?' }).fill(NOTE);
    await card.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(card.getByRole('button', { name: 'Stop' })).toBeFocused();
    await expect(card.getByRole('button', { name: 'Switch project' })).toBeVisible();
    await expect(card.getByRole('timer')).toHaveText(RUNNING_TIME);
    await expect(card.getByText(NOTE).first()).toBeVisible();
    await expect(entries.getByRole('listitem')).toHaveCount(1);
    await expect(entries.getByRole('listitem')).toContainText(/–now/);
  });

  await test.step('the sidebar chip shows the running timer', async () => {
    await expect(chip.getByRole('link', { name: PROJECT })).toHaveAttribute('href', '/today');
    await expect(chip.getByRole('timer')).toHaveText(RUNNING_TIME);
    await expect(chip.getByRole('button', { name: `Stop the ${PROJECT} timer` })).toBeVisible();
  });

  await test.step('a break pauses the timer', async () => {
    await deepak.getByRole('button', { name: 'Start break' }).click();
    await expect(toasts(deepak)).toContainText('Break started');
    await expect(deepak.getByText(/^On break since \d{1,2}:\d{2}$/)).toBeVisible();
    await expect(deepak.getByRole('button', { name: 'End break' })).toBeVisible();
    // exact: the card's screen-reader announcement says the same with a full stop
    await expect(card.getByText('Timer paused for your break', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    const breakChip = deepak.getByRole('group', { name: 'Your break' });
    await expect(breakChip.getByRole('link', { name: 'On break' })).toBeVisible();
    await expect(breakChip.getByRole('button')).toHaveCount(0);
    await expect(deepak.getByText(/^Worked so far · \d+m break$/)).toBeVisible();
  });

  await test.step('ending the break starts the timer again', async () => {
    await deepak.getByRole('button', { name: 'End break' }).click();
    await expect(toasts(deepak)).toContainText(/Break ended · \d+m/);
    await expect(deepak.getByText(/^In office since \d{1,2}:\d{2}$/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(card.getByRole('timer')).toHaveText(RUNNING_TIME);
    // The paused stretch and the new one with the same project and note.
    await expect(entries.getByRole('listitem')).toHaveCount(2);
    await expect(entries.getByRole('listitem').filter({ hasText: NOTE })).toHaveCount(2);
    await expect(chip.getByRole('link', { name: PROJECT })).toBeVisible();
  });

  await test.step('stop the timer', async () => {
    await card.getByRole('button', { name: 'Stop' }).click();
    await expect(card.getByRole('button', { name: /^Project/ })).toBeFocused();
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await expect(entries.getByRole('listitem')).toHaveCount(2);
    await expect(entries).not.toContainText('–now');
    await expect(chip).toHaveCount(0);
    await expect(card.getByText(/^Tracked today \d+m$/)).toBeVisible();
  });

  const manualRow = (range) =>
    entries.getByRole('listitem').filter({ hasText: MANUAL_PROJECT }).filter({ hasText: range });

  await test.step('add time by hand', async () => {
    await card.getByRole('button', { name: 'Add time' }).click();
    const dialog = deepak.getByRole('dialog', { name: 'Add time' });
    await dialog.getByLabel('Project', { exact: true }).selectOption({ label: MANUAL_PROJECT });
    await dialog.getByRole('textbox', { name: 'Note' }).fill(MANUAL_NOTE);
    await dialog.getByLabel('From', { exact: true }).fill('00:05');
    await dialog.getByLabel('To', { exact: true }).fill('00:20');
    await dialog.getByRole('button', { name: 'Add time' }).click();

    await expect(toasts(deepak)).toContainText('Time added');
    await expect(dialog).toBeHidden();
    await expect(manualRow('12:05–12:20')).toContainText(MANUAL_NOTE);
    await expect(manualRow('12:05–12:20')).toContainText('15m');
    await expect(entries.getByRole('listitem')).toHaveCount(3);
  });

  await test.step('a clash shows under the field, then the edit saves', async () => {
    await card.getByRole('button', { name: `Change ${MANUAL_PROJECT} 12:05–12:20` }).click();
    await deepak.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = deepak.getByRole('dialog', { name: 'Edit time' });
    await expect(dialog.getByLabel('From', { exact: true })).toHaveValue('00:05');

    await dialog.getByLabel('To', { exact: true }).fill('23:59');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText("End can't be later than now.")).toBeVisible();
    await expect(dialog.getByLabel('To', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await dialog.getByLabel('To', { exact: true }).fill('00:35');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(deepak)).toContainText('Time updated');
    await expect(dialog).toBeHidden();
    await expect(manualRow('12:05–12:35')).toContainText('30m');
  });

  await test.step('delete it', async () => {
    await card.getByRole('button', { name: `Change ${MANUAL_PROJECT} 12:05–12:35` }).click();
    await deepak.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = deepak.getByRole('dialog', { name: 'Delete this time?' });
    await expect(confirm).toContainText(`${MANUAL_PROJECT}, 12:05–12:35 (30m).`);
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect(toasts(deepak)).toContainText('Time deleted');
    await expect(confirm).toBeHidden();
    await expect(entries.getByRole('listitem')).toHaveCount(2);
    await expect(entries).not.toContainText(MANUAL_PROJECT);
    await expect(card.getByRole('button', { name: 'Add time' })).toBeFocused();
  });
});

test('a timer line reworded after Fill report from timers is not added again', async ({
  signInAs,
}) => {
  const rohit = await signInAs(ROHIT);
  const card = rohit.getByRole('region', { name: FILL_PROJECT, exact: true });
  const fill = rohit.getByRole('button', { name: 'Fill report from timers' });
  const noteLines = async () =>
    (await taskTitles(card, FILL_PROJECT)).filter((title) => /new features/i.test(title));

  await test.step('time with a typo in its note', async () => {
    await open(rohit, '/today');
    await rohit
      .getByRole('region', { name: 'Working on' })
      .getByRole('button', { name: 'Add time' })
      .click();
    const dialog = rohit.getByRole('dialog', { name: 'Add time' });
    await dialog.getByLabel('Project', { exact: true }).selectOption({ label: FILL_PROJECT });
    await dialog.getByRole('textbox', { name: 'Note' }).fill(TYPO_NOTE);
    await dialog.getByLabel('From', { exact: true }).fill('00:10');
    await dialog.getByLabel('To', { exact: true }).fill('00:30');
    await dialog.getByRole('button', { name: 'Add time' }).click();
    await expect(toasts(rohit)).toContainText('Time added');
    await expect(dialog).toBeHidden();
  });

  await test.step('Fill writes the note as a task line', async () => {
    await open(rohit, '/report');
    await expect(rohit.getByRole('region', { name: 'From your timers' })).toContainText(TYPO_NOTE);
    await saveReport(rohit, () => fill.click());
    await expect(toasts(rohit)).toContainText('Report filled from your timers');
    await expect(card.getByRole('textbox', { name: `Hours for ${FILL_PROJECT}` })).toHaveValue(
      '20m',
    );
    await expect.poll(noteLines).toEqual([TYPO_NOTE]);
  });

  await test.step('the typo is fixed by hand and saved', async () => {
    const line = (await taskTitles(card, FILL_PROJECT)).indexOf(TYPO_NOTE) + 1;
    const title = card.getByLabel(`Task ${line} for ${FILL_PROJECT}`, { exact: true });
    await saveReport(rohit, () => title.fill(FIXED_TITLE));
    await expect.poll(noteLines).toEqual([FIXED_TITLE]);
  });

  await test.step('after a reload, Fill adds nothing', async () => {
    await open(rohit, '/report');
    await expect.poll(noteLines).toEqual([FIXED_TITLE]);
    await fill.click();
    await expect(toasts(rohit)).toContainText('Your report already matches your timers');
    // One line for the timer note, as reworded: no second "Deploying" line, no "Deploting" one.
    await expect.poll(noteLines).toEqual([FIXED_TITLE]);
  });

  await rohit.waitForLoadState('networkidle');
  expect(problemsOf(rohit), 'console and page errors').toEqual([]);
});
