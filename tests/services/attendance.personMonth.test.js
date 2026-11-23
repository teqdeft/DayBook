// One person's month for HR (CONTRACT 25, item 8): the allow-listed changes with their titles,
// reasons and notes (never the IP, mark_missing, auto_checkout or unverified_office), the listed
// days and tones, an Admin's month hidden from HR, and the person's own month without actions or
// leave notes.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { audit } from '@/modules/audit';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);
const NOW = '2026-11-19T06:30:00Z'; // Thu, 19 Nov, 12:00 in India
const IP = '10.0.0.77';

let neha;
let admin;
let vishal;

async function addRow(user, date, extra = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(date, '09:30'),
    checkOutAt: at(date, '18:30'),
    location: 'office',
    officeVerified: true,
    checkInIp: IP,
    checkOutIp: IP,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    ...extra,
  });
  return id;
}

function log(entry, createdAt) {
  return audit.log({ ip: IP, entityType: 'attendance', ...entry }).then(async () => {
    if (createdAt) {
      const last = await db('auditLogs').orderBy('id', 'desc').first();
      await db('auditLogs').where({ id: last.id }).update({ createdAt });
    }
  });
}

const titles = (month) => month.changes.map((change) => change.title);

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 1,
  });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini', shiftStart: '10:00:00', shiftEnd: '19:00:00' });
});

beforeEach(async () => {
  setNowForTests(NOW);
  await db('attendanceBreaks').delete();
  await db('attendance').delete();
  await db('leaveEntries').delete();
  await db('holidays').delete();
  await db('auditLogs').delete();
});

afterEach(() => setNowForTests(null));

describe('getPersonMonth', () => {
  it('lists the allow-listed changes with their titles, reasons and notes', async () => {
    const fri = await addRow(vishal, '2026-11-13', { checkInAt: at('2026-11-13', '09:30') });
    const tue = await addRow(vishal, '2026-11-03');
    const wed = await addRow(vishal, '2026-11-11');
    const thu = await addRow(vishal, '2026-11-05', { checkoutStatus: 'corrected' });
    const mon = await addRow(vishal, '2026-11-02');
    const view = (row) => ({ location: 'office', checkInAt: row.in, checkOutAt: row.out });
    await log({
      actorId: neha.id,
      action: 'attendance.edit',
      entityId: fri,
      before: view({ in: at('2026-11-13', '09:58'), out: null }),
      after: view({ in: at('2026-11-13', '09:30'), out: at('2026-11-13', '19:10') }),
      reason: 'The badge reader was down; he was in at 9:30.',
    });
    await log({
      actorId: neha.id,
      action: 'attendance.correct',
      entityId: tue,
      before: view({ in: at('2026-11-03', '09:30'), out: null }),
      after: {
        ...view({ in: at('2026-11-03', '09:30'), out: at('2026-11-03', '18:40') }),
        handlerNote: 'Checked with the PM',
      },
      reason: 'Forgot to check out',
    });
    await log({
      actorId: neha.id,
      action: 'attendance.confirm_office',
      entityId: tue,
      reason: 'Wi-Fi was down',
    });
    await log({
      actorId: neha.id,
      action: 'attendance.break_change',
      entityId: wed,
      before: {
        breakId: 1,
        startedAt: at('2026-11-11', '13:10'),
        endedAt: at('2026-11-11', '15:40'),
      },
      after: {
        breakId: 1,
        startedAt: at('2026-11-11', '13:10'),
        endedAt: at('2026-11-11', '13:55'),
      },
      reason: 'Forgot to end the break after lunch.',
    });
    await log({
      actorId: vishal.id,
      action: 'attendance.self_checkout',
      entityId: thu,
      after: { checkOutAt: at('2026-11-05', '18:30'), suggestedClock: '13:05', pastLastSeen: true },
      reason: 'Entered from Today',
    });
    await log({
      actorId: null,
      action: 'attendance.away_backfill',
      entityId: mon,
      after: {
        breakId: 2,
        startedAt: at('2026-11-02', '13:00'),
        endedAt: at('2026-11-02', '13:45'),
      },
      reason: 'Removed timer time counted as a break (1.10)',
    });
    await log({ actorId: null, action: 'attendance.mark_missing', entityId: thu });
    await log({ actorId: null, action: 'attendance.auto_checkout', entityId: mon });
    await log({
      actorId: vishal.id,
      action: 'attendance.unverified_office',
      entityId: wed,
      reason: 'my note',
    });
    const [leaveId] = await db('leaveEntries').insert({
      userId: vishal.id,
      fromDate: '2026-11-09',
      toDate: '2026-11-10',
      part: 'full',
      paid: true,
      leaveType: 'other',
      note: 'Family function out of town',
      createdBy: neha.id,
    });
    await audit.log({
      actorId: neha.id,
      action: 'leave.create',
      entityType: 'leave',
      entityId: leaveId,
      after: {
        userId: vishal.id,
        fromDate: '2026-11-09',
        toDate: '2026-11-10',
        part: 'full',
        paid: true,
        leaveType: 'other',
        note: 'Family function out of town',
      },
      ip: IP,
    });

    const month = await attendance.getPersonMonth({
      viewer: neha,
      userId: vishal.id,
      month: '2026-11',
    });
    expect(titles(month)).toEqual(
      expect.arrayContaining([
        'Neha Kapoor changed Fri, 13 Nov',
        'Neha Kapoor approved a correction for Tue, 3 Nov',
        'Neha Kapoor confirmed the office check-in on Tue, 3 Nov',
        'Neha Kapoor changed a break on Wed, 11 Nov',
        'Vishal Saini entered the check-out for Thu, 5 Nov',
        'Daybook counted time removed from a timer as a break on Mon, 2 Nov',
        'Neha Kapoor marked leave for Mon, 9 – Tue, 10 Nov',
      ]),
    );
    expect(month.changes).toHaveLength(7);
    const byTitle = (title) => month.changes.find((change) => change.title.startsWith(title));
    expect(byTitle('Neha Kapoor changed Fri')).toMatchObject({
      details: ['Check-in 9:58 AM to 9:30 AM', 'Check-out none to 7:10 PM'],
      reason: 'The badge reader was down; he was in at 9:30.',
    });
    expect(byTitle('Neha Kapoor approved')).toMatchObject({
      details: ['Check-out none to 6:40 PM'],
      reason: 'Forgot to check out',
      note: 'Checked with the PM',
    });
    expect(byTitle('Neha Kapoor changed a break').details).toEqual([
      'Break from 1:10 PM, end 3:40 PM to 1:55 PM',
    ]);
    expect(byTitle('Vishal Saini entered').details).toEqual([
      'Check-out 6:30 PM, Daybook last saw them at 1:05 PM',
    ]);
    expect(byTitle('Daybook counted')).toMatchObject({
      actor: null,
      details: ['Break 1:00 PM to 1:45 PM'],
      byLine: true,
    });
    expect(byTitle('Neha Kapoor marked leave')).toMatchObject({
      details: ['Other, paid, full day'],
      note: 'Family function out of town',
    });
    const body = JSON.stringify(month);
    expect(body).not.toContain(IP);
    expect(body).not.toContain('"ip"');
    expect(body).not.toContain('checkInIp');
    expect(body).not.toContain('checkOutIp');
    expect(body).not.toContain('my note');
  });

  it('gives the person, the listed days, the tones and HR may change them', async () => {
    await addRow(vishal, '2026-11-02', { checkInAt: at('2026-11-02', '10:20'), lateMinutes: 20 });
    await db('holidays').insert({ holidayDate: '2026-11-24', name: 'Guru Nanak Jayanti' });
    const month = await attendance.getPersonMonth({
      viewer: neha,
      userId: vishal.id,
      month: '2026-11',
    });
    expect(month.person).toMatchObject({
      name: 'Vishal Saini',
      shift: 'Shift 10:00 AM to 7:00 PM',
    });
    expect(month.canChange).toBe(true);
    expect(month.days[0]).toMatchObject({ date: '2026-11-02', lateMinutes: 20, where: 'office' });
    expect(month.days.at(-1).date).toBe('2026-11-19');
    expect(month.tones).toMatchObject({
      '2026-11-02': 'late',
      '2026-11-03': 'missing',
      '2026-11-24': 'holiday',
      '2026-11-25': 'future',
    });
    expect(month.totals).toMatchObject({ lateDays: 1, workingDays: 20 });
    expect(month.untracked).toBe(false);
  });

  it("hides an Admin's month from HR; an Admin may see it", async () => {
    await expect(
      attendance.getPersonMonth({ viewer: neha, userId: admin.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: "We couldn't find that person." });
    const month = await attendance.getPersonMonth({ viewer: admin, userId: admin.id });
    expect(month.canChange).toBe(false); // their own month
    await expect(attendance.getPersonMonth({ viewer: neha, userId: 999999 })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });

  it('shows the own month without actions and without leave notes', async () => {
    const [leaveId] = await db('leaveEntries').insert({
      userId: neha.id,
      fromDate: '2026-11-16',
      toDate: '2026-11-16',
      part: 'full',
      paid: false,
      leaveType: 'sick',
      note: 'Private note about Neha',
      createdBy: admin.id,
    });
    await audit.log({
      actorId: admin.id,
      action: 'leave.create',
      entityType: 'leave',
      entityId: leaveId,
      after: {
        userId: neha.id,
        fromDate: '2026-11-16',
        toDate: '2026-11-16',
        part: 'full',
        paid: false,
        leaveType: 'sick',
        note: 'Private note about Neha',
      },
    });
    const month = await attendance.getPersonMonth({
      viewer: neha,
      userId: neha.id,
      month: '2026-11',
    });
    expect(month.canChange).toBe(false);
    const leaveDay = month.days.find((item) => item.date === '2026-11-16');
    expect(leaveDay.leave).toMatchObject({ part: 'full', paid: false, type: 'sick', note: null });
    expect(month.changes[0]).toMatchObject({
      title: 'Ravi Kapoor marked leave for Mon, 16 Nov',
      note: null,
    });
    expect(JSON.stringify(month)).not.toContain('Private note');
    const forAdmin = await attendance.getPersonMonth({
      viewer: admin,
      userId: neha.id,
      month: '2026-11',
    });
    expect(forAdmin.days.find((item) => item.date === '2026-11-16').leave.note).toBe(
      'Private note about Neha',
    );
  });

  it('marks someone who does not track attendance and has no row', async () => {
    const pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
    const month = await attendance.getPersonMonth({ viewer: neha, userId: pm.id });
    expect(month.untracked).toBe(true);
    expect(month.days).toEqual([]);
  });
});
