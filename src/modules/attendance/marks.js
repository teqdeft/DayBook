// Half day, short day and left early (CONTRACT 25, item 3): worked out when read, never stored.
// Pure: no database. A day has at most one of Half day and Short day; Left early can come with
// either.
import { clockToMinutes, toLocal } from '@/lib/time';

const FINISHED = new Set(['checked_out', 'auto', 'corrected']);
const DEFAULTS = { halfDayUnderMinutes: 270, shortDayUnderMinutes: 480, leftEarlyGraceMinutes: 15 };

export const NO_MARKS = Object.freeze({
  halfDay: false,
  shortDay: false,
  leftEarly: false,
  leftEarlyMinutes: 0,
  underMinutes: null,
});

function setting(settings, key) {
  const value = Number(settings?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULTS[key];
}

/** Own shift ÷ office day, never above 1 (1 without an own shift or with a broken one). */
function shiftFactor(day, settings) {
  const own = clockToMinutes(day.shiftEnd) - clockToMinutes(day.shiftStart);
  const office = clockToMinutes(settings.officeEnd) - clockToMinutes(settings.officeStart);
  if (own <= 0 || office <= 0) return 1;
  return Math.min(1, own / office);
}

/**
 * The marks of one person's day.
 * - Only on a finished row (checked out, auto or corrected) of a working day with
 *   `day.expected > 0`; open rows and missing check-outs have none. A check-in on a full-day
 *   leave day (dayCounts' conflict) is marked as a full working day.
 * - factor = own shift ÷ office day (never above 1); half = halfDayUnderMinutes × factor;
 *   short = shortDayUnderMinutes × factor × expected (0.5 on half-day leave, which has no Half
 *   day mark).
 * - Left early = check-out more than leftEarlyGraceMinutes before `day.dayEnd` (the shift end, or
 *   the split on second-half leave); an auto check-out counts.
 * @param {{ row: { checkOutAt?: Date | string | null, checkoutStatus: string } | null,
 *   day: PersonDay, worked: number | null, settings: { officeStart: string, officeEnd: string,
 *   timezone: string, halfDayUnderMinutes?: number, shortDayUnderMinutes?: number,
 *   leftEarlyGraceMinutes?: number } }} input worked = present minus breaks, in minutes
 * @returns {{ halfDay: boolean, shortDay: boolean, leftEarly: boolean, leftEarlyMinutes: number,
 *   underMinutes: number | null }} underMinutes = the Half day or Short day time that applied
 */
export function dayMarks({ row, day, worked, settings }) {
  if (!row || !FINISHED.has(row.checkoutStatus) || !row.checkOutAt) return { ...NO_MARKS };
  if (!day?.isWorkingDay || !day.employed) return { ...NO_MARKS };
  const conflict = day.leave?.part === 'full';
  const expected = conflict ? 1 : day.expected;
  if (!(expected > 0)) return { ...NO_MARKS };
  const factor = shiftFactor(day, settings);
  const half = expected < 1 ? 0 : Math.round(setting(settings, 'halfDayUnderMinutes') * factor);
  const short = Math.round(setting(settings, 'shortDayUnderMinutes') * factor * expected);
  const minutes = Number.isFinite(worked) ? worked : null;
  const halfDay = minutes !== null && half > 0 && minutes < half;
  const shortDay = minutes !== null && !halfDay && short > 0 && minutes < short;
  const end = conflict ? day.shiftEnd : day.dayEnd;
  const out = clockToMinutes(toLocal(row.checkOutAt, settings.timezone).format('HH:mm'));
  const before = clockToMinutes(end) - out;
  const leftEarly = before > setting(settings, 'leftEarlyGraceMinutes');
  return {
    halfDay,
    shortDay,
    leftEarly,
    leftEarlyMinutes: leftEarly ? before : 0,
    underMinutes: halfDay ? half : shortDay ? short : null,
  };
}
