// The morning HR summary and the evening wrap-up (CONTRACT 25, item 1): HR recipients (Admins
// when there is no HR), what each may see, the recipient's own requests left out, the exact
// lists, once per recipient per day (a failed send resends only to those without one; deleting
// the bell row never brings it back), the days and times it runs, and Slack per slack_hr_summary.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { localToUtc, setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { hrSummaryJob } from '@/worker/jobs/hrSummary';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const YESTERDAY = '2026-11-18';
const MONDAY = '2026-11-23';
const SATURDAY = '2026-11-21';
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const setClock = (clock, date = TODAY) => setNowForTests(at(clock, date).toISOString());
const LINK = `<${env.appOrigin}/attendance|Open Attendance>`;

let hr;
let ravi;
let asha;

function row(user, { date = TODAY, checkIn = '09:30', ...extra } = {}) {
  return db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(checkIn, date),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'open',
    ...extra,
  });
}

const morning = (date = TODAY) => attendance.sendHrMorningSummary(date);
const evening = (date = MONDAY) => attendance.sendHrEveningSummary(date);
const bellOf = (user, type = 'attendance.hr_summary') =>
  db('notifications').where({ userId: user.id, type }).orderBy('id');
const dmOf = async (user) => {
  const dm = await db('slackOutbox')
    .where({ relatedType: 'hr_summary', relatedId: user.id })
    .first();
  return dm ? parseJson(dm.payload).text : null;
};

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr', slackUserId: 'UHRS' });
  ravi = await createUser({ name: 'Ravi Kapoor', role: 'admin', slackUserId: 'UADS' });
  asha = await createUser({ name: 'Asha Rao', role: 'admin' });
});

beforeEach(async () => {
  const tables = ['attendanceAlerts', 'notifications', 'slackOutbox', 'auditLogs', 'jobRuns'];
  for (const table of [...tables, 'attendanceCorrections', 'wfhRequests', 'leaveEntries']) {
    await db(table).del();
  }
  for (const table of ['dailyReports', 'attendanceBreaks', 'attendance', 'holidays']) {
    await db(table).del();
  }
  const keep = [hr.id, ravi.id, asha.id];
  await db('users').whereNotIn('id', keep).update({ status: 'deactivated' });
  await db('users').whereIn('id', keep).update({ status: 'active' });
  await setSettings({
    timezone: TZ,
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    break_allowance_minutes: 60,
    hr_morning_summary: true,
    hr_summary_at: '10:00',
    hr_evening_summary: true,
    slack_enabled: true,
    slack_hr_summary: true,
  });
  forgetHandledKeysForTests();
  setClock('10:00');
});

afterEach(() => vi.restoreAllMocks());

describe('the morning summary', () => {
  it("lists what HR may see, never the recipient, and counts only others' requests", async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await createUser({ name: 'Rohit Verma', shiftStart: '11:00', shiftEnd: '20:00' });
    const vishal = await createUser({ name: 'Vishal Saini' });
    const meera = await createUser({ name: 'Meera Nair' });
    const sam = await createUser({ name: 'Sam Lee' });
    const karan = await createUser({ name: 'Karan Mehta' });
    await row(vishal, {
      checkIn: '09:52',
      location: 'wfh',
      officeVerified: false,
      lateMinutes: 22,
    });
    await row(karan, { checkIn: '09:25' });
    await row(karan, { date: YESTERDAY, checkoutStatus: 'missing' });
    await db('leaveEntries').insert({
      userId: meera.id,
      fromDate: TODAY,
      toDate: TODAY,
      part: 'first_half',
      leaveType: 'sick',
      note: 'Doctor',
    });
    const wfh = { reason: 'Plumber visit', handledBy: hr.id, handledAt: at('09:00') };
    await db('wfhRequests').insert({
      userId: sam.id,
      fromDate: TODAY,
      toDate: TODAY,
      status: 'approved',
      ...wfh,
    });
    await db('wfhRequests').insert({
      userId: sam.id,
      fromDate: '2026-11-20',
      toDate: '2026-11-20',
      status: 'pending',
      reason: 'Again',
    });
    const correction = {
      workDate: YESTERDAY,
      type: 'check_in',
      requestedTime: at('09:30', YESTERDAY),
      reason: 'Forgot',
    };
    for (const user of [priya, hr, ravi]) {
      await db('attendanceCorrections').insert({ userId: user.id, ...correction });
    }

    expect(await morning()).toEqual({ sent: 1 });
    expect(await dmOf(hr)).toBe(
      [
        '*Morning attendance, Thu, 19 Nov* (10:00 AM)',
        '*Not checked in (3):* Priya Sharma, Sam Lee, Rohit Verma (starts 11:00)',
        '*Late (1):* Vishal Saini 22m',
        '*On leave (1):* Meera Nair, first half',
        '*Working from home (2):* Vishal Saini, Sam Lee',
        '*Waiting for you:* 1 correction request, 1 work from home request',
        '*Missing check-outs from yesterday (1):* Karan Mehta',
        LINK,
      ].join('\n'),
    );
    const [bell] = await bellOf(hr);
    expect(bell).toMatchObject({
      title: 'Morning attendance: 3 not checked in, 1 late',
      body: '1 on leave · 2 WFH · 2 waiting for you · 1 missing check-out from yesterday',
      link: '/attendance?filter=not_checked_in',
    });
    expect(`${bell.title} ${bell.body}`).not.toMatch(/sick|Doctor/i);
    expect(await bellOf(ravi)).toHaveLength(0);
  });

  it('goes to the Admins when there is no HR; each sees the other Admin, never themselves', async () => {
    await db('users').where({ id: hr.id }).update({ status: 'deactivated' });
    expect(await morning()).toEqual({ sent: 2 });
    expect((await dmOf(ravi)).split('\n')[1]).toBe('*Not checked in (1):* Asha Rao');
    expect(await bellOf(asha)).toHaveLength(1);
    expect(await dmOf(asha)).toBeNull(); // no Slack ID
  });

  it('says when everyone has checked in, with the plain link', async () => {
    for (const user of [hr, ravi, asha]) await row(user);
    await morning();
    expect((await bellOf(hr))[0]).toMatchObject({
      title: 'Morning attendance: everyone has checked in',
      body: 'Nothing is waiting for you.',
      link: '/attendance',
    });
    expect((await dmOf(hr)).split('\n')[1]).toBe(
      'Everyone has checked in and nothing is waiting for you.',
    );
  });

  it('a failed send resends only to those without one; a deleted bell row never comes back', async () => {
    const anjali = await createUser({ name: 'Anjali Bose', role: 'hr' });
    const notify = notifications.notify;
    vi.spyOn(notifications, 'notify').mockImplementation(async (input, trx) => {
      if (input.userIds.includes(anjali.id)) throw new Error('bell is down');
      return notify(input, trx);
    });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(await morning()).toEqual({ sent: 1, failed: 1 });
    expect(error).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    const [bell] = await bellOf(hr);
    await notifications.remove({ userId: hr.id, id: bell.id });

    setClock('10:10');
    expect(await morning()).toEqual({ sent: 1 });
    expect(await bellOf(anjali)).toHaveLength(1);
    expect(await bellOf(hr)).toHaveLength(0);
    expect(await db('slackOutbox').where({ relatedType: 'hr_summary' })).toHaveLength(1);
  });

  it('before migration 018 the bell sent since midnight stands in for the claim', async () => {
    await db.raw('RENAME TABLE `attendance_alerts` TO `attendance_alerts_hidden`');
    try {
      expect(await morning()).toEqual({ sent: 1 });
      setClock('10:10');
      expect(await morning()).toEqual({ sent: 0 });
    } finally {
      await db.raw('RENAME TABLE `attendance_alerts_hidden` TO `attendance_alerts`');
    }
    expect(await bellOf(hr)).toHaveLength(1);
  });

  it('not on a weekend or a holiday, not before hr_summary_at or from office end; Slack per its switch', async () => {
    setClock('10:00', SATURDAY);
    expect(await morning(SATURDAY)).toEqual({ sent: 0 });
    await db('holidays').insert({ holidayDate: TODAY, name: 'Guru Nanak Jayanti' });
    setClock('10:00');
    expect(await morning()).toEqual({ sent: 0 });
    expect(await hrSummaryJob.tick()).toBeNull();
    await db('holidays').del();

    setClock('09:59');
    expect(await morning()).toEqual({ sent: 0 });
    expect(await hrSummaryJob.tick()).toBeNull();
    setClock('18:30');
    expect(await morning()).toEqual({ sent: 0 });
    expect(await hrSummaryJob.tick()).toBeNull();

    await setSettings({ slack_hr_summary: false });
    setClock('10:05');
    expect(await hrSummaryJob.tick()).toEqual({ status: 'done', result: { sent: 1 } });
    expect(await bellOf(hr)).toHaveLength(1);
    expect(await dmOf(hr)).toBeNull();
    await setSettings({ hr_morning_summary: false });
    expect(await morning()).toEqual({ sent: 0 });
  });
});

describe('the evening wrap-up', () => {
  it('lists who is still in, reports not in, the allowance and the weekend auto check-out', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const rohit = await createUser({ name: 'Rohit Verma', shiftStart: '11:00', shiftEnd: '20:00' });
    const karan = await createUser({ name: 'Karan Mehta' });
    const odd = await createUser({ name: '<Neha & co>' });
    const sam = await createUser({ name: 'Sam Lee' });
    await row(priya, { date: MONDAY, checkIn: '09:32' });
    await row(rohit, { date: MONDAY, checkIn: '11:02' });
    const [karanRow] = await row(karan, {
      date: MONDAY,
      checkOutAt: at('18:35', MONDAY),
      checkoutStatus: 'checked_out',
    });
    await row(odd, {
      date: MONDAY,
      checkOutAt: at('18:31', MONDAY),
      checkoutStatus: 'checked_out',
    });
    await db('attendanceBreaks').insert({
      userId: karan.id,
      attendanceId: karanRow,
      workDate: MONDAY,
      startedAt: at('13:00', MONDAY),
      endedAt: at('14:25', MONDAY),
      endReason: 'away',
      source: 'away',
    });
    await db('dailyReports').insert({
      userId: karan.id,
      workDate: MONDAY,
      status: 'submitted',
      locksAt: at('23:59', MONDAY),
    });
    // Saturday work, checked out automatically and fixed since: the audit row keeps it counted.
    const [samRow] = await row(sam, {
      date: SATURDAY,
      isWorkingDay: false,
      checkOutAt: at('20:30', SATURDAY),
      checkoutStatus: 'corrected',
    });
    await audit.log({
      action: 'attendance.auto_checkout',
      entityType: 'attendance',
      entityId: samRow,
      after: { checkOutAt: at('20:00', SATURDAY) },
    });

    setClock('18:59', MONDAY);
    expect(await evening()).toEqual({ sent: 0 });
    setClock('19:00', MONDAY);
    expect(await evening()).toEqual({ sent: 1 });
    expect(await dmOf(hr)).toBe(
      [
        '*Evening attendance, Mon, 23 Nov* (7:00 PM)',
        '*Still checked in (1):* Priya Sharma (since 9:32) and 1 still on their shift',
        '*Reports not in (3):* Priya Sharma, Rohit Verma, &lt;Neha &amp; co&gt;',
        '*Over the break allowance (1):* Karan Mehta, over by 25m',
        '*Auto check-outs since Fri, 20 Nov (1):* Sam Lee at 8:00 PM on Sat, 21 Nov',
        LINK,
      ].join('\n'),
    );
    expect((await bellOf(hr, 'attendance.hr_evening_summary'))[0]).toMatchObject({
      title: 'Evening attendance: 1 still checked in',
      body: '3 reports not in · 1 over the break allowance · 1 auto check-out since Fri, 20 Nov',
      link: '/attendance',
    });
    setClock('19:10', MONDAY);
    expect(await evening()).toEqual({ sent: 0 });
  });

  it('is off while its switch is off (the default) and never on a holiday', async () => {
    await setSettings({ hr_evening_summary: false });
    setClock('19:00', MONDAY);
    expect(await evening()).toEqual({ sent: 0 });
    await setSettings({ hr_evening_summary: true });
    await db('holidays').insert({ holidayDate: MONDAY, name: 'Founders Day' });
    expect(await evening()).toEqual({ sent: 0 });
  });
});
