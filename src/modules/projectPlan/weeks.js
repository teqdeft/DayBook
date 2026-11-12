// The weeks a project's speed is worked out from (CONTRACT 22). Pure and safe in the browser.
import { addDays, localToUtc, weekRange } from '@/lib/time';

/**
 * The last 3 full Monday to Sunday weeks in the company time zone, as the UTC bounds
 * projectTasks.progressByProject needs. This week never counts, so ticking a task doesn't change
 * the speed.
 * @param {string} today 'YYYY-MM-DD' in the company time zone (workDate(timezone))
 * @param {string} timezone the company time zone (settings.timezone)
 * @returns {Array<{ from: Date, to: Date }>} newest first; `from` is included, `to` isn't (midnight
 *   on the next Monday)
 */
export function lastFullWeeks(today, timezone) {
  const thisMonday = weekRange(today).from;
  const midnight = (weeksBack) =>
    localToUtc(addDays(thisMonday, -7 * weeksBack), '00:00', timezone).toDate();
  return [1, 2, 3].map((weeksBack) => ({
    from: midnight(weeksBack),
    to: midnight(weeksBack - 1),
  }));
}
