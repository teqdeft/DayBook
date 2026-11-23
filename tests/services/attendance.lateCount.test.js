// "4th this month" (CONTRACT 25, item 10): effective late days in the payroll month of a date up
// to it, the day itself included; holidays and full-day leave don't count; the count starts again
// on the payroll month's first day (the 26th here); the day list carries it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);

let hr;
let vishal;
let priya;

async function lateOn(user, dates, lateMinutes = 22) {
  for (const date of dates) {
    await db('attendance').insert({
      userId: user.id,
      workDate: date,
      checkInAt: at(date, '09:52'),
      checkOutAt: at(date, '18:30'),
      location: 'office',
      officeVerified: true,
      lateMinutes,
      isWorkingDay: true,
      checkoutStatus: 'checked_out',
      source: 'self',
    });
  }
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    late_alert_days: 4,
  });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  vishal = await createUser({ name: 'Vishal Saini' });
  priya = await createUser({ name: 'Priya Sharma' });
});

beforeEach(async () => {
  setNowForTests('2026-11-30T13:00:00Z');
  await setSettings({ payroll_month_start_day: 1 });
  await db('attendance').delete();
  await db('holidays').delete();
  await db('leaveEntries').delete();
});

afterEach(() => setNowForTests(null));

describe('lateCountsFor', () => {
  it('counts the 4th late day of the month, the day itself included', async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-19']);
    await lateOn(priya, ['2026-11-18']);
    const counts = await attendance.lateCountsFor({
      date: '2026-11-19',
      userIds: [vishal.id, priya.id],
    });
    expect(counts).toEqual({
      [vishal.id]: {
        nth: 4,
        label: '4th this month',
        title: '4th late day in November 2026',
        alert: true,
      },
    });
    const third = await attendance.lateCountsFor({ date: '2026-11-04', userIds: [vishal.id] });
    expect(third[vishal.id]).toMatchObject({ nth: 3, label: '3rd this month', alert: false });
  });

  it('skips a holiday and a full-day leave day', async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-19']);
    await db('holidays').insert({ holidayDate: '2026-11-03', name: 'Diwali' });
    await db('leaveEntries').insert({
      userId: vishal.id,
      fromDate: '2026-11-04',
      toDate: '2026-11-04',
      part: 'full',
    });
    const counts = await attendance.lateCountsFor({ date: '2026-11-19', userIds: [vishal.id] });
    expect(counts[vishal.id]).toMatchObject({ nth: 2, label: '2nd this month', alert: false });
    expect(await attendance.lateCountsFor({ date: '2026-11-03', userIds: [vishal.id] })).toEqual(
      {},
    );
  });

  it('starts again on the 26th with a payroll month from the 26th', async () => {
    await setSettings({ payroll_month_start_day: 26 });
    await lateOn(vishal, ['2026-11-24', '2026-11-25', '2026-11-26']);
    const before = await attendance.lateCountsFor({ date: '2026-11-25', userIds: [vishal.id] });
    expect(before[vishal.id]).toMatchObject({
      nth: 2,
      title: '2nd late day in November 2026 (26 Oct to 25 Nov)',
    });
    const after = await attendance.lateCountsFor({ date: '2026-11-26', userIds: [vishal.id] });
    expect(after[vishal.id]).toMatchObject({
      nth: 1,
      label: '1st this month',
      title: '1st late day in December 2026 (26 Nov to 25 Dec)',
    });
  });

  it('answers nothing without people or a date', async () => {
    expect(await attendance.lateCountsFor({ date: '2026-11-19', userIds: [] })).toEqual({});
    expect(await attendance.lateCountsFor({ date: 'soon', userIds: [vishal.id] })).toEqual({});
  });

  it("gives the day list's late rows their count", async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    const { items } = await attendance.listForDay({ date: '2026-11-05', viewer: hr });
    const row = items.find((item) => item.user.id === vishal.id);
    expect(row.lateCount).toMatchObject({ nth: 4, label: '4th this month', alert: true });
    expect(items.find((item) => item.user.id === priya.id).lateCount).toBeNull();
  });
});
