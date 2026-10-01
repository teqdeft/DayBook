// The Screen time card's data on the Employee detailed view (docs/CONTRACT.md section 11): the
// person's active, idle and locked time for the selected range. Server only (called from page.js).
import { can } from '@/lib/permissions';
import { activity } from '@/modules/activity';
import { settings } from '@/modules/settings';
import { rangeSummary } from '../../screen-time/screenTimeView';

const EMPTY_RANGE = {
  days: [],
  totals: { activeMinutes: 0, idleMinutes: 0, lockedMinutes: 0, daysWithData: 0 },
};

/**
 * Props for <ScreenTimeCard />, or null when the viewer may not see screen time.
 * @param {{ viewer: object, person: { id: number, role: string, tracksAttendance: boolean },
 *   period: { from: string, to: string, end: string, label: string }, today: string }} input
 */
export async function loadScreenTimeCard({ viewer, person, period, today }) {
  if (!can(viewer, 'activity.view_all')) return null;
  if (!person.tracksAttendance) {
    return {
      subtitle: period.label,
      note: {
        title: 'Not tracked',
        body:
          person.role === 'pm'
            ? "Project managers aren't tracked, so there's no screen time."
            : "Their attendance isn't tracked, so screen time isn't recorded.",
      },
    };
  }
  const [current, range] = await Promise.all([
    settings.getAll(),
    period.end >= period.from
      ? activity.getRange(person.id, period.from, period.end)
      : Promise.resolve(EMPTY_RANGE),
  ]);
  const summary = rangeSummary({
    range: range ?? EMPTY_RANGE,
    from: period.from,
    to: period.to,
    today,
    workingDays: current.workingDays,
  });
  return {
    subtitle: `${period.label}, ${summary.daysText}`,
    summary,
    emptyText: 'No screen time recorded in this range. It is recorded while Daybook is open.',
    footnote:
      current.activityTrackingEnabled === false
        ? 'Screen time is turned off for the company, so nothing new is recorded.'
        : null,
  };
}
