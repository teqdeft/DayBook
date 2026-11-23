// The Attendance page's data (artboard 09): durations read as hours and minutes ("Late 1h 37m",
// "Breaks 1h 2m", "Over 1h 15m", "average 1h 37m"), and HR never gets an Admin's row, correction
// request or missing check-out while an Admin gets everyone.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { loadAttendance } from '@/app/(app)/attendance/attendanceData';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const DAY = '2026-09-30'; // a Wednesday
const YESTERDAY = '2026-09-29';
// Clock times in India (UTC+5:30).
const at = (clock, date = DAY) => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d;
};

let hr;
let ceo;
let vishal;
let karan;
let kavya;

async function addRow(user, date, { checkIn = '09:30', checkOut, ...extra } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(checkIn, date),
    checkOutAt: checkOut ? at(checkOut, date) : null,
    checkoutStatus: checkOut ? 'checked_out' : 'open',
    location: 'office',
    ...extra,
  });
  return id;
}

async function addBreak(user, attendanceId, from, to) {
  await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId,
    workDate: DAY,
    startedAt: at(from),
    endedAt: at(to),
    endReason: 'self',
  });
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ break_allowance_minutes: 60, working_days: [1, 2, 3, 4, 5] });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  ceo = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini' });
  karan = await createUser({ name: 'Karan Mehta' });
  kavya = await createUser({ name: 'Kavya Iyer' });
  // Vishal: 97 minutes late, 62 minutes of breaks. Karan: on time, 2h 15m of breaks.
  // Kavya: 38 minutes late, no breaks. Ravi (Admin): in, and forgot to check out yesterday.
  const late = await addRow(vishal, DAY, { checkIn: '11:07', checkOut: '19:00', lateMinutes: 97 });
  await addBreak(vishal, late, '13:00', '14:02');
  const long = await addRow(karan, DAY, { checkIn: '09:20', checkOut: '18:30' });
  await addBreak(karan, long, '12:00', '14:15');
  await addRow(kavya, DAY, { checkIn: '10:08', checkOut: '18:00', lateMinutes: 38 });
  await addRow(ceo, DAY, { checkIn: '09:15' });
  await addRow(ceo, YESTERDAY, { checkoutStatus: 'missing' });
  await addRow(vishal, YESTERDAY, { checkoutStatus: 'missing' });
  setNowForTests(at('10:00'));
  await attendance.requestCorrection({
    user: ceo,
    type: 'check_out',
    workDate: YESTERDAY,
    checkOut: '18:40',
    reason: 'Left at 6:40 PM',
  });
});

beforeEach(() => setNowForTests(at('20:00')));

afterAll(() => setNowForTests(null));

describe('Attendance page data', () => {
  it('shows every duration in hours and minutes', async () => {
    const data = await loadAttendance({ user: hr, date: DAY });
    const row = (user) => data.rows.find((item) => item.user.id === user.id);
    expect(row(vishal)).toMatchObject({
      late: 'Late 1h 37m',
      present: '6h 51m',
      breaks: 'Breaks 1h 2m',
      over: 'Over 2m',
    });
    expect(row(karan)).toMatchObject({
      late: null,
      present: '6h 55m',
      breaks: 'Breaks 2h 15m',
      over: 'Over 1h 15m',
    });
    expect(row(kavya)).toMatchObject({ late: 'Late 38m', present: '7h 52m' });
    expect(row(kavya).breaks).toBeUndefined();
    // Late on average: (97 + 38) / 2 = 68 minutes.
    expect(data.kpis.find((kpi) => kpi.label === 'Late').sub).toBe('average 1h 8m');
  });

  it('keeps "average 26 minutes" under an hour, as on the artboard', async () => {
    await db('attendance').where({ userId: vishal.id, workDate: DAY }).update({ lateMinutes: 14 });
    try {
      const data = await loadAttendance({ user: hr, date: DAY });
      expect(data.kpis.find((kpi) => kpi.label === 'Late').sub).toBe('average 26 minutes');
    } finally {
      await db('attendance')
        .where({ userId: vishal.id, workDate: DAY })
        .update({ lateMinutes: 97 });
    }
  });

  it("leaves an Admin's row, request and missing check-out out for HR", async () => {
    const forHr = await loadAttendance({ user: hr, date: DAY });
    expect(forHr.rows.map((item) => item.user.id)).not.toContain(ceo.id);
    expect(forHr.summary).toMatchObject({ tracked: 4, present: 3, missingCheckouts: 1 });
    expect(forHr.corrections).toEqual({ total: 0, items: [] });
    expect(forHr.missing.items.map((item) => item.title)).toEqual(['Vishal Saini, Tue 29 Sep']);

    const forAdmin = await loadAttendance({ user: ceo, date: DAY });
    expect(forAdmin.rows.map((item) => item.user.id)).toContain(ceo.id);
    expect(forAdmin.summary).toMatchObject({ tracked: 5, present: 4, missingCheckouts: 2 });
    expect(forAdmin.corrections.items.map((item) => item.own)).toEqual([true]);
    expect(forAdmin.missing.total).toBe(2);
  });
});

describe('Attendance page data in 1.10 (CONTRACT 25)', () => {
  it('rows carry the marks, "4th this month" and the person month link for HR', async () => {
    const counts = vi.spyOn(attendance, 'lateCountsFor').mockResolvedValue({
      [vishal.id]: {
        nth: 4,
        label: '4th this month',
        title: '4th late day in September 2026',
        alert: true,
      },
      [kavya.id]: {
        nth: 1,
        label: '1st this month',
        title: '1st late day in September 2026',
        alert: false,
      },
    });
    try {
      const data = await loadAttendance({ user: hr, date: DAY });
      const row = (user) => data.rows.find((item) => item.user.id === user.id);
      expect(row(vishal)).toMatchObject({
        lateCount: { label: '4th this month', alert: true },
        mark: { label: 'Short day', title: 'Worked 6h 51m, under 8h' },
        personHref: `/attendance/people/${vishal.id}?month=2026-09`,
      });
      expect(row(kavya)).toMatchObject({
        lateCount: { label: '1st this month', alert: false },
        early: { minutes: '30m', title: 'Left 30m before their shift ended at 6:30 PM' },
      });
      expect(row(karan).lateCount).toBeNull();
      expect(counts).toHaveBeenCalledWith({
        date: DAY,
        userIds: expect.arrayContaining([vishal.id, kavya.id]),
      });
    } finally {
      counts.mockRestore();
    }
  });

  it('Needs a look and the row actions only for HR and Admins; a PM sees plain names', async () => {
    const needs = vi.spyOn(attendance, 'getNeedsLook');
    try {
      const pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
      const forPm = await loadAttendance({ user: pm, date: DAY });
      expect(forPm.needsLook).toBeNull();
      expect(forPm.rows.every((row) => !row.personHref && !row.action && !row.menu)).toBe(true);
      expect(needs).not.toHaveBeenCalled();
      const forHr = await loadAttendance({ user: hr, date: DAY });
      expect(needs).toHaveBeenCalledTimes(1);
      expect(forHr.needsLook).not.toBeNull();
      const vishalRow = forHr.rows.find((item) => item.user.id === vishal.id);
      expect(vishalRow.menu).toMatchObject({ person: { id: vishal.id }, date: DAY, leave: null });
    } finally {
      needs.mockRestore();
    }
  });

  it('the Present card says "2 off" and the On leave and On break pills show only above 0', async () => {
    const monday = '2026-09-28';
    const [first, second] = [vishal, karan];
    const ids = await db('leaveEntries').insert([
      { userId: first.id, fromDate: monday, toDate: monday, part: 'full' },
    ]);
    const [secondId] = await db('leaveEntries').insert({
      userId: second.id,
      fromDate: monday,
      toDate: monday,
      part: 'full',
    });
    try {
      const data = await loadAttendance({ user: hr, date: monday });
      const present = data.kpis.find((kpi) => kpi.label === 'Present');
      expect(present.sub).toBe('of 4 people, 2 off');
      expect(data.summary).toMatchObject({ onLeave: 2, off: 2, notCheckedIn: 2 });
      expect(data.pills.map((pill) => pill.value)).toEqual([
        'all',
        'late',
        'wfh',
        'not_checked_in',
        'on_leave',
        'unverified',
      ]);
      expect(data.pills.find((pill) => pill.value === 'on_leave').label).toBe('On leave (2)');
      const row = data.rows.find((item) => item.user.id === first.id);
      expect(row).toMatchObject({
        where: 'on_leave',
        whereLine: null,
        whereTitle: 'Casual leave, paid',
      });

      const day = await loadAttendance({ user: hr, date: DAY });
      expect(day.pills.map((pill) => pill.value)).not.toContain('on_leave');
      expect(day.pills.map((pill) => pill.value)).not.toContain('on_break'); // not today
      // A PM sees "On leave" without the type and pay.
      const pm = await createUser({ name: 'Pat Rao', role: 'pm', tracksAttendance: false });
      const forPm = await loadAttendance({ user: pm, date: monday });
      const pmRow = forPm.rows.find((item) => item.user.id === first.id);
      expect(pmRow).toMatchObject({ where: 'on_leave', whereTitle: null });
    } finally {
      await db('leaveEntries')
        .whereIn('id', [...ids, secondId])
        .delete();
    }
  });

  it('the On break pill shows on today while someone is on a break', async () => {
    const today = '2026-10-01';
    setNowForTests(at('13:30', today));
    const id = await addRow(karan, today, { checkIn: '09:30' });
    await db('attendanceBreaks').insert({
      userId: karan.id,
      attendanceId: id,
      workDate: today,
      startedAt: at('13:10', today),
    });
    try {
      const data = await loadAttendance({ user: hr });
      expect(data.date).toBe(today);
      expect(data.pills.find((pill) => pill.value === 'on_break').label).toBe('On break (1)');
      expect(data.rows.find((item) => item.user.id === karan.id)).toMatchObject({
        onBreakSince: '1:10',
        attendanceId: id,
      });
      const filtered = await loadAttendance({ user: hr, filter: 'on_break' });
      expect(filtered.rows.map((item) => item.user.id)).toEqual([karan.id]);
    } finally {
      await db('attendanceBreaks').where({ attendanceId: id }).delete();
      await db('attendance').where({ id }).delete();
    }
  });
});
