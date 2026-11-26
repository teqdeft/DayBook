// Dashboards: read models for the sidebar badges, the Team dashboard, the Employee detailed view,
// the Company overview and the hours export. Nothing here writes to the database.
import { can } from '@/lib/permissions';
import { workDate } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import * as repo from './repo';

export { getHoursByProject, getHoursCard, getTeamToday } from './team';
export { getEmployeeDetail } from './employee';
export { daysInProgress, isStuckTask } from './employeeTasks';
export { getOverview } from './overview';
export { buildHoursExport } from './exportHours';
export { projectReportPeriod } from './projectReportPeriods';

/** Roles whose sidebar shows My tasks with its badge (CONTRACT 28). */
const MY_TASKS_ROLES = ['pm', 'admin'];

/** The company's day, from the settings cache (no query on a page load in the app). */
async function companyToday() {
  return workDate((await settings.getAll()).timezone);
}

/**
 * The My tasks badge (CONTRACT 28): the PM's or Admin's open tasks that are overdue or due today,
 * through projectTasks.countMineDue (one indexed count); 0 for everyone else.
 * @param {{ id: number, role: string, status?: string }} user
 * @returns {Promise<number>}
 */
async function myTasksDue(user) {
  if (!MY_TASKS_ROLES.includes(user.role) || !can(user, 'project.manage')) return 0;
  return projectTasks.countMineDue({ viewer: user, today: await companyToday() });
}

/**
 * The approval badges, in one query.
 * requests: pending report edit requests this user may approve (a PM: people who report to them;
 * an Admin: everyone; never their own, as on the Requests screen) plus pending project requests
 * (anyone who handles them);
 * corrections: pending attendance correction requests plus pending work-from-home requests whose
 * last day is today or later (CONTRACT 17), only for people who can correct attendance, never
 * their own (another HR person or an Admin decides on those), and an Admin's only for another
 * Admin (an Admin's attendance is never shown to HR).
 * @param {{ id: number, role: string, status?: string }} user
 * @returns {Promise<{ requests: number, corrections: number }>}
 */
async function approvalCounts(user) {
  const scope = {
    edits: can(user, 'report.approve_edit') ? (user.role === 'admin' ? 'all' : user.id) : false,
    projects: can(user, 'project_request.handle'),
    corrections: can(user, 'attendance.correct'),
  };
  if (scope.edits === false && !scope.projects && !scope.corrections) {
    return { requests: 0, corrections: 0 };
  }
  // Settings are cached in-process, so the company day costs no query on a page load.
  const wfhFrom = scope.corrections ? await companyToday() : undefined;
  const counts = await repo.countNavBadges({
    ...scope,
    selfId: user.id,
    withAdmins: user.role === 'admin',
    wfhFrom,
  });
  return {
    requests: counts.edits + counts.projects,
    corrections: counts.corrections + counts.wfh,
  };
}

/**
 * Counts for the sidebar badges: the approval badges in one query, and My tasks (CONTRACT 28) in
 * one more for PMs and Admins, also when they have nothing to approve.
 * @param {{ id: number, role: string, status?: string } | null} user
 * @returns {Promise<{ requests: number, corrections: number, myTasks: number }>}
 */
export async function getNavBadges(user) {
  if (!user) return { requests: 0, corrections: 0, myTasks: 0 };
  const [counts, myTasks] = await Promise.all([approvalCounts(user), myTasksDue(user)]);
  return { ...counts, myTasks };
}
