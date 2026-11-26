// What every tab of the project page needs (CONTRACT 27 and 28): who the viewer is to the project
// (and their id and name, for the board's Mine, "Me" and "(you)"), the project, its plan and, for
// the PM view, its health, in a few small queries. Server only. The tabs
// load the rest of their data themselves, under their own Suspense. Who may open the page is read
// once per request (React cache): the segment's layout answers a real 404 with it before anything
// streams, and the page reuses it.
import { cache } from 'react';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { monthOf, monthRange, workDate } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { filesAccess } from '@/modules/projectFiles/access';
import { projectPlan } from '@/modules/projectPlan';
import { forecastProject } from '@/modules/projectPlan/forecast';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';

const STATUS_LABELS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

/**
 * Who the viewer is to the project, and the project, once per request. For someone without
 * `team.view` membership is checked before anything about the project is read: a person who
 * isn't on it learns nothing, not even that it exists.
 * @param {number} projectId
 * @param {number | null} userId
 * @param {boolean} teamView the viewer has `team.view`
 * @returns {Promise<{ kind: 'team' | 'member', project: object } | null>} 'team' for `team.view`
 *   holders; null when the viewer may not open it or there is no such project
 */
const accessOf = cache(async (projectId, userId, teamView) => {
  const member = !teamView && (await projects.isMember({ projectId, userId }));
  if (!teamView && !member) return null;
  const project = await projects.findById(projectId);
  return project ? { kind: teamView ? 'team' : 'member', project } : null;
});

const accessFor = (projectId, user) =>
  accessOf(Number(projectId), user?.id ?? null, can(user, 'team.view'));

/**
 * Whether the viewer may open the project page: a `team.view` holder, or an active member, of a
 * project that exists. The `[id]` layout answers 404 when not, before the page streams.
 * @param {number} projectId
 * @param {object} user the session user
 * @returns {Promise<boolean>}
 */
export async function canOpenProject(projectId, user) {
  return Boolean(await accessFor(projectId, user));
}

/** The PM view's health: the forecast from the tasks done in the last 3 full weeks. */
function forecastOf({ project, plan, progress, today, timezone }) {
  return forecastProject({
    status: project.status,
    ...progress[project.id],
    deadline: plan.deadline,
    today,
    createdOn: project.createdAt ? workDate(timezone, project.createdAt) : null,
  });
}

/**
 * The member's own minutes on the project this company month, or null without `report.self` (or
 * when the reports can't be read: the band then leaves the line out).
 */
async function loadHours(project, user, today) {
  if (!can(user, 'report.self')) return null;
  const month = monthRange(monthOf(today));
  try {
    const minutes = await reports.getMinutesByProject({
      from: month.from,
      to: month.to,
      userId: user.id,
    });
    return Number(minutes[project.id] ?? 0);
  } catch (error) {
    logger.warn({ err: error, projectId: project.id }, 'project page: hours this month failed');
    return null;
  }
}

/**
 * Whether the member's task window offers "Add to to-do": the viewer has `report.self` and today's
 * to-do still takes lines (false once the report is in, or when that can't be read).
 */
async function loadTodoOpen(user) {
  if (!can(user, 'report.self')) return false;
  try {
    return await reports.todoTakesLines({ user });
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'project page: the to-do state failed');
    return false;
  }
}

/**
 * The uploaders' limits and the people a task can be given to (AssigneeOption[], CONTRACT 28: the
 * viewer first as "Me", the PM, then the active members), for New task, Edit task and the people
 * window.
 */
async function loadManagerParts(project, user) {
  const [limits, options, storage] = await Promise.all([
    projectFiles.limits(),
    projectTasks.listAssigneeOptions({ viewer: user, projectId: project.id }),
    projectFiles.storageStatus(),
  ]);
  // The task form's Files field says "File storage isn't set up yet." when it isn't (CONTRACT 27).
  return { limits, options, storageReady: storage.ready };
}

/**
 * @param {number} projectId
 * @param {object} user the session user
 * @returns {Promise<null | { project: object, plan: object, forecast?: object, today: string,
 *   viewerId: number | null, viewerName: string | null,
 *   canManage: boolean, access: 'manage' | 'team' | 'member',
 *   filesAccess: 'manage' | 'member' | 'none', hoursThisMonth?: number | null,
 *   todoOpen?: boolean, limits?: object, options?: object[], storageReady?: boolean }>} null
 *   when there is no such project or the viewer may not open it (the page answers 404). project
 *   has `statusLabel`; viewerId and viewerName: the viewer's (the board's Mine, "Me (Riya
 *   Kapoor)" and "(you)"); plan is projectPlan.getPlan's (Not set before migration 015); forecast (PM
 *   view only, never computed for a member) is forecastProject's; today is the company's date;
 *   access: 'manage' (the project's PM or an Admin), 'team' (another `team.view` holder),
 *   'member' (an active member without `team.view`); filesAccess: the file rights, from the
 *   files rule, never from access; hoursThisMonth (member view only): the viewer's minutes this
 *   month, null without `report.self`; todoOpen (member view only): the task window's "Add to
 *   to-do" shows (`report.self` and a to-do that still takes lines); limits, options and
 *   storageReady (managers only): projectFiles.limits(), projectTasks.listAssigneeOptions
 *   (AssigneeOption[]) and whether file storage is set up (projectFiles.storageStatus)
 */
export async function loadProjectHead(projectId, user) {
  const opened = await accessFor(projectId, user);
  if (!opened) return null;
  const { kind, project } = opened;
  const canManage = kind === 'team' && projects.canManage(user, project);
  const access = canManage ? 'manage' : kind;
  const { timezone } = await settings.getAll();
  const today = workDate(timezone);
  const team = kind === 'team';
  const [plan, progress, ctx, hoursThisMonth, todoOpen, managerParts] = await Promise.all([
    projectPlan.getPlan(project.id),
    team
      ? projectTasks.progressByProject([project.id], { weeks: lastFullWeeks(today, timezone) })
      : null,
    projectFiles.viewerContext({ viewer: user, project }),
    team ? null : loadHours(project, user, today),
    team ? null : loadTodoOpen(user),
    canManage ? loadManagerParts(project, user) : null,
  ]);
  const forecast = progress ? forecastOf({ project, plan, progress, today, timezone }) : null;
  return {
    project: { ...project, statusLabel: STATUS_LABELS[project.status] ?? project.status },
    plan,
    ...(forecast ? { forecast } : {}),
    today,
    viewerId: user?.id ?? null,
    viewerName: user?.name ?? null,
    canManage,
    access,
    filesAccess: filesAccess(ctx),
    ...(team ? {} : { hoursThisMonth, todoOpen }),
    ...managerParts,
  };
}
