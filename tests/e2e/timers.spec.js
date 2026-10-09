// CONTRACT 15: project timers and breaks on Today. An employee checks in, starts a timer with a
// note and sees it in the sidebar chip, takes a break (the timer pauses) and ends it (the timer
// runs again), stops it, then adds time by hand, edits it and deletes it.
//
// Deepak Joshi is the person: the demo leaves him and Karan Mehta not checked in today, and
// checkin-report.spec.js (which runs first) checks Karan in and out, and there is no second
// check-in on a day. The hand-added time is 00:05-00:20 company time, before anyone's check-in,
// so the spec expects to run after 00:35 (India time).
import { PEOPLE, expect, open, test, toasts } from './support/fixtures.js';

const PROJECT = 'acme-seo';
const NOTE = 'Keyword research for the shop';
const MANUAL_PROJECT = 'urbanfit-seo';
const MANUAL_NOTE = 'Audit call with the client';

/** A running time on the card or the chip: '0:07', '12:03' or '1:24:10'. */
const RUNNING_TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

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
