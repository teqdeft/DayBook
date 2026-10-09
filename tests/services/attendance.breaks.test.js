// Breaks (CONTRACT 15): Start break / End break, worked time, the allowance notice, check-out
// ending a break, the midnight close and the day view columns. The timers module is mocked: its
// calls are asserted here, and the real pair is tested once both sides are built.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { reports } from '@/modules/reports';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';

vi.mock('@/modules/timers', () => ({
  timers: {
    canUse: vi.fn(() => true),
    stopRunning: vi.fn(async () => null),
    resumeAfterBreak: vi.fn(async () => null),
  },
}));

vi.mock('@/modules/reports', () => ({
  reports: {
    getDayStatus: vi.fn(async () => ({ reportId: null, status: 'none', totalMinutes: 0 })),
  },
}));

const TZ = 'Asia/Kolkata';
const TODAY = '2026-09-30';
const YESTERDAY = '2026-09-29';
const HOME_IP = '198.51.100.7';
const BREAK_KEYS = [
  'attendanceId',
  'endReason',
  'endedAt',
  'id',
  'pausedEntryId',
  'startedAt',
  'userId',
  'workDate',
];

// A clock in India (UTC+5:30) on a date, as an ISO string.
const at = (clock, date = TODAY) => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d.toISOString();
};
const when = (clock, date) => new Date(at(clock, date));

let pm;
let project;

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return 'OK';
}

/** A tracked employee checked in today at `clock`. */
async function checkedIn(clock = '09:30', overrides = {}) {
  const user = await createUser(overrides);
  setNowForTests(at(clock));
  const row = await attendance.checkIn({ user, ip: HOME_IP });
  return { user, row };
}

/** A timer entry the (mocked) stopRunning "stopped", so paused_entry_id has a real row. */
async function stoppedEntry(user, from, to) {
  const [id] = await db('timeEntries').insert({
    userId: user.id,
    workDate: TODAY,
    projectId: project.id,
    startedAt: when(from),
    endedAt: when(to),
    source: 'timer',
    stopReason: 'break',
  });
  return id;
}

/** An attendance row inserted as-is (times are local clocks). */
async function insertRow(user, date, { in: inAt, out = null, ...rest }) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: when(inAt, date),
    checkOutAt: out ? when(out, date) : null,
    location: 'wfh',
    checkoutStatus: out ? 'checked_out' : 'open',
    ...rest,
  });
  return id;
}

async function insertBreak(user, attendanceId, date, from, to = null) {
  const [id] = await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId,
    workDate: date,
    startedAt: when(from, date),
    endedAt: to ? when(to, date) : null,
    endReason: to ? 'self' : null,
  });
  return id;
}

function notices(user) {
  return db('notifications')
    .where({ userId: user.id, type: 'attendance.break_over_allowance' })
    .select('title', 'body', 'link');
}

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  project = await createProject(pm, { name: 'acme-app', color: 'teal' });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await setSettings({ break_allowance_minutes: 60, working_days: [1, 2, 3, 4, 5] });
  setNowForTests(at('09:30'));
});

describe('worked time rules', () => {
  const row = {
    workDate: TODAY,
    checkInAt: when('09:00'),
    checkOutAt: when('18:00'),
    checkoutStatus: 'checked_out',
  };
  const span = (from, to) => ({ startedAt: when(from), endedAt: to ? when(to) : null });

  it('counts each break inside the present window, overlapping breaks once', () => {
    const breaks = [span('12:00', '13:00'), span('12:30', '13:30'), span('15:00', '15:15')];
    expect(attendance.breakMinutesWithin(breaks, row, when('19:00'), TZ)).toBe(105);
    expect(attendance.workedMinutes(row, breaks, when('19:00'), TZ)).toBe(540 - 105);
  });

  it('clips breaks before check-in and after check-out', () => {
    const breaks = [span('08:30', '09:15'), span('17:50', '18:30'), span('07:00', '08:00')];
    expect(attendance.breakMinutesWithin(breaks, row, when('19:00'), TZ)).toBe(15 + 10);
  });

  it('runs an open break to now, never past the check-out', () => {
    const open = { ...row, checkOutAt: null, checkoutStatus: 'open' };
    expect(attendance.breakMinutesWithin([span('17:00')], open, when('17:40'), TZ)).toBe(40);
    expect(attendance.workedMinutes(open, [span('17:00')], when('17:40'), TZ)).toBe(520 - 40);
    expect(attendance.breakMinutesWithin([span('17:30')], row, when('19:00'), TZ)).toBe(30);
  });

  it('stops an open row from an earlier day at the end of that day', () => {
    const late = {
      workDate: YESTERDAY,
      checkInAt: when('20:00', YESTERDAY),
      checkOutAt: null,
      checkoutStatus: 'open',
    };
    const breaks = [{ startedAt: when('23:30', YESTERDAY), endedAt: null }];
    expect(attendance.breakMinutesWithin(breaks, late, when('10:00'), TZ)).toBe(30);
    expect(attendance.workedMinutes(late, breaks, when('10:00'), TZ)).toBe(240 - 30);
  });

  it('counts 0 for a missing check-out or no row, and worked time never goes below 0', () => {
    const missing = { ...row, checkOutAt: null, checkoutStatus: 'missing' };
    const breaks = [span('12:00', '13:00')];
    expect(attendance.breakMinutesWithin(breaks, missing, when('19:00'), TZ)).toBe(0);
    expect(attendance.workedMinutes(missing, breaks, when('19:00'), TZ)).toBe(0);
    expect(attendance.breakMinutesWithin(breaks, null, when('19:00'), TZ)).toBe(0);
    expect(attendance.workedMinutes(null, breaks, when('19:00'), TZ)).toBe(0);
    const short = { ...row, checkOutAt: when('09:30') };
    expect(attendance.workedMinutes(short, [span('08:00', '10:00')], when('19:00'), TZ)).toBe(0);
  });
});

describe('start break', () => {
  it('stops the running timer and keeps its id on the break', async () => {
    const { user, row } = await checkedIn('09:30');
    const entryId = await stoppedEntry(user, '09:45', '13:10');
    timers.stopRunning.mockResolvedValueOnce({ id: entryId });
    setNowForTests(at('13:10'));
    const result = await attendance.startBreak({ user });
    expect(timers.stopRunning).toHaveBeenCalledWith(
      { userId: user.id, at: when('13:10'), reason: 'break' },
      expect.anything(),
    );
    expect(result.pausedEntryId).toBe(entryId);
    expect(Object.keys(result.break).sort()).toEqual(BREAK_KEYS);
    expect(result.break).toMatchObject({
      userId: user.id,
      attendanceId: row.id,
      workDate: TODAY,
      endedAt: null,
      endReason: null,
      pausedEntryId: entryId,
    });
    expect(result.break.startedAt.toISOString()).toBe(at('13:10'));
    expect(await attendance.getOpenBreak(user.id)).toEqual(result.break);
  });

  it('saves no paused timer when none was running', async () => {
    const { user } = await checkedIn('09:30');
    setNowForTests(at('11:00'));
    const result = await attendance.startBreak({ user });
    expect(result.pausedEntryId).toBeNull();
    expect(result.break.pausedEntryId).toBeNull();
  });

  it('needs an open check-in today and no break already on', async () => {
    const absent = await createUser();
    expect(await code(attendance.startBreak({ user: absent }))).toBe('NOT_CHECKED_IN');

    const { user } = await checkedIn('09:30');
    setNowForTests(at('18:00'));
    await attendance.checkOut({ user, ip: HOME_IP });
    expect(await code(attendance.startBreak({ user }))).toBe('ALREADY_CHECKED_OUT');

    const { user: other } = await checkedIn('09:30');
    setNowForTests(at('12:00'));
    await attendance.startBreak({ user: other });
    expect(await code(attendance.startBreak({ user: other }))).toBe('ALREADY_ON_BREAK');
    expect(await attendance.listBreaks(other.id, TODAY)).toHaveLength(1);
  });

  it('is only for tracked people who check in (never PMs or an untracked Admin)', async () => {
    expect(await code(attendance.startBreak({ user: pm }))).toBe('FORBIDDEN');
    const admin = await createUser({ role: 'admin', tracksAttendance: false });
    expect(await code(attendance.startBreak({ user: admin }))).toBe('FORBIDDEN');
    const left = await createUser({ status: 'deactivated' });
    expect(await code(attendance.startBreak({ user: left }))).toBe('FORBIDDEN');
  });

  it('allows one break when two taps arrive at once', async () => {
    const { user } = await checkedIn('09:30');
    setNowForTests(at('12:00'));
    const results = await Promise.all([
      code(attendance.startBreak({ user })),
      code(attendance.startBreak({ user })),
    ]);
    expect(results.sort()).toEqual(['ALREADY_ON_BREAK', 'OK']);
    expect(await attendance.listBreaks(user.id, TODAY)).toHaveLength(1);
  });

  it('turns a duplicate open break (errno 1062) into ALREADY_ON_BREAK and saves nothing', async () => {
    const { user, row } = await checkedIn('09:30');
    setNowForTests(at('12:00'));
    // Another break slips in after the check, inside the same moment.
    timers.stopRunning.mockImplementationOnce(async ({ userId }, trx) => {
      await trx('attendanceBreaks').insert({
        userId,
        attendanceId: row.id,
        workDate: TODAY,
        startedAt: when('11:59'),
      });
      return null;
    });
    expect(await code(attendance.startBreak({ user }))).toBe('ALREADY_ON_BREAK');
    expect(await attendance.listBreaks(user.id, TODAY)).toEqual([]);
  });

  it('first closes a break left open from an earlier day by the midnight rule', async () => {
    const user = await createUser();
    const yesterday = await insertRow(user, YESTERDAY, { in: '09:00', out: '18:00' });
    const old = await insertBreak(user, yesterday, YESTERDAY, '17:50');
    setNowForTests(at('09:30'));
    await attendance.checkIn({ user, ip: HOME_IP });
    expect((await attendance.getOpenBreak(user.id)).id).toBe(old);
    setNowForTests(at('11:00'));
    const { break: started } = await attendance.startBreak({ user });
    const [closed] = await attendance.listBreaks(user.id, YESTERDAY);
    expect(closed).toMatchObject({ id: old, endReason: 'midnight' });
    expect(closed.endedAt.toISOString()).toBe(at('18:00', YESTERDAY));
    expect((await attendance.getOpenBreak(user.id)).id).toBe(started.id);
  });
});

describe('end break', () => {
  it('ends the break and starts the paused timer again', async () => {
    const { user } = await checkedIn('09:30');
    const entryId = await stoppedEntry(user, '09:45', '13:10');
    timers.stopRunning.mockResolvedValueOnce({ id: entryId });
    setNowForTests(at('13:10'));
    await attendance.startBreak({ user });
    setNowForTests(at('13:55'));
    const result = await attendance.endBreak({ user });
    expect(timers.resumeAfterBreak).toHaveBeenCalledWith(
      { userId: user.id, entryId, at: when('13:55') },
      expect.anything(),
    );
    expect(result).toMatchObject({ breakMinutesToday: 45, overAllowanceMinutes: 0 });
    expect(result.break).toMatchObject({ endReason: 'self', pausedEntryId: entryId });
    expect(result.break.endedAt.toISOString()).toBe(at('13:55'));
    expect(await attendance.getOpenBreak(user.id)).toBeNull();
  });

  it('starts no timer when the break paused none, and needs an open break', async () => {
    const { user } = await checkedIn('09:30');
    expect(await code(attendance.endBreak({ user }))).toBe('NOT_ON_BREAK');
    setNowForTests(at('11:00'));
    await attendance.startBreak({ user });
    setNowForTests(at('11:15'));
    expect((await attendance.endBreak({ user })).breakMinutesToday).toBe(15);
    expect(timers.resumeAfterBreak).not.toHaveBeenCalled();
    expect(await code(attendance.endBreak({ user }))).toBe('NOT_ON_BREAK');
  });

  it('tells the person once, when a break takes the day over the allowance', async () => {
    const { user } = await checkedIn('09:00');
    const takeBreak = async (from, to) => {
      setNowForTests(at(from));
      await attendance.startBreak({ user });
      setNowForTests(at(to));
      return attendance.endBreak({ user });
    };
    expect(await takeBreak('11:00', '11:50')).toMatchObject({
      breakMinutesToday: 50,
      overAllowanceMinutes: 0,
    });
    expect(await takeBreak('12:00', '12:10')).toMatchObject({ breakMinutesToday: 60 });
    expect(await notices(user)).toEqual([]); // exactly the allowance is not over it
    expect(await takeBreak('13:00', '13:15')).toMatchObject({
      breakMinutesToday: 75,
      overAllowanceMinutes: 15,
    });
    expect(await notices(user)).toEqual([
      {
        title: 'Your breaks today are over the 60 min allowance',
        body: "You've had 1h 15m of breaks today.",
        link: '/today',
      },
    ]);
    expect(await takeBreak('15:00', '15:10')).toMatchObject({
      breakMinutesToday: 85,
      overAllowanceMinutes: 25,
    });
    expect(await notices(user)).toHaveLength(1);
  });

  it('uses the allowance setting, and 0 means no allowance', async () => {
    await setSettings({ break_allowance_minutes: 30 });
    const { user } = await checkedIn('09:00');
    setNowForTests(at('12:00'));
    await attendance.startBreak({ user });
    setNowForTests(at('12:40'));
    expect(await attendance.endBreak({ user })).toMatchObject({ overAllowanceMinutes: 10 });
    expect((await notices(user))[0]).toEqual({
      title: 'Your breaks today are over the 30 min allowance',
      body: "You've had 40m of breaks today.",
      link: '/today',
    });

    await setSettings({ break_allowance_minutes: 0 });
    const { user: free } = await checkedIn('09:00');
    setNowForTests(at('12:00'));
    await attendance.startBreak({ user: free });
    setNowForTests(at('15:00'));
    expect(await attendance.endBreak({ user: free })).toMatchObject({
      breakMinutesToday: 180,
      overAllowanceMinutes: 0,
    });
    expect(await notices(free)).toEqual([]);
  });
});

describe('ending a break from elsewhere', () => {
  it('endOpenBreak ends it with the reason given and never starts a timer', async () => {
    const { user } = await checkedIn('09:30');
    const entryId = await stoppedEntry(user, '09:45', '12:00');
    timers.stopRunning.mockResolvedValueOnce({ id: entryId });
    setNowForTests(at('12:00'));
    await attendance.startBreak({ user });
    const ended = await db.transaction((trx) =>
      attendance.endOpenBreak({ userId: user.id, at: when('12:20'), reason: 'timer' }, trx),
    );
    expect(ended).toMatchObject({ endReason: 'timer', pausedEntryId: entryId });
    expect(ended.endedAt.toISOString()).toBe(at('12:20'));
    expect(timers.resumeAfterBreak).not.toHaveBeenCalled();
    const again = await db.transaction((trx) =>
      attendance.endOpenBreak({ userId: user.id, at: when('12:30'), reason: 'timer' }, trx),
    );
    expect(again).toBeNull();
  });

  it('check-out ends the break and stops the timer in the same moment, gap on worked time', async () => {
    const { user } = await checkedIn('09:30');
    setNowForTests(at('17:45'));
    await attendance.startBreak({ user });
    setNowForTests(at('18:30'));
    reports.getDayStatus.mockResolvedValueOnce({
      reportId: 3,
      status: 'submitted',
      totalMinutes: 540,
    });
    const result = await attendance.checkOut({ user, ip: HOME_IP });
    expect(result).toMatchObject({
      reportPending: false,
      presentMinutes: 540,
      breakMinutes: 45,
      workedMinutes: 495,
      loggedMinutes: 540,
      gapMinutes: 45,
      gapWarning: false,
    });
    expect(timers.stopRunning).toHaveBeenLastCalledWith(
      { userId: user.id, at: when('18:30'), reason: 'checkout' },
      expect.anything(),
    );
    expect(timers.resumeAfterBreak).not.toHaveBeenCalled();
    const [item] = await attendance.listBreaks(user.id, TODAY);
    expect(item.endReason).toBe('checkout');
    expect(item.endedAt.toISOString()).toBe(at('18:30'));
  });

  it('check-out changes nothing when stopping the timer fails', async () => {
    const { user, row } = await checkedIn('09:30');
    setNowForTests(at('17:45'));
    await attendance.startBreak({ user });
    setNowForTests(at('18:30'));
    timers.stopRunning.mockRejectedValueOnce(new Error('timer store down'));
    await expect(attendance.checkOut({ user, ip: HOME_IP })).rejects.toThrow('timer store down');
    expect(await attendance.getForUserOnDate(user.id, TODAY)).toMatchObject({
      id: row.id,
      checkOutAt: null,
      checkoutStatus: 'open',
    });
    expect((await attendance.getOpenBreak(user.id)).endedAt).toBeNull();
  });
});

describe('forgotten breaks (worker)', () => {
  it("ends yesterday's open breaks at the check-out, else at their own start", async () => {
    const [a, b, c, d] = [
      await createUser(),
      await createUser(),
      await createUser(),
      await createUser(),
    ];
    const outLater = await insertBreak(
      a,
      await insertRow(a, YESTERDAY, { in: '09:00', out: '18:00' }),
      YESTERDAY,
      '17:30',
    );
    // HR moved the check-out before the break started.
    const outBefore = await insertBreak(
      b,
      await insertRow(b, YESTERDAY, { in: '09:00', out: '17:00' }),
      YESTERDAY,
      '17:30',
    );
    const missing = await insertBreak(
      c,
      await insertRow(c, YESTERDAY, { in: '09:00', checkoutStatus: 'missing' }),
      YESTERDAY,
      '15:00',
    );
    const today = await insertBreak(d, await insertRow(d, TODAY, { in: '09:00' }), TODAY, '09:20');
    setNowForTests(at('00:10'));
    expect(await attendance.closeForgottenBreaks(TODAY)).toEqual({ closed: 3 });
    const read = (id) => db('attendanceBreaks').where({ id }).first();
    const ended = async (id) => {
      const item = await read(id);
      return [item.endReason, item.endedAt.toISOString()];
    };
    expect(await ended(outLater)).toEqual(['midnight', at('18:00', YESTERDAY)]);
    expect(await ended(outBefore)).toEqual(['midnight', at('17:30', YESTERDAY)]);
    expect(await ended(missing)).toEqual(['midnight', at('15:00', YESTERDAY)]);
    expect((await read(today)).endedAt).toBeNull();
    expect(await attendance.closeForgottenBreaks(TODAY)).toEqual({ closed: 0 });
  });
});

describe("today's state and the day view", () => {
  it('getMyToday adds the breaks, the open one, break and worked minutes', async () => {
    const { user } = await checkedIn('09:30');
    setNowForTests(at('11:00'));
    await attendance.startBreak({ user });
    setNowForTests(at('11:20'));
    await attendance.endBreak({ user });
    setNowForTests(at('13:00'));
    const { break: open } = await attendance.startBreak({ user });
    setNowForTests(at('13:30'));
    const today = await attendance.getMyToday({ user, ip: HOME_IP });
    expect(today).toMatchObject({
      workDate: TODAY,
      presentMinutes: 240,
      breakMinutes: 50,
      workedMinutes: 190,
    });
    expect(today.breaks.map((item) => item.endReason)).toEqual(['self', null]);
    expect(today.openBreak).toEqual(open);
  });

  it('listDay and the Excel export add breaks, worked time and the allowance', async () => {
    const date = '2026-09-23';
    const p1 = await createUser({ name: 'Day One' });
    const p2 = await createUser({ name: 'Day Two' });
    const p3 = await createUser({ name: 'Day Three' });
    const p4 = await createUser({ name: 'Day Four' });
    const r1 = await insertRow(p1, date, { in: '09:00', out: '18:00' });
    await insertBreak(p1, r1, date, '12:00', '13:00');
    await insertBreak(p1, r1, date, '15:00', '15:30');
    const r3 = await insertRow(p3, date, { in: '09:00', checkoutStatus: 'missing' });
    await insertBreak(p3, r3, date, '12:00', '13:00');
    const r4 = await insertRow(p4, date, { in: '10:00', out: '18:00' });
    await insertBreak(p4, r4, date, '09:30', '10:30');
    setNowForTests(at('10:00'));

    const items = await attendance.listDay(date);
    const pick = (user) => {
      const item = items.find((entry) => entry.user.id === user.id);
      const { presentMinutes, breakMinutes, workedMinutes, overAllowanceMinutes } = item;
      return { presentMinutes, breakMinutes, workedMinutes, overAllowanceMinutes };
    };
    expect(pick(p1)).toEqual({
      presentMinutes: 540,
      breakMinutes: 90,
      workedMinutes: 450,
      overAllowanceMinutes: 30,
    });
    expect(pick(p2)).toEqual({
      presentMinutes: null,
      breakMinutes: 0,
      workedMinutes: null,
      overAllowanceMinutes: 0,
    });
    expect(pick(p3)).toEqual({
      presentMinutes: null,
      breakMinutes: 0,
      workedMinutes: null,
      overAllowanceMinutes: 0,
    });
    expect(pick(p4)).toEqual({
      presentMinutes: 480,
      breakMinutes: 30,
      workedMinutes: 450,
      overAllowanceMinutes: 0,
    });

    const sheet = (await attendance.exportDay(date)).sheets[0];
    const headers = sheet.columns.map((column) => column.header);
    expect(
      headers.slice(headers.indexOf('Present (hours)'), headers.indexOf('Present (hours)') + 4),
    ).toEqual(['Present (hours)', 'Breaks (minutes)', 'Worked (hours)', 'Late (minutes)']);
    expect(sheet.columns.find((column) => column.key === 'workedHours').numFmt).toBe('0.00');
    const line = (user) => sheet.rows.find((row) => row.name === user.name);
    expect(line(p1)).toMatchObject({ presentHours: 9, breakMinutes: 90, workedHours: 7.5 });
    expect(line(p2)).toMatchObject({ presentHours: null, breakMinutes: null, workedHours: null });

    await setSettings({ break_allowance_minutes: 0 });
    const free = (await attendance.listDay(date)).find((entry) => entry.user.id === p1.id);
    expect(free.overAllowanceMinutes).toBe(0);
  });

  it('lists breaks for one person or for everyone on a date', async () => {
    const date = '2026-09-22';
    const p1 = await createUser();
    const p2 = await createUser();
    await insertBreak(
      p1,
      await insertRow(p1, date, { in: '09:00', out: '18:00' }),
      date,
      '14:00',
      '14:10',
    );
    await insertBreak(
      p2,
      await insertRow(p2, date, { in: '09:00', out: '18:00' }),
      date,
      '11:00',
      '11:05',
    );
    const mine = await attendance.listBreaks(p1.id, date);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(BREAK_KEYS);
    const all = await attendance.listBreaksForDate(date);
    expect(all.map((item) => item.userId)).toEqual([p1.id, p2.id]);
  });
});
