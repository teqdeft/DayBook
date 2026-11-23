// The automatic check-in reminder (CONTRACT 25, item 5): due at the own late mark + 30 minutes,
// once a day (two ticks, two workers), never on a weekend, a holiday or full-day leave, after the
// split on first-half leave, stopped by HR's remind earlier that day, off at 0, never after the
// day end or more than an hour late, and nothing but one warning before migration 018.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { localToUtc, setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { checkinRemindersJob } from '@/worker/jobs/checkinReminders';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const SATURDAY = '2026-11-21';
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const setClock = (clock, date = TODAY) => setNowForTests(at(clock, date).toISOString());

let hr;

const tick = (date = TODAY) => attendance.sendCheckinReminders(date);
const remindersOf = (user) => db('attendanceReminders').where({ userId: user.id });
const person = (name, extra = {}) => createUser({ name, ...extra });

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr', tracksAttendance: false });
});

beforeEach(async () => {
  for (const table of ['attendanceReminders', 'notifications', 'auditLogs', 'slackOutbox']) {
    await db(table).del();
  }
  for (const table of ['attendance', 'leaveEntries', 'holidays']) await db(table).del();
  // Only the people a test creates are due.
  await db('users').whereNot({ id: hr.id }).update({ status: 'deactivated' });
  await setSettings({
    timezone: TZ,
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    checkin_reminder_minutes: 30,
    slack_enabled: true,
    slack_attendance_remind: true,
  });
  attendance.clearCompanyDayCache();
  setClock('10:00');
});

afterEach(() => vi.restoreAllMocks());

describe('when it is due', () => {
  it('at the late mark + 30 minutes, for the company and for an own shift', async () => {
    const priya = await person('Priya Sharma', { slackUserId: 'UCHK1' });
    const late = await person('Karan Mehta', { shiftStart: '11:00', shiftEnd: '20:00' });
    setClock('09:59');
    expect(await tick()).toEqual({ reminded: 0 });
    setClock('10:00');
    expect(await tick()).toEqual({ reminded: 1 });
    expect(await remindersOf(priya).first()).toMatchObject({
      kind: 'check_in',
      workDate: TODAY,
      sentBy: null,
      autoKey: `check_in:${TODAY}`,
    });
    expect(await db('notifications').where({ userId: priya.id }).first()).toMatchObject({
      type: 'attendance.checkin_reminder',
      title: "You haven't checked in yet",
      body: 'Your day started at 9:30 AM. Check in on Today when you start work.',
      link: '/today',
    });
    expect(await db('slackOutbox').where({ channel: 'UCHK1' }).first()).toBeTruthy();
    expect(await db('auditLogs').count({ n: '*' }).first()).toEqual({ n: 0 });

    setClock('11:30');
    expect(await tick()).toEqual({ reminded: 1 });
    expect((await db('notifications').where({ userId: late.id }).first()).body).toBe(
      'Your day started at 11:00 AM. Check in on Today when you start work.',
    );
  });

  it('once a day: a second tick and a second worker send nothing more', async () => {
    const priya = await person('Priya Sharma');
    const both = await Promise.all([tick(), tick()]);
    expect(both.map((result) => result.reminded).sort()).toEqual([0, 1]);
    setClock('10:05');
    expect(await tick()).toEqual({ reminded: 0 });
    expect(await remindersOf(priya)).toHaveLength(1);
  });

  it('not for someone who checked in, nor on a weekend, a holiday or full-day leave', async () => {
    const priya = await person('Priya Sharma');
    const meera = await person('Meera Nair');
    const rohit = await person('Rohit Verma');
    await db('attendance').insert({
      userId: rohit.id,
      workDate: TODAY,
      checkInAt: at('09:50'),
      location: 'office',
      officeVerified: true,
      lateMinutes: 20,
      isWorkingDay: true,
      checkoutStatus: 'open',
    });
    await db('leaveEntries').insert({ userId: meera.id, fromDate: TODAY, toDate: TODAY });
    expect(await tick()).toEqual({ reminded: 1 });
    expect(await remindersOf(priya)).toHaveLength(1);

    setClock('10:00', SATURDAY);
    expect(await tick(SATURDAY)).toEqual({ reminded: 0 });
    await db('holidays').insert({ holidayDate: '2026-11-20', name: 'Guru Nanak Jayanti' });
    setClock('10:00', '2026-11-20');
    expect(await tick('2026-11-20')).toEqual({ reminded: 0 });
    expect(await checkinRemindersJob.tick()).toBeNull();
  });

  it('first-half leave: from the split mark + 30 (2:30 PM)', async () => {
    const meera = await person('Meera Nair');
    await db('leaveEntries').insert({
      userId: meera.id,
      fromDate: TODAY,
      toDate: TODAY,
      part: 'first_half',
    });
    expect(await tick()).toEqual({ reminded: 0 });
    setClock('14:29');
    expect(await tick()).toEqual({ reminded: 0 });
    setClock('14:30');
    expect(await tick()).toEqual({ reminded: 1 });
    expect((await db('notifications').where({ userId: meera.id }).first()).body).toMatch(
      /^Your day started at 2:00 PM\./,
    );
  });

  it("HR's remind earlier that day stops it; 0 turns it off", async () => {
    const priya = await person('Priya Sharma');
    setClock('09:45');
    await attendance.remind({ actor: hr, kind: 'check_in', userIds: [priya.id] });
    setClock('10:20');
    expect(await tick()).toEqual({ reminded: 0 });
    expect(await remindersOf(priya)).toHaveLength(1);

    await person('Karan Mehta');
    await setSettings({ checkin_reminder_minutes: 0 });
    expect(await tick()).toEqual({ reminded: 0 });
    expect(await checkinRemindersJob.tick()).toBeNull();
  });

  it('never after the day end, and never more than an hour late (a worker down until the afternoon)', async () => {
    const short = await person('Sam Lee', { shiftStart: '09:00', shiftEnd: '10:10' });
    await person('Priya Sharma');
    setClock('10:10');
    expect(await tick()).toEqual({ reminded: 1 }); // Priya only: Sam's day has ended
    expect(await remindersOf(short)).toHaveLength(0);

    await db('attendanceReminders').del();
    setClock('11:00'); // due from 10:00, for an hour
    expect(await tick()).toEqual({ reminded: 0 });
    setClock('15:00');
    expect(await tick()).toEqual({ reminded: 0 });
    setClock('10:59');
    expect(await checkinRemindersJob.tick()).toEqual({ reminded: 1 });
  });
});

describe('before migration 018', () => {
  it('sends nothing, warns once and logs no error per person', async () => {
    await person('Priya Sharma');
    await person('Karan Mehta');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    await db.raw('RENAME TABLE `attendance_reminders` TO `attendance_reminders_hidden`');
    try {
      expect(await tick()).toEqual({ reminded: 0, unavailable: true });
      expect(await tick()).toEqual({ reminded: 0, unavailable: true });
    } finally {
      await db.raw('RENAME TABLE `attendance_reminders_hidden` TO `attendance_reminders`');
    }
    const warnings = warn.mock.calls.filter(([message]) => /reminders is off/.test(message));
    expect(warnings).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
    expect(await db('notifications').count({ n: '*' }).first()).toEqual({ n: 0 });
  });
});
