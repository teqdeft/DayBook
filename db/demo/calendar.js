// Date helpers for the demo seed. Every design date is placed relative to an anchor day
// (the artboards' "Wednesday, 30 September"), counted in working days.
import {
  addDays,
  addMonths,
  clockToMinutes,
  isWorkingDay,
  localToUtc,
  monthOf,
  monthRange,
  workDate,
} from '@/lib/time';

/**
 * The anchor day: today's work date in the company time zone, or the last working day before it
 * when today is not a working day (a weekend anchors to Friday).
 * @param {string} tz company time zone
 * @param {number[]} workingDays ISO weekdays, Monday = 1
 * @returns {string} 'YYYY-MM-DD'
 */
export function anchorDate(tz, workingDays) {
  let date = workDate(tz);
  while (!isWorkingDay(date, workingDays)) date = addDays(date, -1);
  return date;
}

/**
 * Working days from the anchor back to the first day of the previous month.
 * Index = working-day offset: 0 is the anchor, 1 the working day before it, and so on.
 * @param {string} anchor
 * @param {number[]} workingDays
 * @returns {string[]}
 */
export function workingDaysBack(anchor, workingDays) {
  const start = monthRange(addMonths(monthOf(anchor), -1)).from;
  const days = [];
  for (let date = anchor; date >= start; date = addDays(date, -1)) {
    if (isWorkingDay(date, workingDays)) days.push(date);
  }
  return days;
}

/**
 * The date `offset` working days before the anchor (0 = the anchor), also beyond the history.
 * @param {string} anchor
 * @param {number} offset
 * @param {number[]} workingDays
 */
export function dateAtOffset(anchor, offset, workingDays) {
  let date = anchor;
  for (let left = offset; left > 0;) {
    date = addDays(date, -1);
    if (isWorkingDay(date, workingDays)) left -= 1;
  }
  return date;
}

/**
 * A local clock time on a date as a UTC Date (for DATETIME columns).
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} clock 'HH:mm'
 * @param {string} tz
 */
export function at(date, clock, tz) {
  return localToUtc(date, clock, tz).toDate();
}

/** Minutes after midnight -> 'HH:mm'. */
export function clockOf(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:mm' -> minutes after midnight (the shared helper from @/lib/time). */
export const minutesOf = clockToMinutes;

/**
 * A stable number from any parts (FNV-1a). The seed never uses Math.random, so every run
 * produces the same data.
 * @param {...(string|number)} parts
 * @returns {number} unsigned 32-bit
 */
export function hash(...parts) {
  let value = 2166136261;
  for (const char of parts.join('|')) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

/** Hours (0.25 steps) -> whole minutes. */
export function hoursToMinutes(hours) {
  return Math.round(hours * 60);
}
