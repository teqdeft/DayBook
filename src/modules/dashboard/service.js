// Dashboards: read models for the sidebar badges, the Team dashboard, the Employee detailed view,
// the Company overview and the hours export. Nothing here writes to the database.
import { can } from '@/lib/permissions';
import * as repo from './repo';

export { getHoursByProject, getHoursCard, getTeamToday } from './team';
export { getEmployeeDetail, daysInProgress, isStuckTask } from './employee';
export { getOverview } from './overview';
export { buildHoursExport } from './exportHours';

/**
 * Counts for the sidebar badges, in one query.
 * requests: pending report edit requests this user may approve (a PM: people who report to them;
 * an Admin: everyone; never their own, as on the Requests screen) plus pending project requests
 * (anyone who handles them);
 * corrections: pending attendance correction requests, only for people who can correct attendance,
 * never their own (another HR person or an Admin decides on those).
 * @param {{ id: number, role: string, status?: string } | null} user
 * @returns {Promise<{ requests: number, corrections: number }>}
 */
export async function getNavBadges(user) {
  if (!user) return { requests: 0, corrections: 0 };
  const scope = {
    edits: can(user, 'report.approve_edit') ? (user.role === 'admin' ? 'all' : user.id) : false,
    projects: can(user, 'project_request.handle'),
    corrections: can(user, 'attendance.correct'),
  };
  if (scope.edits === false && !scope.projects && !scope.corrections) {
    return { requests: 0, corrections: 0 };
  }
  const counts = await repo.countNavBadges({ ...scope, selfId: user.id });
  return { requests: counts.edits + counts.projects, corrections: counts.corrections };
}
