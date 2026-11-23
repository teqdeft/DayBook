// The person's day (CONTRACT 25): what Daybook expects of one person on one date, from the
// weekday, the company holidays, HR's leave and the person's own shift. One pure rule that every
// job and screen asks, so the day page, the month view, the reminders and the summaries agree.
// No database here and nothing server-only: client components may import the constants
// (PART_LABELS, LEAVE_TYPE_LABELS), an exception to CONTRACT 2 like reports/todoText.
import {
  clockToMinutes,
  isoWeekday,
  lateMinutesFor,
  normalizeClock,
  toLocal,
  workDate as localDate,
} from '@/lib/time';

export const LEAVE_PARTS = ['full', 'first_half', 'second_half'];
export const LEAVE_TYPES = ['casual', 'sick', 'other'];
export const LEAVE_TYPE_LABELS = { casual: 'Casual', sick: 'Sick', other: 'Other' };
export const PART_LABELS = {
  full: 'Full day',
  first_half: 'First half',
  second_half: 'Second half',
};

const LEAVE_LABELS = {
  full: 'On leave',
  first_half: 'On leave, first half',
  second_half: 'On leave, second half',
};

const LAST_MINUTE = 23 * 60 + 59;

/** 'HH:mm' for minutes after midnight. */
function clockOf(minutes) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The company's grace: late_after minus office_start when it is later (never below 0). */
function graceMinutes(settings) {
  if (!settings.officeStart) return 0;
  return Math.max(0, clockToMinutes(settings.lateAfter) - clockToMinutes(settings.officeStart));
}

/**
 * When a check-in starts counting as late, 'HH:mm' in company time: late_after, or for someone
 * with their own shift start, that start plus the company's grace (late_after minus office_start
 * when it is later: Late after 9:35 with the office at 9:30 gives everyone 5 minutes, so a 10:00
 * shift is late from 10:05). Never past 23:59.
 * @param {{ shiftStart?: string | null,
 *   settings: { lateAfter: string, officeStart?: string } }} input
 * @returns {string}
 */
export function lateMarkFor({ shiftStart, settings }) {
  if (!shiftStart) return normalizeClock(settings.lateAfter);
  return clockOf(Math.min(clockToMinutes(shiftStart) + graceMinutes(settings), LAST_MINUTE));
}

/**
 * The "Where" status a row shows: office, wfh, unverified (office without the office network)
 * or not_checked_in.
 * @param {{ location: string, officeVerified: boolean } | null} row
 */
export function whereOf(row) {
  if (!row) return 'not_checked_in';
  if (row.location === 'office') return row.officeVerified ? 'office' : 'unverified';
  return 'wfh';
}

/** The person's own shift, else the office hours, as 'HH:mm' (both ends). */
function shiftOf(person, settings) {
  return {
    start: normalizeClock(person?.shiftStart || settings.officeStart),
    end: normalizeClock(person?.shiftEnd || settings.officeEnd),
  };
}

/**
 * The half-day split: the middle of the person's own shift (else the office hours), rounded
 * down to the minute. 9:30 to 6:30 gives '14:00'. A shift whose end isn't after its start falls
 * back to the office hours.
 * @param {{ person?: { shiftStart?: string | null, shiftEnd?: string | null } | null,
 *   settings: { officeStart: string, officeEnd: string } }} input
 * @returns {string} 'HH:mm'
 */
export function halfDayAt({ person, settings }) {
  let { start, end } = shiftOf(person, settings);
  if (clockToMinutes(end) <= clockToMinutes(start)) {
    start = normalizeClock(settings.officeStart);
    end = normalizeClock(settings.officeEnd);
  }
  return clockOf(Math.floor((clockToMinutes(start) + clockToMinutes(end)) / 2));
}

function isEmployed(person, date) {
  if (!person || person.tracksAttendance === false) return false;
  if (person.joinedOn && person.joinedOn > date) return false;
  return !(person.leftOn && date > person.leftOn);
}

/** The leave a PersonDay carries: { id, part }, plus paid and leaveType with leaveDetail. */
function leaveOf(leave, leaveDetail) {
  const part = LEAVE_PARTS.includes(leave.part) ? leave.part : 'full';
  if (!leaveDetail) return { id: leave.id, part };
  return { id: leave.id, part, paid: leave.paid !== false, leaveType: leave.leaveType ?? 'casual' };
}

function labelOf({ weekday, holiday, isWorkingDay, employed, leave }) {
  if (!isWorkingDay) return holiday && weekday ? `Holiday: ${holiday.name}` : 'Day off';
  return employed && leave ? LEAVE_LABELS[leave.part] : null;
}

/**
 * What Daybook expects of one person on one date (CONTRACT 25, PersonDay).
 * @param {{ date: string, person: { id?: number, role?: string, tracksAttendance?: boolean,
 *   joinedOn?: string | null, leftOn?: string | null, shiftStart?: string | null,
 *   shiftEnd?: string | null }, settings: { workingDays: number[], officeStart: string,
 *   officeEnd: string, lateAfter: string }, holiday?: { id: number, name: string } | null,
 *   leave?: { id: number, part: string, paid?: boolean, leaveType?: string } | null,
 *   wfhApproved?: boolean, leaveDetail?: boolean }} input leaveDetail adds the leave's paid and
 *   leaveType (attendance.correct viewers and the person only)
 * @returns {PersonDay} { date, weekday, holiday, isWorkingDay, employed, leftOn, leave,
 *   wfhApproved, expected, shiftStart, shiftEnd, split, expectedStart, expectedEnd, dayEnd,
 *   lateMark, label }
 */
export function personDay({
  date,
  person,
  settings,
  holiday = null,
  leave = null,
  wfhApproved = false,
  leaveDetail = false,
}) {
  const weekday = settings.workingDays.includes(isoWeekday(date));
  const isWorkingDay = weekday && !holiday;
  const employed = isEmployed(person, date);
  const dayLeave = isWorkingDay && employed && leave ? leaveOf(leave, leaveDetail) : null;
  const shift = shiftOf(person, settings);
  const split = halfDayAt({ person, settings });
  let expected = isWorkingDay && employed ? 1 : 0;
  if (dayLeave) expected = dayLeave.part === 'full' ? 0 : 0.5;
  const expectedStart =
    expected === 0 ? null : dayLeave?.part === 'first_half' ? split : shift.start;
  const expectedEnd = expected === 0 ? null : dayLeave?.part === 'second_half' ? split : shift.end;
  let lateMark = null;
  if (expected > 0) {
    lateMark =
      dayLeave?.part === 'first_half'
        ? clockOf(Math.min(clockToMinutes(split) + graceMinutes(settings), LAST_MINUTE))
        : lateMarkFor({ shiftStart: person?.shiftStart, settings });
  }
  return {
    date,
    weekday,
    holiday: holiday ? { id: holiday.id, name: holiday.name } : null,
    isWorkingDay,
    employed,
    leftOn: person?.leftOn ?? null, // the leaver's last day (dayCounts: never absent on it)
    leave: dayLeave,
    wfhApproved: Boolean(wfhApproved),
    expected,
    shiftStart: shift.start,
    shiftEnd: shift.end,
    split,
    expectedStart,
    expectedEnd,
    dayEnd: expectedEnd ?? shift.end,
    lateMark,
    label: labelOf({ weekday, holiday, isWorkingDay, employed, leave: dayLeave }),
  };
}

/**
 * What the Where column and every "Not checked in" count say about a person at a moment:
 * the check-in's place when there is a row, else holiday, day_off, on_leave, or not_checked_in
 * only when the person is expected now. First-half leave reads on_leave until the split, today
 * only (`at` in company time on the day's own date).
 * @param {{ day: PersonDay, row?: { location: string, officeVerified: boolean } | null,
 *   at?: Date | string | import('dayjs').Dayjs, tz?: string }} input
 * @returns {'office' | 'wfh' | 'unverified' | 'not_checked_in' | 'on_leave' | 'holiday' |
 *   'day_off'}
 */
export function presenceOf({ day, row, at, tz }) {
  if (row) return whereOf(row);
  if (day.holiday && day.weekday) return 'holiday';
  if (!day.isWorkingDay || !day.employed) return 'day_off';
  if (day.leave?.part === 'full') return 'on_leave';
  if (day.leave?.part === 'first_half' && at && tz && localDate(tz, at) === day.date) {
    const clock = toLocal(at, tz).format('HH:mm');
    if (clockToMinutes(clock) < clockToMinutes(day.expectedStart)) return 'on_leave';
  }
  return 'not_checked_in';
}

/** 1 for full-day leave, 0.5 for a half, 0 without leave. */
export function leaveFraction(day) {
  if (!day?.leave) return 0;
  return day.leave.part === 'full' ? 1 : 0.5;
}

const NO_COUNTS = {
  expected: 0,
  present: 0,
  office: 0,
  wfh: 0,
  dayOffWorked: 0,
  holiday: 0,
  leave: 0,
  leavePaid: 0,
  leaveUnpaid: 0,
  absent: 0,
  conflict: null,
};

/**
 * One person's day counted for the month view, the person month and the AI HR notes (halves
 * allowed). Per past working day while employed: present + leave + absent = 1. A check-in on a
 * full-day leave day wins (present 1, leave 0) and is flagged `conflict 'leave_and_checkin'`. A
 * leaver's last day without a row counts nothing (never absent).
 * @param {{ day: PersonDay, row?: { location: string } | null, past: boolean }} input past =
 *   the date is before today (today is never absent)
 * @returns {{ expected: number, present: number, office: number, wfh: number,
 *   dayOffWorked: number, holiday: number, leave: number, leavePaid: number,
 *   leaveUnpaid: number, absent: number, conflict: 'leave_and_checkin' | null }}
 */
export function dayCounts({ day, row, past }) {
  if (!day.employed) return { ...NO_COUNTS };
  if (!row && day.date === day.leftOn) return { ...NO_COUNTS };
  if (!day.isWorkingDay) {
    return {
      ...NO_COUNTS,
      dayOffWorked: row ? 1 : 0,
      holiday: day.holiday && day.weekday ? 1 : 0,
    };
  }
  const f = leaveFraction(day);
  const counts = { ...NO_COUNTS, expected: day.expected };
  if (row) {
    counts.present = f === 1 ? 1 : 1 - f;
    counts.leave = f === 1 ? 0 : f;
    counts.conflict = f === 1 ? 'leave_and_checkin' : null;
    const office = row.location === 'office';
    counts.office = office ? counts.present : 0;
    counts.wfh = office ? 0 : counts.present;
  } else {
    counts.leave = f;
    counts.absent = past ? 1 - f : 0;
  }
  const paid = day.leave?.paid !== false;
  counts.leavePaid = paid ? counts.leave : 0;
  counts.leaveUnpaid = paid ? 0 : counts.leave;
  return counts;
}

/**
 * Late minutes for a check-in on a person's day: whole minutes after `day.lateMark`; 0 when the
 * day has no late mark (not a working day, full-day leave, not employed).
 * @param {{ checkInAt: Date | string, day: PersonDay, settings: { timezone: string } }} input
 * @returns {number}
 */
export function lateMinutesForDay({ checkInAt, day, settings }) {
  if (day.lateMark === null || !checkInAt) return 0;
  return lateMinutesFor({
    checkInAt,
    date: day.date,
    lateAfter: day.lateMark,
    tz: settings.timezone,
  });
}

/**
 * The late minutes a day counts with: the stored ones, 0 whenever the day has no late mark.
 * @param {{ row?: { lateMinutes: number } | null, day: PersonDay }} input
 * @returns {number}
 */
export function effectiveLateMinutes({ row, day }) {
  if (!row || day.lateMark === null) return 0;
  return row.lateMinutes ?? 0;
}
