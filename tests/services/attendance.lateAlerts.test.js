// The late alert to HR (CONTRACT 25, item 10): once per person per payroll month at
// late_alert_days, to HR (the other Admins about an Admin), never to the person; a failing person
// never stops the others; the first working day of a period checks the period before; nothing on
// a holiday; first-half leave is late only after the split mark; the worker job's gate.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { lateAlertsJob } from '@/worker/jobs/lateAlerts';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const failing = vi.hoisted(() => ({ test: null }));

vi.mock('@/modules/notifications', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    notifications: {
      ...actual.notifications,
      async notify(input, trx) {
        if (failing.test?.(input)) throw new Error('The bell is down');
        return actual.notifications.notify(input, trx);
      },
    },
  };
});

const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);
const TODAY = '2026-11-19'; // a Thursday
const EVENING = '2026-11-19T13:00:00Z'; // 6:30 PM in India

let neha;
let ravi;
let asha;
let vishal;
let priya;

async function lateOn(user, dates, lateMinutes = 15) {
  for (const date of dates) {
    await db('attendance').insert({
      userId: user.id,
      workDate: date,
      checkInAt: at(date, '09:45'),
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

const alertsTo = (user) =>
  db('notifications').where({ userId: user.id, type: 'attendance.late_alert' }).orderBy('id');

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 1,
    late_alert_days: 4,
    wfh_requires_approval: false,
  });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  ravi = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  asha = await createUser({ name: 'Asha Rao', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini' });
  priya = await createUser({ name: 'Priya Sharma' });
});

beforeEach(async () => {
  setNowForTests(EVENING);
  failing.test = null;
  // Migration 018 claims the deploy day's late-alerts runs.
  await db('job_runs').where({ job: 'late-alerts' }).delete();
  forgetHandledKeysForTests();
  await db('attendanceAlerts').delete();
  await db('notifications').delete();
  await db('attendance').delete();
  await db('holidays').delete();
  await db('leaveEntries').delete();
});

afterEach(() => setNowForTests(null));

describe('sendLateAlerts', () => {
  it('tells HR once at the 4th late day, never the person, and again next month', async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 0 });
    await lateOn(vishal, ['2026-11-05']);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
    const [bell] = await alertsTo(neha);
    expect(bell).toMatchObject({
      title: 'Vishal Saini was late 4 times this month',
      body: '4 late days so far in November 2026, 1h in all.',
      link: `/attendance/people/${vishal.id}?month=2026-11`,
    });
    expect(await alertsTo(vishal)).toEqual([]);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 0 });
    await lateOn(vishal, ['2026-11-06']);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 0 });
    expect(await alertsTo(neha)).toHaveLength(1);
    // The next payroll month alerts again.
    setNowForTests('2026-12-07T13:00:00Z');
    await lateOn(vishal, ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    expect(await attendance.sendLateAlerts('2026-12-07')).toMatchObject({ alerted: 1 });
    expect(await alertsTo(neha)).toHaveLength(2);
    const claims = await db('attendanceAlerts').where({ userId: vishal.id }).orderBy('id');
    expect(claims.map((row) => [row.kind, row.periodKey, row.days])).toEqual([
      ['late_days', '2026-11', 4],
      ['late_days', '2026-12', 4],
    ]);
  });

  it('keeps going when one person fails, and rolls that claim back', async () => {
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    await lateOn(vishal, dates);
    await lateOn(priya, dates);
    failing.test = (input) => input.title.startsWith('Vishal');
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
    expect((await alertsTo(neha)).map((row) => row.title)).toEqual([
      'Priya Sharma was late 4 times this month',
    ]);
    failing.test = null;
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
    expect(await alertsTo(neha)).toHaveLength(2);
  });

  it('checks the period before on the first working day of a period', async () => {
    setNowForTests('2026-12-01T13:00:00Z'); // Tue, 1 Dec
    await lateOn(vishal, ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(await attendance.sendLateAlerts('2026-12-01')).toMatchObject({ alerted: 1 });
    const [bell] = await alertsTo(neha);
    expect(bell).toMatchObject({
      title: 'Vishal Saini was late 4 times last month',
      body: '4 late days in November 2026, 1h in all.',
      link: `/attendance/people/${vishal.id}?month=2026-11`,
    });
    // The second working day doesn't look back.
    await db('attendanceAlerts').delete();
    setNowForTests('2026-12-02T13:00:00Z');
    expect(await attendance.sendLateAlerts('2026-12-02')).toMatchObject({ alerted: 0 });
  });

  it("sends an Admin's late days to the other Admins only", async () => {
    await lateOn(ravi, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
    expect(await alertsTo(asha)).toHaveLength(1);
    expect(await alertsTo(neha)).toEqual([]);
    expect(await alertsTo(ravi)).toEqual([]);
  });

  it('sends nothing on a holiday', async () => {
    await db('holidays').insert({ holidayDate: TODAY, name: 'Guru Nanak Jayanti' });
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(await attendance.sendLateAlerts(TODAY)).toEqual({
      alerted: 0,
      checked: 0,
      holiday: true,
    });
    expect(await alertsTo(neha)).toEqual([]);
  });

  it('counts first-half leave late only after the split mark', async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04']);
    await lateOn(priya, ['2026-11-02', '2026-11-03', '2026-11-04']);
    await db('leaveEntries').insert([
      { userId: vishal.id, fromDate: TODAY, toDate: TODAY, part: 'first_half' },
      { userId: priya.id, fromDate: TODAY, toDate: TODAY, part: 'first_half' },
    ]);
    setNowForTests('2026-11-19T08:15:00Z'); // 1:45 PM: before the 2:00 PM split
    await attendance.checkIn({ user: priya, ip: null });
    setNowForTests('2026-11-19T08:40:00Z'); // 2:10 PM: 10 minutes after it
    await attendance.checkIn({ user: vishal, ip: null });
    setNowForTests(EVENING);
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
    expect((await alertsTo(neha)).map((row) => row.title)).toEqual([
      'Vishal Saini was late 4 times this month',
    ]);
  });
});

describe('the late-alerts job', () => {
  it('runs on a working day from office end, once a day', async () => {
    await lateOn(vishal, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    setNowForTests('2026-11-19T12:59:00Z'); // 6:29 PM
    expect(await lateAlertsJob.tick()).toBeNull();
    setNowForTests(EVENING);
    const run = await lateAlertsJob.tick();
    expect(run).toMatchObject({ status: 'done', result: { alerted: 1 } });
    expect(await lateAlertsJob.tick()).toMatchObject({ status: 'skipped' });
    setNowForTests('2026-11-21T13:00:00Z'); // a Saturday
    expect(await lateAlertsJob.tick()).toBeNull();
  });
});
