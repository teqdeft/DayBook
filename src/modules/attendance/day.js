// The Attendance screen's read model for one day: everyone who tracks attendance with their row
// and their day (holidays, leave, the split: CONTRACT 25), the five numbers (guide 7.10) and the
// filters. Every read takes the `viewer`: anyone but an Admin never sees an Admin's attendance
// (company rule, hidesAdmins()). The Excel export lives in dayExport.js, HR's missing check-out
// list in missingHr.js.
import { can } from '@/lib/permissions';
import { addDays, isWorkingDay, now } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { effectiveLateMinutes, presenceOf } from './calendar';
import { holidaysBefore, loadCalendar, publicPerson } from './calendarReads';
import { checkoutEnteredFor } from './checkoutEntered';
import { dayMarks } from './marks';
import * as months from './monthExports';
import * as repo from './repo';
import {
  breakMinutesWithin,
  hidesAdmins,
  presentMinutes,
  showsAttendanceOf,
  todayFor,
} from './rules';
import { dateString } from './schemas';

const LOOK_BACK_DAYS = 14;

const MATCHES = {
  all: () => true,
  late: (item) => item.lateMinutes > 0,
  wfh: (item) => item.where === 'wfh',
  not_checked_in: (item) => item.where === 'not_checked_in',
  on_leave: (item) => Boolean(item.day?.leave),
  unverified: (item) => item.where === 'unverified',
  on_break: (item) => item.onBreakSince !== null && item.onBreakSince !== undefined,
};

/** Break and worked minutes of one row (CONTRACT 15); present is null when it isn't known. */
function timeOf(row, breaks, present, { at, tz, allowance }) {
  const breakMinutes = row ? breakMinutesWithin(breaks, row, at, tz) : 0;
  return {
    presentMinutes: present,
    breakMinutes,
    workedMinutes: present === null ? null : Math.max(0, present - breakMinutes),
    overAllowanceMinutes: allowance > 0 ? Math.max(0, breakMinutes - allowance) : 0,
  };
}

/** The start of today's open break of an open row (On break now), else null. */
function onBreakSinceOf(row, breaks, isToday) {
  if (!isToday || !row || row.checkOutAt || row.checkoutStatus !== 'open') return null;
  return breaks.find((item) => !item.endedAt)?.startedAt ?? null;
}

/** Who entered the check-out; the suggestion and the Check flag only for attendance.correct. */
function enteredByOf(entered, correct) {
  if (!entered) return null;
  const { by, at, self } = entered;
  return {
    id: by.id,
    name: by.name,
    at,
    self,
    pastLastSeen: correct ? entered.pastLastSeen : false,
    suggestedAt: correct ? entered.suggestedAt : null,
  };
}

/** The day a viewer sees: "WFH approved" only for attendance.correct (and system reads). */
function dayFor(calendar, person, date, correct) {
  const day = calendar.dayFor(person, date);
  return correct ? day : { ...day, wfhApproved: false };
}

async function loadDay(workDate, { calendar, leaveDetail }) {
  const [people, rows, breakRows, current, loaded] = await Promise.all([
    users.listActive({ tracksAttendance: true }),
    repo.listByDate(workDate),
    repo.listBreaksByDate(workDate),
    settings.getAll(),
    calendar ?? loadCalendar({ from: workDate, to: workDate, leaveDetail }),
  ]);
  const breaksByUser = new Map();
  for (const item of breakRows) {
    breaksByUser.set(item.userId, [...(breaksByUser.get(item.userId) ?? []), item]);
  }
  const entered = await checkoutEnteredFor(rows.map((row) => row.id));
  return { people, rows, breaksByUser, current, calendar: loaded, entered };
}

/**
 * Everyone who tracks attendance (active, joined by that day), each with their row and their day
 * for the date, in the order they were added to Daybook. Breaks are read with one query for the
 * date. Admins are left out unless the viewer is an Admin.
 * @param {string} workDate
 * @param {{ viewer?: { role: string, permissions?: string[] }, calendar?: Calendar,
 *   leaveDetail?: boolean }} [options] viewer = the signed-in person (none = everyone, a system
 *   read); calendar = a preloaded loadCalendar() covering the date; leaveDetail adds the leave's
 *   type and pay (only for attendance.correct viewers and system reads)
 * @returns {Promise<Array<{ user: object, attendance: AttendanceRow | null, day: PersonDay,
 *   where: 'office' | 'wfh' | 'unverified' | 'not_checked_in' | 'on_leave' | 'holiday' |
 *   'day_off', presentMinutes: number | null, breakMinutes: number,
 *   workedMinutes: number | null, overAllowanceMinutes: number, lateMinutes: number,
 *   marks: object, onBreakSince: Date | null, breakCount: number,
 *   checkoutEnteredBy: { id, name, at, self, pastLastSeen, suggestedAt } | null }>>}
 *   presentMinutes and workedMinutes are null without a row or for a missing check-out;
 *   lateMinutes is the effective late (0 on a day without a late mark); day.wfhApproved is false
 *   for viewers without attendance.correct
 */
export async function listDay(workDate, { viewer, calendar, leaveDetail = false } = {}) {
  const correct = !viewer || can(viewer, 'attendance.correct');
  const loaded = await loadDay(workDate, { calendar, leaveDetail: leaveDetail && correct });
  const { current, breaksByUser, entered } = loaded;
  const byUser = new Map(loaded.rows.map((row) => [row.userId, row]));
  const at = now();
  const context = { at, tz: current.timezone, allowance: current.breakAllowanceMinutes };
  const isToday = workDate === todayFor(current);
  return loaded.people
    .filter((person) => person.tracksAttendance !== false)
    .filter((person) => showsAttendanceOf(viewer, person))
    .filter((person) => !person.joinedOn || person.joinedOn <= workDate || byUser.has(person.id))
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const row = byUser.get(person.id) ?? null;
      const breaks = breaksByUser.get(person.id) ?? [];
      const day = dayFor(loaded.calendar, person, workDate, correct);
      const present =
        row && row.checkoutStatus !== 'missing' ? presentMinutes(row, at, context.tz) : null;
      const times = timeOf(row, breaks, present, context);
      return {
        user: publicPerson(person),
        attendance: row,
        day,
        where: presenceOf({ day, row, at, tz: context.tz }),
        ...times,
        lateMinutes: effectiveLateMinutes({ row, day }),
        marks: dayMarks({ row, day, worked: times.workedMinutes, settings: current }),
        onBreakSince: onBreakSinceOf(row, breaks, isToday),
        breakCount: breaks.length,
        checkoutEnteredBy: enteredByOf(row ? entered.get(row.id) : null, correct),
      };
    });
}

/**
 * Keeps the listDay() items that match a filter ('all' keeps everyone).
 * @param {object[]} items
 * @param {'all' | 'late' | 'wfh' | 'not_checked_in' | 'on_leave' | 'unverified' |
 *   'on_break'} filter
 */
export function filterDay(items, filter = 'all') {
  return items.filter(MATCHES[filter] ?? MATCHES.all);
}

/**
 * The day list filtered (GET /api/attendance), with paging. Each item adds `lateCount` ("4th
 * this month": { nth, label, title, alert }, null when not late).
 * @param {{ date: string, filter?: string, limit?: number, offset?: number,
 *   viewer?: { role: string } }} input filter as for filterDay(); viewer as for listDay()
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listForDay({ date, filter = 'all', limit = 100, offset = 0, viewer }) {
  const all = await listDay(date, { viewer, leaveDetail: true });
  const matching = filterDay(all, filter);
  const page = matching.slice(offset, offset + limit);
  const late = page.filter((item) => item.lateMinutes > 0).map((item) => item.user.id);
  const counts = late.length ? await months.lateCountsFor({ date, userIds: late }) : {};
  const items = page.map((item) => ({ ...item, lateCount: counts?.[item.user.id] ?? null }));
  return { items, total: matching.length };
}

/**
 * The days the "Missing check-out" number covers for a date: from the last working day before it
 * (holidays skipped like days the company doesn't work) to the day before it. On a Monday that is
 * Friday to Sunday, and on the Tuesday after a Monday holiday Friday to Monday, so weekend or
 * holiday work never hides Friday's missing check-outs. Without a working day in the 14 days
 * before, it is the day before.
 * @param {string} workDate
 * @param {number[]} workingDays ISO weekdays (Monday = 1), from settings
 * @param {Set<string> | string[]} [holidays] holiday dates to skip
 * @returns {{ from: string, to: string }}
 */
export function missingWindow(workDate, workingDays, holidays) {
  const to = addDays(workDate, -1);
  for (let back = 1; back <= LOOK_BACK_DAYS; back += 1) {
    const day = addDays(workDate, -back);
    if (isWorkingDay(day, workingDays, holidays)) return { from: day, to };
  }
  return { from: to, to };
}

/**
 * The five numbers and the filter counts for a day, from its list (tracked, active people only).
 * Late counts effective late; "Not checked in" only people expected now; `off` = no check-in
 * and on leave, a holiday or a day off.
 * @param {object[]} items from listDay()
 * @param {{ count: number, fromDate: string, days: number, total?: number }} missing from
 *   missingWindow() and repo.countMissingByDay(): rows still missing, the first day counted,
 *   days that have some; total = every row still to fix
 */
export function summarize(items, missing) {
  const present = items.filter((item) => item.attendance);
  const late = items.filter((item) => item.lateMinutes > 0);
  const lateTotal = late.reduce((sum, item) => sum + item.lateMinutes, 0);
  const count = (where) => items.filter((item) => item.where === where).length;
  const holiday = items.find((item) => item.day?.holiday)?.day.holiday ?? null;
  return {
    tracked: items.length,
    present: present.length,
    inOffice: count('office') + count('unverified'),
    wfh: count('wfh'),
    late: late.length,
    lateAverageMinutes: late.length ? Math.round(lateTotal / late.length) : 0,
    notCheckedIn: count('not_checked_in'),
    unverified: count('unverified'),
    onLeave: items.filter((item) => item.day?.leave).length,
    off: count('on_leave') + count('holiday') + count('day_off'),
    holiday: holiday ? { name: holiday.name } : null,
    onBreak: filterDay(items, 'on_break').length,
    missingCheckouts: missing.count,
    missingFromDate: missing.fromDate,
    missingDays: missing.days,
    missingTotal: missing.total ?? missing.count,
  };
}

/**
 * Numbers for a date (GET /api/attendance/summary and the Attendance KPIs). Missing check-outs
 * are the rows still marked missing from the days missingWindow() covers (holidays skipped),
 * among active people who track attendance; missingFromDate is the first of those days with one
 * (or the window's start when there are none), missingDays how many days have one and
 * missingTotal every row still to fix (the list's total). Admins count only for an Admin.
 * @param {string} workDate
 * @param {{ items?: object[], viewer?: { role: string } }} [options] items = listDay(workDate,
 *   { viewer }) when the caller already has it; viewer as for listDay()
 * @returns {Promise<{ date: string, tracked: number, present: number, inOffice: number,
 *   wfh: number, late: number, lateAverageMinutes: number, notCheckedIn: number,
 *   unverified: number, onLeave: number, off: number, holiday: { name: string } | null,
 *   onBreak: number, missingCheckouts: number, missingFromDate: string, missingDays: number,
 *   missingTotal: number }>}
 */
export async function getDaySummary(workDate, { items, viewer } = {}) {
  const [list, current, holidays] = await Promise.all([
    items ?? listDay(workDate, { viewer }),
    settings.getAll(),
    holidaysBefore(workDate),
  ]);
  const span = missingWindow(workDate, current.workingDays, holidays);
  const hideAdmins = hidesAdmins(viewer);
  const [perDay, total] = await Promise.all([
    repo.countMissingByDay(span.from, span.to, { hideAdmins }),
    repo.countMissing({ hideAdmins }),
  ]);
  const missing = {
    count: perDay.reduce((sum, day) => sum + day.count, 0),
    fromDate: perDay[0]?.workDate ?? span.from,
    days: perDay.length,
    total,
  };
  return { date: workDate, ...summarize(list, missing) };
}

/**
 * The date a screen asks for, clamped to today (no future days). Anything that isn't a real
 * 'YYYY-MM-DD' calendar date (pages pass the raw ?date= value) falls back to today.
 * @param {string | null | undefined} date
 * @returns {Promise<string>}
 */
export async function resolveDate(date) {
  const today = todayFor(await settings.getAll());
  const parsed = dateString().safeParse(date);
  if (!parsed.success) return today;
  return parsed.data > today ? today : parsed.data;
}
