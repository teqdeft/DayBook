// Company-calendar helpers for the summary jobs: the UTC bounds of a company date, the ISO week
// key of HR's weekly notes and the week's last working day.
import { addDays, dayjs, isoWeekday, isWorkingDay, localToUtc, weekRange } from '@/lib/time';

/**
 * The UTC moments a company date starts and ends.
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} timezone settings.timezone
 * @returns {{ from: Date, to: Date }} `to` (the next midnight) is excluded
 */
export function dayBounds(date, timezone) {
  return {
    from: localToUtc(date, '00:00', timezone).toDate(),
    to: localToUtc(addDays(date, 1), '00:00', timezone).toDate(),
  };
}

/**
 * The ISO 8601 week of a date, as in HR notes' run key: '2026-W40'. The year is the week's own
 * (the year of its Thursday), so 1 January 2027, a Friday, is in '2026-W53'.
 * @param {string} date 'YYYY-MM-DD'
 * @returns {string}
 */
export function isoWeekKey(date) {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const year = thursday.slice(0, 4);
  const dayOfYear = dayjs.utc(thursday).diff(dayjs.utc(`${year}-01-01`), 'day');
  const week = Math.floor(dayOfYear / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * The last working day (settings.workingDays) of the Monday-to-Sunday week that holds `date`.
 * @param {string} date 'YYYY-MM-DD'
 * @param {number[]} workingDays ISO weekdays, Monday = 1
 * @returns {string | null} null when the company has no working days
 */
export function lastWorkingDayOfWeek(date, workingDays) {
  const { from } = weekRange(date);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = addDays(from, offset);
    if (isWorkingDay(day, workingDays)) return day;
  }
  return null;
}
