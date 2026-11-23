// The month summary (CONTRACT 25, item 4): summarizeRange over a payroll month that starts on the
// 26th, with holidays, leave, away breaks, a leaver and Admins, in about 8 queries plus one per
// 500 attendance rows; getMonth's filters, counts and totals.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);
const NOW = '2026-11-19T06:30:00Z'; // Thu, 19 Nov, 12:00 in India
const FROM = '2026-10-26';
const TO = '2026-11-25';

let hr;
let admin;
let vishal;
let priya;
let leaver;

async function addRow(user, date, extra = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(date, '09:30'),
    checkOutAt: at(date, '18:30'),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    createdAt: at(date, '09:30'),
    updatedAt: at(date, '18:30'),
    ...extra,
  });
  return id;
}

const personOf = (summary, user) => summary.people.find((person) => person.user.id === user.id);

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 26,
    break_allowance_minutes: 60,
    late_alert_days: 4,
  });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini' });
  priya = await createUser({ name: 'Priya Sharma' });
  leaver = await createUser({
    name: 'Karan Mehta',
    status: 'deactivated',
    deactivatedAt: new Date('2026-11-10T12:00:00Z'),
  });
});

beforeEach(async () => {
  setNowForTests(NOW);
  await db('attendanceBreaks').delete();
  await db('attendance').delete();
  await db('holidays').delete();
  await db('leaveEntries').delete();
  await db('auditLogs').delete();
});

afterEach(() => setNowForTests(null));

describe('summarizeRange', () => {
  it('counts a period from the 26th with a holiday, leave and planned leave', async () => {
    await db('holidays').insert([
      { holidayDate: '2026-11-09', name: 'Diwali' },
      { holidayDate: '2026-11-24', name: 'Guru Nanak Jayanti' },
    ]);
    await db('leaveEntries').insert([
      { userId: vishal.id, fromDate: '2026-10-30', toDate: '2026-11-02', part: 'full', paid: true },
      {
        userId: vishal.id,
        fromDate: '2026-11-12',
        toDate: '2026-11-12',
        part: 'first_half',
        paid: false,
        leaveType: 'sick',
        note: 'Doctor',
      },
      { userId: vishal.id, fromDate: '2026-11-23', toDate: '2026-11-23', part: 'full', paid: true },
    ]);
    await addRow(vishal, '2026-10-26', { lateMinutes: 22 });
    await addRow(vishal, '2026-11-12', { checkInAt: at('2026-11-12', '14:00') });
    await addRow(vishal, '2026-11-09', { isWorkingDay: false }); // worked on the holiday
    const summary = await attendance.summarizeRange({ from: FROM, to: TO, viewer: hr });
    expect(summary).toMatchObject({
      from: FROM,
      to: TO,
      through: '2026-11-19',
      today: '2026-11-19',
    });
    expect(summary.holidays).toEqual([
      { date: '2026-11-09', name: 'Diwali' },
      { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
    ]);
    expect(summary.available).toEqual({ holidays: true, leave: true });
    const person = personOf(summary, vishal);
    expect(person).toMatchObject({
      workingDays: 21, // 23 weekdays less two holidays
      workingDaysSoFar: 18,
      holidays: 2,
      presentDays: 1.5,
      daysOffWorked: 1,
      lateDays: 1,
      lateMinutes: 22,
      leave: { paid: 2, unpaid: 0.5, total: 2.5, planned: 1 },
    });
    expect(person.presentDays + person.leave.total + person.absentDays).toBe(
      person.workingDaysSoFar - 1, // today: not checked in yet, never absent
    );
  });

  it('never shows an Admin to HR; an Admin sees everyone', async () => {
    await addRow(admin, '2026-11-02');
    const forHr = await attendance.summarizeRange({ from: FROM, to: TO, viewer: hr });
    expect(personOf(forHr, admin)).toBeUndefined();
    const forAdmin = await attendance.summarizeRange({ from: FROM, to: TO, viewer: admin });
    expect(personOf(forAdmin, admin).presentDays).toBe(1);
    expect(forAdmin.people.map((person) => person.user.id)).toEqual(
      [...forAdmin.people.map((person) => person.user.id)].sort((a, b) => a - b),
    );
  });

  it('lists a leaver up to their last day and never counts them absent after it', async () => {
    await addRow(leaver, '2026-11-02');
    const summary = await attendance.summarizeRange({
      from: FROM,
      to: TO,
      viewer: hr,
      withDays: true,
    });
    const person = personOf(summary, leaver);
    expect(person.leftOn).toBe('2026-11-10');
    // Their last day without a row counts nowhere, so the days end the day before.
    expect(person.days.at(-1).date).toBe('2026-11-09');
    expect(person.days.filter((item) => item.date > '2026-11-10')).toEqual([]);
    // 26 Oct to 9 Nov: 11 working days; their last day (10 Nov) without a row isn't one.
    expect(person.workingDaysSoFar).toBe(11);
    expect(person.absentDays).toBe(10);
  });

  it('counts away breaks like any other break and an open row from yesterday as missing', async () => {
    const monday = await addRow(priya, '2026-11-16');
    await db('attendanceBreaks').insert({
      userId: priya.id,
      attendanceId: monday,
      workDate: '2026-11-16',
      startedAt: at('2026-11-16', '13:00'),
      endedAt: at('2026-11-16', '14:15'),
      endReason: 'away',
      source: 'away',
      createdAt: at('2026-11-16', '14:15'),
      updatedAt: at('2026-11-16', '14:15'),
    });
    await addRow(priya, '2026-11-18', { checkOutAt: null, checkoutStatus: 'open' });
    const summary = await attendance.summarizeRange({ from: FROM, to: TO, withDays: true });
    const person = personOf(summary, priya);
    expect(person).toMatchObject({
      breakMinutes: 75,
      workedMinutes: 540 - 75,
      overAllowanceDays: 1,
      missingCheckouts: 1,
      missingNotFixed: 1,
      presentDays: 2,
    });
    const yesterday = person.days.find((item) => item.date === '2026-11-18');
    expect(yesterday).toMatchObject({ presentMinutes: null, workedMinutes: null });
    expect(yesterday.row).not.toHaveProperty('checkInIp');
    expect(yesterday.row).not.toHaveProperty('checkOutIp');
    expect(yesterday).not.toHaveProperty('counts');
  });

  it('reads about 8 queries plus one per 500 attendance rows', async () => {
    const people = [];
    for (let index = 0; index < 18; index += 1) {
      people.push(await createUser({ name: `Budget ${index}` }));
    }
    const dates = [];
    for (let day = 1; day <= 25; day += 1) dates.push(`2026-11-${String(day).padStart(2, '0')}`);
    const all = people.flatMap((person) =>
      ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', ...dates].map(
        (date) => ({
          userId: person.id,
          workDate: date,
          checkInAt: at(date, '09:30'),
          checkOutAt: at(date, '18:30'),
          location: 'office',
          officeVerified: true,
          lateMinutes: 0,
          isWorkingDay: true,
          checkoutStatus: 'checked_out',
          source: 'self',
        }),
      ),
    );
    await db.batchInsert('attendance', all, 200);
    expect(all.length).toBeGreaterThan(500);
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    try {
      await attendance.summarizeRange({ from: FROM, to: TO, viewer: hr });
    } finally {
      db.removeListener('query', listen);
    }
    // Settings are cached for 30 s outside tests; the test reads them every time.
    const reads = queries.filter((sql) => !/from `settings`/.test(sql));
    const chunks = Math.ceil(all.length / 500);
    expect(reads.length).toBeLessThanOrEqual(8 + chunks);
    await db('attendance').delete();
    await db('users')
      .whereIn(
        'id',
        people.map((person) => person.id),
      )
      .delete();
  });
});

describe('getMonth', () => {
  it('filters, counts and totals the month view', async () => {
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) {
      await addRow(vishal, date, { lateMinutes: 15 });
    }
    await addRow(priya, '2026-11-02', { checkOutAt: at('2026-11-02', '12:00') }); // half day
    const month = await attendance.getMonth({ viewer: hr, filter: 'late' });
    expect(month.period).toMatchObject({ month: '2026-11', from: FROM, to: TO, isCurrent: true });
    expect(month.filter).toBe('late');
    expect(month.people.map((person) => person.user.name)).toEqual(['Vishal Saini']);
    expect(month.counts).toMatchObject({ late: 1, needs_look: 1, short: 1, missing: 0 });
    expect(month.totals).toMatchObject({
      workingDays: 23,
      workingDaysSoFar: 19,
      holidays: 0,
      lateDays: 4,
      latePeople: 1,
      lateAverageMinutes: 15,
      shortDays: 1,
    });
    expect(month.rules).toEqual({
      halfDayUnderMinutes: 270,
      shortDayUnderMinutes: 480,
      leftEarlyGraceMinutes: 15,
      lateAlertDays: 4,
    });
    const vishalMonth = await attendance.getMonth({ viewer: hr, filter: 'needs_look' });
    expect(vishalMonth.people[0].needsLook).toContainEqual({
      key: 'late',
      count: 4,
      label: '4 late days',
    });
  });

  it('reads a later month as the current one', async () => {
    const month = await attendance.getMonth({ viewer: hr, month: '2027-05' });
    expect(month.period.month).toBe('2026-11');
  });
});

describe('getNeedsLook', () => {
  it('lists people at the threshold this month, most first, Admins only for Admins', async () => {
    await setSettings({ payroll_month_start_day: 1 });
    try {
      const four = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
      for (const date of four) await addRow(priya, date, { lateMinutes: 10 });
      for (const date of [...four, '2026-11-06']) await addRow(admin, date, { lateMinutes: 10 });
      for (const date of four) {
        await addRow(vishal, date, { lateMinutes: 10, checkOutAt: at(date, '15:00') });
      }
      const forHr = await attendance.getNeedsLook({ viewer: hr });
      expect(forHr.period).toMatchObject({
        month: '2026-11',
        subtitle: 'November 2026 so far',
        monthHref: '/attendance/month?month=2026-11&filter=needs_look',
      });
      expect(forHr.threshold).toBe(4);
      expect(forHr.items.map((item) => item.user.name)).toEqual(['Vishal Saini', 'Priya Sharma']);
      expect(forHr.items[0]).toMatchObject({
        href: `/attendance/people/${vishal.id}?month=2026-11`,
        reasons: [
          { key: 'late', count: 4, label: '4 late days' },
          { key: 'short', count: 4, label: '4 short days' },
          { key: 'reports', count: 4, label: '4 missing reports' },
        ],
      });
      const forAdmin = await attendance.getNeedsLook({ viewer: admin });
      expect(forAdmin.items.map((item) => item.user.name)).toContain('Ravi Kapoor');
      expect(forAdmin.total).toBe(3);
    } finally {
      await setSettings({ payroll_month_start_day: 26 });
    }
  });
});
