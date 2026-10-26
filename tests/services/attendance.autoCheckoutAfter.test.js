// Auto check-out (CONTRACT 19), around the check: the office-end reminder (once per date, people
// still checked in, the setting), and an 'auto' row afterwards — it counts like a check-out
// (present and worked time, Excel says "Auto"), the midnight job leaves it alone, and a check-out
// correction or an HR edit makes it 'corrected'.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { checkoutReminderJob } from '@/worker/jobs/checkoutReminder';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { checkIn } from './dashboardKit.js';
import { addSegment, at, setClock, TODAY, YESTERDAY } from './timersKit.js';

const TOMORROW = '2026-10-01';
let hr;

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
});

beforeEach(async () => {
  forgetHandledKeysForTests();
  for (const table of ['jobRuns', 'notifications', 'activitySegments', 'attendanceCorrections']) {
    await db(table).del();
  }
  await db('attendance').del();
  await setSettings({
    auto_checkout_enabled: true,
    auto_checkout_at: '20:00',
    office_end: '18:30',
    auto_mark_missing_checkout: true,
  });
});

/** A new employee checked in today at `inAt` (local clock). */
async function person(name, inAt = '09:30', overrides = {}) {
  const user = await createUser({ name, ...overrides });
  await checkIn(user, TODAY, { in: inAt });
  return user;
}

/** A new employee checked out automatically today at 18:30 (no screen time) by the real job. */
async function autoCheckedOut(name) {
  const user = await person(name);
  setClock('20:00');
  expect(await attendance.autoCheckOut(TODAY)).toMatchObject({ checkedOut: 1 });
  return user;
}

const rowOf = (user, date = TODAY) =>
  db('attendance').where({ userId: user.id, workDate: date }).first();
const notesOf = (type) => db('notifications').where({ type }).orderBy('id');

describe('the reminder at office end', () => {
  it('tells everyone still checked in today, once per date', async () => {
    const open = await person('Olga Open');
    const evening = await person('Eve Evening', '18:00');
    const done = await createUser({ name: 'Dan Done' });
    await checkIn(done, TODAY, { in: '09:30', out: '17:00' });
    const gone = await person('Gail Gone', '09:30', { status: 'deactivated' });
    const nightShift = await person('Nia Night', '12:00', { shiftEnd: '21:00' });
    const forgot = await createUser({ name: 'Fay Forgot' });
    await checkIn(forgot, YESTERDAY, { in: '09:30' });

    setClock('18:29');
    expect(await checkoutReminderJob.tick()).toBeNull();
    setClock('18:30');
    expect(await checkoutReminderJob.tick()).toEqual({ status: 'done', result: { reminded: 2 } });
    const notes = await notesOf('attendance.checkout_reminder');
    expect(notes.map((note) => note.userId).sort((a, b) => a - b)).toEqual([open.id, evening.id]);
    expect(notes[0]).toMatchObject({
      title: "You're still checked in",
      body: "Check out if you're done for the day. If you're still working, carry on.",
      link: '/today',
    });
    for (const user of [done, gone, nightShift, forgot, hr]) {
      expect(notes.some((note) => note.userId === user.id)).toBe(false);
    }

    setClock('18:45');
    expect(await checkoutReminderJob.tick()).toEqual({ status: 'skipped' });
    expect(await notesOf('attendance.checkout_reminder')).toHaveLength(2);
  });

  it('is not sent while auto check-out is off, or once the check time has passed', async () => {
    await person('Olive Off');
    await setSettings({ auto_checkout_enabled: false });
    setClock('18:30');
    expect(await checkoutReminderJob.tick()).toBeNull();
    expect(await attendance.sendCheckoutReminders(TODAY)).toEqual({ reminded: 0 });

    await setSettings({ auto_checkout_enabled: true });
    setClock('20:00'); // the worker was down all evening
    expect(await checkoutReminderJob.tick()).toBeNull();
    expect(await notesOf('attendance.checkout_reminder')).toHaveLength(0);
  });
});

describe('an auto check-out afterwards', () => {
  it('counts like a check-out: present and worked time, Excel says Auto', async () => {
    const user = await person('Ida Idle');
    await addSegment(user, 'active', '09:30', '17:45');
    setClock('20:00');
    await attendance.autoCheckOut(TODAY);

    const item = (await attendance.listDay(TODAY)).find((row) => row.user.id === user.id);
    expect(item).toMatchObject({ presentMinutes: 495, workedMinutes: 495, breakMinutes: 0 });
    expect(item.attendance.checkoutStatus).toBe('auto');
    const { sheets } = await attendance.exportDay(TODAY);
    const line = sheets[0].rows.find((row) => row.name === 'Ida Idle');
    expect(line).toMatchObject({ checkOut: '17:45', checkout: 'Auto', presentHours: 8.25 });
  });

  it('is never marked missing by the midnight job', async () => {
    const auto = await autoCheckedOut('Andy Auto');
    const evening = await person('Eve Late', '19:00'); // left for the midnight rule
    setClock('00:05', TOMORROW);
    expect(await attendance.markMissingCheckouts()).toEqual({ marked: 1 });
    expect(await rowOf(auto)).toMatchObject({ checkoutStatus: 'auto', checkOutAt: at('18:30') });
    expect((await rowOf(evening)).checkoutStatus).toBe('missing');
    const missing = await notesOf('attendance.missing_checkout');
    expect(missing.some((note) => note.userId === auto.id)).toBe(false);
  });

  it('becomes corrected after an approved check-out correction', async () => {
    const user = await autoCheckedOut('Cora Correct');
    setClock('20:30');
    const correction = await attendance.requestCorrection({
      user,
      type: 'check_out',
      workDate: TODAY,
      checkOut: '19:45',
      reason: 'I was in a meeting room without my laptop.',
    });
    await attendance.approveCorrection({ actor: hr, id: correction.id });
    expect(await rowOf(user)).toMatchObject({
      checkoutStatus: 'corrected',
      checkOutAt: at('19:45'),
    });
  });

  it('becomes corrected after HR changes its check-out', async () => {
    const user = await autoCheckedOut('Hal Hr');
    setClock('20:30');
    const row = await rowOf(user);
    await attendance.updateRow({
      actor: hr,
      id: row.id,
      checkOut: '19:30',
      reason: 'Confirmed with the PM.',
    });
    expect(await rowOf(user)).toMatchObject({
      checkoutStatus: 'corrected',
      checkOutAt: at('19:30'),
    });
  });
});
