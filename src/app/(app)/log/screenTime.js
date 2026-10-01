// The Screen time card on My log (docs/CONTRACT.md section 11): the person's own active, idle and
// locked time for the month shown. Server only (called from page.js).
import { can } from '@/lib/permissions';
import { dayjs, monthOf, monthRange } from '@/lib/time';
import { activity } from '@/modules/activity';
import { settings } from '@/modules/settings';
import { measuredText, rangeSummary } from '../screen-time/screenTimeView';

/**
 * Props for <ScreenTimeCard />, or null for someone whose screen time isn't recorded.
 * @param {{ user: object, month: string, today: string }} input  month 'YYYY-MM'
 */
export async function loadMyScreenTime({ user, month, today }) {
  if (!can(user, 'activity.self') || !user.tracksAttendance) return null;
  const { from, to } = monthRange(month);
  const end = to < today ? to : today;
  const [current, range] = await Promise.all([
    settings.getAll(),
    end >= from ? activity.getRange(user.id, from, end) : null,
  ]);
  const summary = rangeSummary({ range, from, to, today, workingDays: current.workingDays });
  const monthName = dayjs(`${month}-01`).format('MMMM');
  const isThisMonth = month === monthOf(today);
  return {
    subtitle: `${monthName}, ${summary.daysText}`,
    summary,
    emptyText: `No screen time recorded in ${monthName}${isThisMonth ? ' yet' : ''}.`,
    footnote:
      current.activityTrackingEnabled === false
        ? 'Screen time is turned off for the company, so nothing new is recorded.'
        : measuredText(current.activityIdleMinutes),
  };
}
