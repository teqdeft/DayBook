// Attendance rules for check-in, check-out, missing check-outs and the day view (guide 7.2, 7.3,
// 7.10). Reports are mocked so check-out can be tested against any report state.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { reports } from '@/modules/reports';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    getDayStatus: vi.fn(async () => ({ reportId: null, status: 'none', totalMinutes: 0 })),
  },
}));

const OFFICE_IP = '203.0.113.24';
const HOME_IP = '198.51.100.7';
// Wednesday 30 September 2026 in India (UTC+5:30).
const at = (clock, date = '2026-09-30') => {
  const [h, m] = clock.split(':').map(Number);
  const minutes = h * 60 + m - 330;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(minutes);
  return d.toISOString();
};

let hr;
let hr2;
let admin;

async function person(overrides = {}) {
  return createUser(overrides);
}

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return 'OK';
}

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', slackUserId: 'UHR1' });
  hr2 = await createUser({ name: 'Anjali Bose', role: 'hr' });
  admin = await createUser({ name: 'The Admin', role: 'admin', tracksAttendance: false });
  await db('officeNetworks').insert({ name: 'Main office', ipAddress: OFFICE_IP });
});

beforeEach(async () => {
  await setSettings({
    allow_unverified_office: true,
    auto_mark_missing_checkout: true,
    working_days: [1, 2, 3, 4, 5],
  });
  setNowForTests(at('09:32'));
});

describe('check-in', () => {
  it('on the office network saves a verified office check-in with late minutes and the note', async () => {
    const vishal = await person({ name: 'Vishal Saini' });
    const row = await attendance.checkIn({
      user: vishal,
      ip: OFFICE_IP,
      note: '  plumber visit, online by 11  ',
    });
    expect(row).toMatchObject({
      userId: vishal.id,
      workDate: '2026-09-30',
      location: 'office',
      officeVerified: true,
      lateMinutes: 2,
      isWorkingDay: true,
      checkoutStatus: 'open',
      source: 'self',
      checkInIp: OFFICE_IP,
      note: 'plumber visit, online by 11',
    });
    expect(new Date(row.checkInAt).toISOString()).toBe(at('09:32'));
  });

  it('allows one check-in per day, also when two arrive at once', async () => {
    const priya = await person();
    await attendance.checkIn({ user: priya, ip: HOME_IP });
    expect(await code(attendance.checkIn({ user: priya, ip: HOME_IP }))).toBe('ALREADY_CHECKED_IN');

    const rohit = await person();
    const results = await Promise.allSettled([
      attendance.checkIn({ user: rohit, ip: HOME_IP }),
      attendance.checkIn({ user: rohit, ip: HOME_IP }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('ALREADY_CHECKED_IN');
    expect(await db('attendance').where({ userId: rohit.id })).toHaveLength(1);
  });

  it('on the office network the only option is Office', async () => {
    const aman = await person();
    const row = await attendance.checkIn({ user: aman, ip: OFFICE_IP, location: 'wfh' });
    expect(row).toMatchObject({ location: 'office', officeVerified: true });
  });

  it('elsewhere defaults to WFH and needs the Wi-Fi-down option for Office', async () => {
    const simran = await person();
    const row = await attendance.checkIn({ user: simran, ip: HOME_IP });
    expect(row).toMatchObject({ location: 'wfh', officeVerified: true });

    const karan = await person();
    expect(await code(attendance.checkIn({ user: karan, ip: HOME_IP, location: 'office' }))).toBe(
      'OFFICE_NETWORK_REQUIRED',
    );
    expect(await code(attendance.checkIn({ user: karan, ip: null, location: 'office' }))).toBe(
      'OFFICE_NETWORK_REQUIRED',
    );
  });

  it('saves an unverified office check-in, notifies HR and audits it when allowed', async () => {
    const ankit = await person({ name: 'Ankit Rana' });
    const row = await attendance.checkIn({
      user: ankit,
      ip: HOME_IP,
      location: 'office',
      unverifiedOffice: true,
      note: 'Office Wi-Fi was down',
    });
    expect(row).toMatchObject({ location: 'office', officeVerified: false });
    const sent = await db('notifications').where({ type: 'attendance.unverified_office' });
    expect(sent.map((n) => n.userId).sort()).toEqual([hr.id, hr2.id].sort());
    expect(sent[0]).toMatchObject({
      title: 'Ankit Rana checked in at the office, unverified',
      body: 'Office Wi-Fi was down',
    });
    const log = await db('auditLogs').where({ action: 'attendance.unverified_office' }).first();
    expect(log).toMatchObject({ actorId: ankit.id, entityType: 'attendance', entityId: row.id });
  });

  it('refuses an unverified office check-in when the setting is off', async () => {
    await setSettings({ allow_unverified_office: false });
    const deepak = await person();
    expect(
      await code(
        attendance.checkIn({
          user: deepak,
          ip: HOME_IP,
          location: 'office',
          unverifiedOffice: true,
        }),
      ),
    ).toBe('UNVERIFIED_OFFICE_DISABLED');
    expect(await db('attendance').where({ userId: deepak.id }).first()).toBeUndefined();
  });

  it('counts late minutes from the late_after setting', async () => {
    await setSettings({ late_after: '09:45' });
    setNowForTests(at('10:23'));
    const row = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(row.lateMinutes).toBe(38);
    setNowForTests(at('09:40'));
    const early = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(early.lateMinutes).toBe(0);
    await setSettings({ late_after: '09:30' });
  });

  it("uses the person's own shift start instead of late_after", async () => {
    const shift = await person({ shiftStart: '10:00:00' });
    setNowForTests(at('09:50'));
    expect((await attendance.checkIn({ user: shift, ip: HOME_IP })).lateMinutes).toBe(0);
    const later = await person({ shiftStart: '10:00:00' });
    setNowForTests(at('10:05'));
    expect((await attendance.checkIn({ user: later, ip: HOME_IP })).lateMinutes).toBe(5);
  });

  it('is allowed on a non-working day, with is_working_day = 0 and no late minutes', async () => {
    setNowForTests(at('11:30', '2026-10-03')); // Saturday
    const row = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(row).toMatchObject({ workDate: '2026-10-03', isWorkingDay: false, lateMinutes: 0 });
  });

  it('reads the working days from the working_days setting', async () => {
    await setSettings({ working_days: [1, 2, 3, 4, 5, 6] });
    setNowForTests(at('10:00', '2026-10-03')); // Saturday, a working day now
    const saturday = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(saturday).toMatchObject({ workDate: '2026-10-03', isWorkingDay: true, lateMinutes: 30 });

    await setSettings({ working_days: [2, 3, 4, 5, 6] });
    setNowForTests(at('10:00', '2026-10-05')); // Monday, no longer one
    const monday = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(monday).toMatchObject({ workDate: '2026-10-05', isWorkingDay: false, lateMinutes: 0 });
  });

  it('dates a check-in by the company day, also just after midnight', async () => {
    // 00:10 on 1 October in India is still 30 September in UTC.
    setNowForTests(at('00:10', '2026-10-01'));
    const early = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(early).toMatchObject({ workDate: '2026-10-01', isWorkingDay: true, lateMinutes: 0 });
    expect((await attendance.getMyToday({ user: { id: early.userId } })).row?.id).toBe(early.id);

    setNowForTests(at('23:55', '2026-09-30'));
    const late = await attendance.checkIn({ user: await person(), ip: HOME_IP });
    expect(late.workDate).toBe('2026-09-30');
  });
});

describe('check-out', () => {
  it('needs an open check-in today', async () => {
    const meera = await person();
    expect(await code(attendance.checkOut({ user: meera, ip: HOME_IP }))).toBe('NOT_CHECKED_IN');
    // Yesterday's open row doesn't count.
    await db('attendance').insert({
      userId: meera.id,
      workDate: '2026-09-29',
      checkInAt: new Date(at('09:30', '2026-09-29')),
      location: 'wfh',
    });
    expect(await code(attendance.checkOut({ user: meera, ip: HOME_IP }))).toBe('NOT_CHECKED_IN');
  });

  it('saves the server time, returns reportPending and refuses a second check-out', async () => {
    const vishal = await person();
    await attendance.checkIn({ user: vishal, ip: OFFICE_IP });
    setNowForTests(at('18:34'));
    const result = await attendance.checkOut({ user: vishal, ip: OFFICE_IP });
    // Nothing logged yet: the report is pending and the whole day is a gap (it only warns).
    expect(result).toMatchObject({
      reportPending: true,
      reportStatus: 'none',
      presentMinutes: 542,
      breakMinutes: 0,
      workedMinutes: 542,
      loggedMinutes: 0,
      gapMinutes: 542,
      gapWarning: true,
    });
    expect(result.row).toMatchObject({ checkoutStatus: 'checked_out', checkOutIp: OFFICE_IP });
    expect(new Date(result.row.checkOutAt).toISOString()).toBe(at('18:34'));
    expect(await code(attendance.checkOut({ user: vishal, ip: OFFICE_IP }))).toBe(
      'ALREADY_CHECKED_OUT',
    );
  });

  it('warns (never blocks) when present time and logged hours differ by more than the setting', async () => {
    const priya = await person();
    await attendance.checkIn({ user: priya, ip: HOME_IP });
    setNowForTests(at('18:32'));
    reports.getDayStatus.mockResolvedValueOnce({
      reportId: 7,
      status: 'submitted',
      totalMinutes: 360,
    });
    const result = await attendance.checkOut({ user: priya, ip: HOME_IP });
    expect(reports.getDayStatus).toHaveBeenLastCalledWith(priya.id, '2026-09-30');
    expect(result).toMatchObject({
      reportPending: false,
      loggedMinutes: 360,
      presentMinutes: 540,
      gapMinutes: 180,
      gapWarning: true,
    });

    const aman = await person();
    setNowForTests(at('09:30'));
    await attendance.checkIn({ user: aman, ip: HOME_IP });
    setNowForTests(at('18:30'));
    reports.getDayStatus.mockResolvedValueOnce({
      reportId: 8,
      status: 'submitted',
      totalMinutes: 480,
    });
    const close = await attendance.checkOut({ user: aman, ip: HOME_IP });
    expect(close).toMatchObject({ gapMinutes: 60, gapWarning: false, reportPending: false });

    // A draft counts as logged hours too: still checked out, still only a warning.
    const rohit = await person();
    setNowForTests(at('09:30'));
    await attendance.checkIn({ user: rohit, ip: HOME_IP });
    setNowForTests(at('18:30'));
    reports.getDayStatus.mockResolvedValueOnce({ reportId: 9, status: 'draft', totalMinutes: 240 });
    const draft = await attendance.checkOut({ user: rohit, ip: HOME_IP });
    expect(draft).toMatchObject({
      reportPending: true,
      reportStatus: 'draft',
      loggedMinutes: 240,
      gapMinutes: 300,
      gapWarning: true,
    });
    expect(draft.row.checkoutStatus).toBe('checked_out');
  });
});

describe('missing check-outs', () => {
  async function openRow(user, workDate) {
    const [id] = await db('attendance').insert({
      userId: user.id,
      workDate,
      checkInAt: new Date(at('09:30', workDate)),
      location: 'office',
    });
    return id;
  }

  it('marks open rows from earlier days as missing and tells HR and the person', async () => {
    const deepak = await person({ name: 'Deepak Joshi' });
    const yesterday = await openRow(deepak, '2026-09-29');
    const todayRow = await openRow(await person(), '2026-09-30');
    setNowForTests(at('00:05'));
    const before = await db('attendance')
      .where({ checkoutStatus: 'open' })
      .where('workDate', '<', '2026-09-30');
    const result = await attendance.markMissingCheckouts();
    expect(result.marked).toBe(before.length);
    expect((await db('attendance').where({ id: yesterday }).first()).checkoutStatus).toBe(
      'missing',
    );
    expect((await db('attendance').where({ id: todayRow }).first()).checkoutStatus).toBe('open');
    const toHr = await db('notifications').where({
      type: 'attendance.missing_checkout',
      title: "Deepak Joshi didn't check out on Tue, 29 Sep",
    });
    expect(toHr.map((n) => n.userId).sort()).toEqual([hr.id, hr2.id].sort());
    const toPerson = await db('notifications').where({ userId: deepak.id }).first();
    expect(toPerson.title).toBe("You didn't check out on Tue, 29 Sep");
    expect((await attendance.markMissingCheckouts()).marked).toBe(0);
  });

  it('does nothing when auto_mark_missing_checkout is off', async () => {
    await setSettings({ auto_mark_missing_checkout: false });
    const id = await openRow(await person(), '2026-09-28');
    setNowForTests(at('00:05'));
    expect(await attendance.markMissingCheckouts()).toEqual({ marked: 0 });
    expect((await db('attendance').where({ id }).first()).checkoutStatus).toBe('open');
    await setSettings({ auto_mark_missing_checkout: true });
    expect((await attendance.markMissingCheckouts()).marked).toBe(1);
  });
});

describe('present time', () => {
  it('counts to check-out, or now; missing rows count 0; open rows stop at the end of their day', () => {
    const base = { checkInAt: new Date(at('09:32')), workDate: '2026-09-30' };
    expect(attendance.presentMinutes({ ...base, checkOutAt: new Date(at('18:34')) })).toBe(542);
    expect(attendance.presentMinutes(base, new Date(at('15:10')))).toBe(338);
    expect(attendance.presentMinutes({ ...base, checkoutStatus: 'missing' })).toBe(0);
    expect(attendance.presentMinutes(base, new Date(at('09:00', '2026-10-01')))).toBe(868);
    expect(attendance.presentMinutes(null)).toBe(0);
  });
});

describe('the day view', () => {
  it('lists tracked active people with their rows and counts the numbers by the 7.10 rules', async () => {
    const date = '2026-09-24';
    await db('attendance').where({ workDate: date }).delete();
    const people = [];
    // One at a time: createUser numbers emails after an await.
    for (const n of [1, 2, 3, 4, 5]) people.push(await person({ name: `Day ${n}` }));
    const gone = await person({ status: 'deactivated' });
    const add = (user, clock, extra) =>
      db('attendance').insert({
        userId: user.id,
        workDate: date,
        checkInAt: new Date(at(clock, date)),
        location: 'office',
        ...extra,
      });
    await add(people[0], '09:30', {});
    await add(people[1], '09:41', { location: 'wfh', lateMinutes: 11 });
    await add(people[2], '10:08', { lateMinutes: 38 });
    await add(people[3], '09:58', { officeVerified: false, lateMinutes: 28 });
    await add(gone, '09:30', {});
    await add(admin, '09:30', {});

    const items = await attendance.listDay(date);
    const ids = items.map((item) => item.user.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(admin.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const summary = await attendance.getDaySummary(date, items);
    expect(summary).toMatchObject({
      present: 4,
      inOffice: 3,
      wfh: 1,
      late: 3,
      lateAverageMinutes: 26,
      unverified: 1,
      notCheckedIn: summary.tracked - 4,
    });
    const late = await attendance.listForDay({ date, filter: 'late' });
    expect(late.total).toBe(3);
    const unverified = await attendance.listForDay({ date, filter: 'unverified' });
    expect(unverified.items.map((item) => item.user.id)).toEqual([people[3].id]);
    expect(unverified.items[0].where).toBe('unverified');
    const missing = await attendance.listForDay({ date, filter: 'not_checked_in', limit: 2 });
    expect(missing.items).toHaveLength(2);
    expect(missing.total).toBe(summary.notCheckedIn);

    // The Excel download: one row per tracked person, 24-hour clocks, blanks when not in.
    const file = await attendance.exportDay(date);
    expect(file.filename).toBe(`attendance-${date}.xlsx`);
    const sheet = file.sheets[0];
    expect(sheet.rows).toHaveLength(summary.tracked);
    expect(sheet.rows.find((row) => row.name === 'Day 3')).toMatchObject({
      where: 'Office',
      checkIn: '10:08',
      lateMinutes: 38,
    });
    expect(sheet.rows.find((row) => row.name === 'Day 5')).toMatchObject({
      where: 'Not checked in',
      checkIn: '',
      presentHours: null,
    });
  });
});

describe('who the day view lists', () => {
  it('leaves out people who join later, untracked people (PMs) and leavers', async () => {
    const date = '2026-09-23';
    const joiner = await person({ name: 'Future Joiner', joinedOn: '2026-10-05' });
    const joined = await person({ name: 'Joined That Day', joinedOn: date });
    const pm = await person({ name: 'Pam', role: 'pm', tracksAttendance: false });
    const gone = await person({ name: 'Gone', status: 'deactivated' });
    const ids = (await attendance.listDay(date)).map((item) => item.user.id);
    expect(ids).toContain(joined.id);
    for (const left of [joiner, pm, gone, admin]) expect(ids).not.toContain(left.id);
    // The joiner counts from their first day.
    const later = (await attendance.listDay('2026-10-05')).map((item) => item.user.id);
    expect(later).toContain(joiner.id);
    const summary = await attendance.getDaySummary(date);
    expect(summary.tracked).toBe(ids.length);
    expect(summary.notCheckedIn).toBe(
      (await attendance.listForDay({ date, filter: 'not_checked_in' })).total,
    );
  });
});

describe('the date a screen asks for', () => {
  it('keeps real past dates, clamps future ones and falls back to today for anything else', async () => {
    expect(await attendance.resolveDate('2026-09-29')).toBe('2026-09-29');
    expect(await attendance.resolveDate(' 2026-09-29 ')).toBe('2026-09-29');
    expect(await attendance.resolveDate('2026-10-01')).toBe('2026-09-30');
    expect(await attendance.resolveDate(undefined)).toBe('2026-09-30');
    for (const bad of ['2026-02-30', "';", 'abc', '2026-9-1', '2026-13-45']) {
      expect(await attendance.resolveDate(bad)).toBe('2026-09-30');
    }
  });
});
