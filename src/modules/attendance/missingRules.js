// The rules of a missing check-out (CONTRACT 25, items B and 7): the suggested check-out time (the
// last moment Daybook saw the person working that day, worked out as auto check-out does) and the
// self-fix limit, how late someone may enter their own check-out from Today without HR. Pure: no
// database. The suggestion is the only value derived from screen time that HR ever sees.
import { env } from '@/lib/env';
import { addDays, dayjs, localToUtc, now, toLocal } from '@/lib/time';
import { lastSeenWorking } from './autoCheckout';

/** A self-entered check-out up to this long after the suggestion is saved without HR. */
export const SELF_FIX_EXTRA_MINUTES = 15;

/** 23:59 of the work date: nothing here goes past it (a check-out after midnight can't be typed). */
function lastMinuteOf(workDate, tz) {
  return localToUtc(workDate, '23:59', tz);
}

/**
 * 'HH:mm' in company time for a moment, or null.
 * @param {Date | string | null | undefined} at
 * @param {string} tz
 */
export function clockAt(at, tz) {
  return at ? toLocal(at, tz).format('HH:mm') : null;
}

/**
 * The suggested check-out of a missing row: lastSeenWorking() over the day's screen time (active
 * of any source, window-mode idle), the timer's last finished run and the break starts and ends,
 * with `at` = the earlier of now and the end of the work date; cut to the minute and never past
 * 23:59 of that date. Null when nothing was seen after the check-in (autoCheckoutTime's rule).
 * @param {{ row: { workDate: string, checkInAt: Date | string },
 *   segments?: Array<{ state: string, source: string, endedAt: Date | string }>,
 *   timerAt?: Date | null, breaks?: Array<{ startedAt: Date, endedAt: Date | null }>,
 *   tz?: string, at?: Date | string }} input timerAt = the end of the last finished timer entry
 *   of that date (timers.lastRanByUser), never "now" for a timer still running
 * @returns {Date | null}
 */
export function suggestedCheckoutAt({
  row,
  segments = [],
  timerAt = null,
  breaks = [],
  tz = env.DEFAULT_TIMEZONE,
  at,
}) {
  if (!row?.checkInAt || !row.workDate) return null;
  const dayEnd = localToUtc(addDays(row.workDate, 1), '00:00', tz);
  const moment = dayjs(at ?? now());
  const cap = moment.isBefore(dayEnd) ? moment : dayEnd;
  const seen = lastSeenWorking({ segments, timerAt, breaks, at: cap.toDate() });
  if (!seen) return null;
  const lastMinute = lastMinuteOf(row.workDate, tz);
  let minute = dayjs(seen).startOf('minute');
  if (minute.isAfter(lastMinute)) minute = lastMinute;
  return minute.isAfter(dayjs(row.checkInAt)) ? minute.toDate() : null;
}

/**
 * How late the person may enter their own check-out without HR (the owner's rule). On a day they
 * were expected (`day.expected > 0`, half-day leave included): the later of their own shift end
 * (`day.shiftEnd`, never the half-day split) and the suggestion + 15 minutes. On a day with
 * expected 0 (not a working day, full-day leave, before joining) there is no shift: the
 * suggestion + 15 minutes, and with no suggestion every time goes to HR. Never past 23:59 of the
 * work date.
 * @param {{ row: { workDate: string }, day: { expected: number, shiftEnd: string },
 *   suggestedAt: Date | null, tz?: string }} input day = the PersonDay of the row's date
 * @returns {{ limitAt: Date | null, basis: 'shift_end' | 'suggestion' | 'none' }}
 */
export function selfFixLimit({ row, day, suggestedAt, tz = env.DEFAULT_TIMEZONE }) {
  const lastMinute = lastMinuteOf(row.workDate, tz);
  const capped = (value) => (value.isAfter(lastMinute) ? lastMinute : value).toDate();
  const fromSuggestion = suggestedAt
    ? dayjs(suggestedAt).add(SELF_FIX_EXTRA_MINUTES, 'minute')
    : null;
  if (day && day.expected > 0) {
    const shiftEnd = localToUtc(row.workDate, day.shiftEnd, tz);
    if (fromSuggestion && fromSuggestion.isAfter(shiftEnd)) {
      return { limitAt: capped(fromSuggestion), basis: 'suggestion' };
    }
    return { limitAt: capped(shiftEnd), basis: 'shift_end' };
  }
  if (!fromSuggestion) return { limitAt: null, basis: 'none' };
  return { limitAt: capped(fromSuggestion), basis: 'suggestion' };
}

/**
 * True when a typed check-out needs HR: after the limit, or any time when there is no limit.
 * @param {Date} checkOutAt
 * @param {Date | null} limitAt
 */
export function isOverLimit(checkOutAt, limitAt) {
  if (!limitAt) return true;
  return dayjs(checkOutAt).isAfter(dayjs(limitAt));
}

/**
 * True when HR's time equals the suggestion, to the minute (the audit's `after.suggested`).
 * @param {Date | null} suggestedAt
 * @param {Date} checkOutAt
 */
export function isSuggestedTime(suggestedAt, checkOutAt) {
  if (!suggestedAt || !checkOutAt) return false;
  return dayjs(suggestedAt).startOf('minute').isSame(dayjs(checkOutAt).startOf('minute'));
}
