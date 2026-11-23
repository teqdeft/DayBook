// The person's day (CONTRACT 25): personDay, halfDayAt, presenceOf, dayCounts,
// effectiveLateMinutes and missingWindow with holidays. Pure, no database.
import { describe, expect, it } from 'vitest';
import {
  dayCounts,
  effectiveLateMinutes,
  halfDayAt,
  lateMinutesForDay,
  leaveFraction,
  personDay,
  presenceOf,
} from '@/modules/attendance/calendar';
import { missingWindow } from '@/modules/attendance/day';

const TZ = 'Asia/Kolkata';
const SETTINGS = {
  timezone: TZ,
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  lateAfter: '09:35',
};
const PERSON = { id: 7, role: 'employee', tracksAttendance: true, joinedOn: '2024-03-04' };
const THU = '2026-11-19';
const SAT = '2026-11-21';
const HOLIDAY = { id: 3, name: 'Guru Nanak Jayanti' };
const at = (clock, date = THU) => new Date(`${date}T${clock}:00+05:30`);

function dayOf(overrides = {}) {
  return personDay({ date: THU, person: PERSON, settings: SETTINGS, ...overrides });
}

describe('personDay', () => {
  it('expects a full working day on a weekday', () => {
    const day = dayOf();
    expect(day).toMatchObject({
      weekday: true,
      holiday: null,
      isWorkingDay: true,
      employed: true,
      leave: null,
      expected: 1,
      shiftStart: '09:30',
      shiftEnd: '18:30',
      split: '14:00',
      expectedStart: '09:30',
      expectedEnd: '18:30',
      dayEnd: '18:30',
      lateMark: '09:35',
      label: null,
    });
  });

  it('expects nothing at the weekend', () => {
    const day = dayOf({ date: SAT });
    expect(day).toMatchObject({
      weekday: false,
      isWorkingDay: false,
      expected: 0,
      label: 'Day off',
    });
    expect(day.lateMark).toBeNull();
    expect(day.expectedStart).toBeNull();
    expect(day.dayEnd).toBe('18:30');
  });

  it('a holiday on a weekday is not a working day; on a weekend it changes nothing', () => {
    const weekday = dayOf({ holiday: HOLIDAY });
    expect(weekday).toMatchObject({
      weekday: true,
      isWorkingDay: false,
      expected: 0,
      lateMark: null,
      holiday: HOLIDAY,
      label: 'Holiday: Guru Nanak Jayanti',
    });
    const weekend = dayOf({ date: SAT, holiday: HOLIDAY });
    expect(weekend).toMatchObject({ weekday: false, isWorkingDay: false, label: 'Day off' });
  });

  it('is not employed before joining or after leaving, but is on the day they left', () => {
    const before = dayOf({ person: { ...PERSON, joinedOn: '2026-11-20' } });
    expect(before).toMatchObject({ employed: false, expected: 0, lateMark: null });
    const after = dayOf({ person: { ...PERSON, leftOn: '2026-11-18' } });
    expect(after.employed).toBe(false);
    const lastDay = dayOf({ person: { ...PERSON, leftOn: THU } });
    expect(lastDay).toMatchObject({ employed: true, expected: 1, leftOn: THU });
    const untracked = dayOf({ person: { ...PERSON, tracksAttendance: false } });
    expect(untracked).toMatchObject({ employed: false, expected: 0 });
  });

  it('full, first-half and second-half leave', () => {
    const leave = { id: 9, part: 'full', paid: false, leaveType: 'sick', note: 'HR only' };
    const full = dayOf({ leave });
    expect(full).toMatchObject({ expected: 0, lateMark: null, label: 'On leave' });
    expect(full.leave).toEqual({ id: 9, part: 'full' }); // no leaveDetail: id and part only
    const detailed = dayOf({ leave, leaveDetail: true });
    expect(detailed.leave).toEqual({ id: 9, part: 'full', paid: false, leaveType: 'sick' });
    const first = dayOf({ leave: { id: 9, part: 'first_half' } });
    expect(first).toMatchObject({
      expected: 0.5,
      expectedStart: '14:00',
      expectedEnd: '18:30',
      dayEnd: '18:30',
      lateMark: '14:05', // the split plus the 5 minutes' grace
      label: 'On leave, first half',
    });
    const second = dayOf({ leave: { id: 9, part: 'second_half' } });
    expect(second).toMatchObject({
      expected: 0.5,
      expectedStart: '09:30',
      expectedEnd: '14:00',
      dayEnd: '14:00',
      lateMark: '09:35',
      label: 'On leave, second half',
    });
  });

  it('ignores leave on a holiday or a weekend', () => {
    const leave = { id: 9, part: 'full' };
    expect(dayOf({ leave, holiday: HOLIDAY }).leave).toBeNull();
    expect(dayOf({ leave, date: SAT }).leave).toBeNull();
  });

  it("uses the person's own shift", () => {
    const day = dayOf({ person: { ...PERSON, shiftStart: '10:00', shiftEnd: '19:00' } });
    expect(day).toMatchObject({
      shiftStart: '10:00',
      shiftEnd: '19:00',
      split: '14:30',
      lateMark: '10:05',
      dayEnd: '19:00',
    });
  });
});

describe('halfDayAt', () => {
  it('is the middle of the shift, rounded down to the minute', () => {
    expect(halfDayAt({ person: PERSON, settings: SETTINGS })).toBe('14:00');
    const own = { shiftStart: '10:00', shiftEnd: '19:00' };
    expect(halfDayAt({ person: own, settings: SETTINGS })).toBe('14:30');
    const odd = { shiftStart: '09:31', shiftEnd: '18:30' };
    expect(halfDayAt({ person: odd, settings: SETTINGS })).toBe('14:00');
  });

  it('falls back to the office hours for a shift ending before it starts', () => {
    const broken = { shiftStart: '19:00', shiftEnd: '10:00' };
    expect(halfDayAt({ person: broken, settings: SETTINGS })).toBe('14:00');
  });
});

describe('presenceOf', () => {
  const office = { location: 'office', officeVerified: true };

  it('follows the row first', () => {
    expect(presenceOf({ day: dayOf(), row: office })).toBe('office');
    expect(presenceOf({ day: dayOf({ holiday: HOLIDAY }), row: office })).toBe('office');
    const unverified = { location: 'office', officeVerified: false };
    expect(presenceOf({ day: dayOf(), row: unverified })).toBe('unverified');
    expect(presenceOf({ day: dayOf(), row: { location: 'wfh' } })).toBe('wfh');
  });

  it('holiday, day off, leave and not checked in without a row', () => {
    expect(presenceOf({ day: dayOf({ holiday: HOLIDAY }) })).toBe('holiday');
    expect(presenceOf({ day: dayOf({ date: SAT, holiday: HOLIDAY }) })).toBe('day_off');
    expect(presenceOf({ day: dayOf({ date: SAT }) })).toBe('day_off');
    const joinsLater = dayOf({ person: { ...PERSON, joinedOn: '2026-12-01' } });
    expect(presenceOf({ day: joinsLater })).toBe('day_off');
    expect(presenceOf({ day: dayOf({ leave: { id: 1, part: 'full' } }) })).toBe('on_leave');
    expect(presenceOf({ day: dayOf() })).toBe('not_checked_in');
    const second = dayOf({ leave: { id: 1, part: 'second_half' } });
    expect(presenceOf({ day: second, at: at('16:00'), tz: TZ })).toBe('not_checked_in');
  });

  it('first-half leave reads on leave until the split, today only', () => {
    const first = dayOf({ leave: { id: 1, part: 'first_half' } });
    expect(presenceOf({ day: first, at: at('11:00'), tz: TZ })).toBe('on_leave');
    expect(presenceOf({ day: first, at: at('14:00'), tz: TZ })).toBe('not_checked_in');
    // A past day: they were expected from the split.
    expect(presenceOf({ day: first, at: at('11:00', '2026-11-20'), tz: TZ })).toBe(
      'not_checked_in',
    );
  });
});

describe('dayCounts', () => {
  const office = { location: 'office' };
  const wfh = { location: 'wfh' };

  it('counts a plain working day', () => {
    expect(dayCounts({ day: dayOf(), row: office, past: true })).toMatchObject({
      expected: 1,
      present: 1,
      office: 1,
      wfh: 0,
      absent: 0,
    });
    expect(dayCounts({ day: dayOf(), row: null, past: true }).absent).toBe(1);
    expect(dayCounts({ day: dayOf(), row: null, past: false }).absent).toBe(0); // today
  });

  it('half-day leave without and with a check-in', () => {
    const half = dayOf({ leave: { id: 1, part: 'first_half', paid: true }, leaveDetail: true });
    expect(dayCounts({ day: half, row: null, past: true })).toMatchObject({
      leave: 0.5,
      leavePaid: 0.5,
      absent: 0.5,
      present: 0,
    });
    expect(dayCounts({ day: half, row: wfh, past: true })).toMatchObject({
      present: 0.5,
      wfh: 0.5,
      leave: 0.5,
      absent: 0,
      conflict: null,
    });
  });

  it('a check-in on a full-day leave day wins and is flagged', () => {
    const full = dayOf({ leave: { id: 1, part: 'full', paid: false }, leaveDetail: true });
    expect(dayCounts({ day: full, row: office, past: true })).toMatchObject({
      present: 1,
      leave: 0,
      absent: 0,
      conflict: 'leave_and_checkin',
    });
    expect(dayCounts({ day: full, row: null, past: true })).toMatchObject({
      leave: 1,
      leaveUnpaid: 1,
      leavePaid: 0,
      absent: 0,
    });
  });

  it('a holiday with a check-in is a day off worked, never present', () => {
    const holiday = dayOf({ holiday: HOLIDAY });
    expect(dayCounts({ day: holiday, row: office, past: true })).toMatchObject({
      dayOffWorked: 1,
      holiday: 1,
      present: 0,
      absent: 0,
    });
    expect(
      dayCounts({ day: dayOf({ date: SAT, holiday: HOLIDAY }), row: null, past: true }).holiday,
    ).toBe(0);
  });

  it("counts nothing before joining or on a leaver's last day without a row", () => {
    const before = dayOf({ person: { ...PERSON, joinedOn: '2026-12-01' } });
    expect(dayCounts({ day: before, row: null, past: true }).absent).toBe(0);
    const lastDay = dayOf({ person: { ...PERSON, leftOn: THU } });
    expect(
      Object.values(dayCounts({ day: lastDay, row: null, past: true })).filter(Boolean),
    ).toEqual([]);
    expect(dayCounts({ day: lastDay, row: office, past: true }).present).toBe(1);
  });

  it('leaveFraction', () => {
    expect(leaveFraction(dayOf())).toBe(0);
    expect(leaveFraction(dayOf({ leave: { id: 1, part: 'full' } }))).toBe(1);
    expect(leaveFraction(dayOf({ leave: { id: 1, part: 'second_half' } }))).toBe(0.5);
  });
});

describe('late minutes', () => {
  it('lateMinutesForDay uses the late mark of the day', () => {
    expect(lateMinutesForDay({ checkInAt: at('09:57'), day: dayOf(), settings: SETTINGS })).toBe(
      22,
    );
    const first = dayOf({ leave: { id: 1, part: 'first_half' } });
    expect(lateMinutesForDay({ checkInAt: at('14:10'), day: first, settings: SETTINGS })).toBe(5);
    const full = dayOf({ leave: { id: 1, part: 'full' } });
    expect(lateMinutesForDay({ checkInAt: at('13:00'), day: full, settings: SETTINGS })).toBe(0);
    const holiday = dayOf({ holiday: HOLIDAY });
    expect(lateMinutesForDay({ checkInAt: at('13:00'), day: holiday, settings: SETTINGS })).toBe(0);
  });

  it('effectiveLateMinutes is 0 on a day without a late mark', () => {
    const row = { lateMinutes: 22 };
    expect(effectiveLateMinutes({ row, day: dayOf() })).toBe(22);
    expect(effectiveLateMinutes({ row, day: dayOf({ holiday: HOLIDAY }) })).toBe(0);
    expect(effectiveLateMinutes({ row, day: dayOf({ leave: { id: 1, part: 'full' } }) })).toBe(0);
    expect(effectiveLateMinutes({ row: null, day: dayOf() })).toBe(0);
  });
});

describe('missingWindow', () => {
  it('skips a Monday holiday: the Tuesday after covers Friday to Monday', () => {
    expect(missingWindow('2026-11-24', [1, 2, 3, 4, 5], new Set(['2026-11-23']))).toEqual({
      from: '2026-11-20',
      to: '2026-11-23',
    });
    expect(missingWindow('2026-11-24', [1, 2, 3, 4, 5])).toEqual({
      from: '2026-11-23',
      to: '2026-11-23',
    });
    expect(missingWindow('2026-11-23', [1, 2, 3, 4, 5])).toEqual({
      from: '2026-11-20',
      to: '2026-11-22',
    });
  });
});
