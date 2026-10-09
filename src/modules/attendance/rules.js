// Pure attendance rules shared by the service files: late minutes, present and worked time, and
// the "where" status a row shows. No database access here.
import { env } from '@/lib/env';
import {
  addDays,
  dayjs,
  isWorkingDay,
  lateMinutesFor,
  localToUtc,
  minutesBetween,
  now,
  workDate as localDate,
} from '@/lib/time';

/**
 * Late minutes for a check-in (guide 7.2.4): whole minutes after the person's own shift start, or
 * after late_after when they have none; 0 on a day that is not a working day.
 * @param {{ checkInAt: Date, workDate: string, shiftStart?: string | null,
 *   settings: { lateAfter: string, timezone: string, workingDays: number[] } }} input
 * @returns {number}
 */
export function computeLateMinutes({ checkInAt, workDate, shiftStart, settings }) {
  return lateMinutesFor({
    checkInAt,
    date: workDate,
    lateAfter: shiftStart || settings.lateAfter,
    tz: settings.timezone,
    workingDays: settings.workingDays,
  });
}

/** True when the date is one of the company's working days. */
export function workingDayFlag(date, settings) {
  return isWorkingDay(date, settings.workingDays);
}

/**
 * The present window of a row: check-in to check-out, or to `at` (default now) for an open row,
 * never past the end of its work date. null when present time counts 0 (no check-in, or a row
 * marked missing: nobody knows when the person left).
 * @param {{ checkInAt: Date | string | null, checkOutAt?: Date | string | null,
 *   checkoutStatus?: string, workDate?: string } | null | undefined} row
 * @param {Date | string | import('dayjs').Dayjs} [at]
 * @param {string} [tz] company time zone (defaults to DEFAULT_TIMEZONE)
 * @returns {{ from: import('dayjs').Dayjs, to: import('dayjs').Dayjs } | null}
 */
export function presentWindow(row, at, tz = env.DEFAULT_TIMEZONE) {
  if (!row?.checkInAt) return null;
  const from = dayjs(row.checkInAt);
  if (row.checkOutAt) return { from, to: dayjs(row.checkOutAt) };
  if (row.checkoutStatus === 'missing') return null;
  let to = dayjs(at ?? now());
  if (row.workDate) {
    const dayEnd = localToUtc(addDays(row.workDate, 1), '00:00', tz);
    if (dayEnd.isBefore(to)) to = dayEnd;
  }
  return { from, to };
}

/**
 * Present time in whole minutes: check-out (or `at`, default now) minus check-in. A row that was
 * marked missing counts 0 (nobody knows when the person left). An open row from an earlier day
 * counts up to the end of its work date, never into the next day.
 * @param {{ checkInAt: Date | string | null, checkOutAt?: Date | string | null,
 *   checkoutStatus?: string, workDate?: string } | null | undefined} row
 * @param {Date | string | import('dayjs').Dayjs} [at]
 * @param {string} [tz] company time zone (defaults to DEFAULT_TIMEZONE)
 * @returns {number}
 */
export function presentMinutes(row, at, tz = env.DEFAULT_TIMEZONE) {
  const window = presentWindow(row, at, tz);
  return window ? minutesBetween(window.from, window.to) : 0;
}

/**
 * Break time inside the present window, in whole minutes (CONTRACT 15): each break
 * [startedAt, endedAt ?? at] clipped to the window of presentWindow(), overlapping breaks counted
 * once. A break before check-in or after check-out counts only the part inside; a missing
 * check-out counts 0.
 * @param {Array<{ startedAt: Date | string, endedAt?: Date | string | null }>} breaks
 * @param {object | null | undefined} row AttendanceRow
 * @param {Date | string | import('dayjs').Dayjs} [at] default now
 * @param {string} [tz] company time zone (defaults to DEFAULT_TIMEZONE)
 * @returns {number}
 */
export function breakMinutesWithin(breaks, row, at, tz = env.DEFAULT_TIMEZONE) {
  const window = presentWindow(row, at, tz);
  if (!window || !breaks?.length) return 0;
  const end = dayjs(at ?? now()).valueOf();
  const spans = breaks
    .map((item) => [
      Math.max(dayjs(item.startedAt).valueOf(), window.from.valueOf()),
      Math.min(item.endedAt ? dayjs(item.endedAt).valueOf() : end, window.to.valueOf()),
    ])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reached = -Infinity;
  for (const [from, to] of spans) {
    const start = Math.max(from, reached);
    if (to > start) total += to - start;
    reached = Math.max(reached, to);
  }
  return Math.floor(total / 60000);
}

/**
 * Worked time in whole minutes: present time minus breaks, never below 0 (CONTRACT 15).
 * @param {object | null | undefined} row AttendanceRow
 * @param {Array<{ startedAt: Date | string, endedAt?: Date | string | null }>} breaks
 * @param {Date | string | import('dayjs').Dayjs} [at] default now
 * @param {string} [tz] company time zone (defaults to DEFAULT_TIMEZONE)
 * @returns {number}
 */
export function workedMinutes(row, breaks, at, tz = env.DEFAULT_TIMEZONE) {
  const when = at ?? now();
  return Math.max(0, presentMinutes(row, when, tz) - breakMinutesWithin(breaks, row, when, tz));
}

/**
 * When a break still open from an earlier day ends: the row's check-out when it is after the
 * break's start, else the break's own start (it then counts 0).
 * @param {{ startedAt: Date | string }} item BreakRow
 * @param {{ checkOutAt?: Date | string | null } | null | undefined} row AttendanceRow
 * @returns {Date}
 */
export function forgottenBreakEnd(item, row) {
  const start = dayjs(item.startedAt);
  const out = row?.checkOutAt ? dayjs(row.checkOutAt) : null;
  return (out && out.isAfter(start) ? out : start).toDate();
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

/**
 * Now as a Date cut to the whole second: DATETIME columns keep no fractions (MySQL rounds,
 * MariaDB truncates), so a break and the timer it stops are saved at the same moment.
 */
export function nowToSecond() {
  return now().startOf('second').toDate();
}

/** Today's work date in the company time zone. */
export function todayFor(settings) {
  return localDate(settings.timezone);
}

/** A local clock time on a work date as a UTC Date. */
export function clockOn(date, clock, settings) {
  return localToUtc(date, clock, settings.timezone).toDate();
}
