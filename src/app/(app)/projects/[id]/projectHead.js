// What every tab of the project page needs: the project, its plan and its health, in a few small
// queries. Server only. The tabs load the rest of their data themselves, under their own Suspense.
import { workDate } from '@/lib/time';
import { projectPlan } from '@/modules/projectPlan';
import { forecastProject } from '@/modules/projectPlan/forecast';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';

const STATUS_LABELS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

/**
 * @param {number} projectId
 * @param {object} user the session user
 * @returns {Promise<null | { project: object, plan: object, forecast: object, today: string,
 *   canManage: boolean }>} null when there is no such project. project has `statusLabel`; plan is
 *   projectPlan.getPlan's (Not set before migration 015); forecast is forecastProject's; today is
 *   the company's date; canManage: the user is the project's PM or an Admin
 */
export async function loadProjectHead(projectId, user) {
  const project = await projects.findById(projectId);
  if (!project) return null;
  const { timezone } = await settings.getAll();
  const today = workDate(timezone);
  const [plan, progress] = await Promise.all([
    projectPlan.getPlan(project.id),
    projectTasks.progressByProject([project.id], { weeks: lastFullWeeks(today, timezone) }),
  ]);
  const forecast = forecastProject({
    status: project.status,
    ...progress[project.id],
    deadline: plan.deadline,
    today,
    createdOn: project.createdAt ? workDate(timezone, project.createdAt) : null,
  });
  return {
    project: { ...project, statusLabel: STATUS_LABELS[project.status] ?? project.status },
    plan,
    forecast,
    today,
    canManage: projects.canManage(user, project),
  };
}
