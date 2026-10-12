// The Attendance page's data (artboard 09): durations read as hours and minutes ("Late 1h 37m",
// "Breaks 1h 2m", "Over 1h 15m", "average 1h 37m"), and HR never gets an Admin's row, correction
// request or missing check-out while an Admin gets everyone.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
