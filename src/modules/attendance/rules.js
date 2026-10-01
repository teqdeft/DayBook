// Pure attendance rules shared by the service files: late minutes, present time and the "where"
// status a row shows. No database access here.
import { env } from '@/lib/env';
import {
  addDays,
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
  if (!row?.checkInAt) return 0;
  if (row.checkOutAt) return minutesBetween(row.checkInAt, row.checkOutAt);
  if (row.checkoutStatus === 'missing') return 0;
  let end = at ?? now();
  if (row.workDate) {
    const dayEnd = localToUtc(addDays(row.workDate, 1), '00:00', tz);
    if (dayEnd.isBefore(end)) end = dayEnd;
  }
  return minutesBetween(row.checkInAt, end);
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

/** Today's work date in the company time zone. */
export function todayFor(settings) {
  return localDate(settings.timezone);
}

/** A local clock time on a work date as a UTC Date. */
export function clockOn(date, clock, settings) {
  return localToUtc(date, clock, settings.timezone).toDate();
}
