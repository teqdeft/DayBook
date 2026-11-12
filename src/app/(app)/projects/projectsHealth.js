// The health side of the projects table (CONTRACT 22): the plans and the task progress of the rows
// on screen, and what the forecast makes of them. Server only.
import { logger } from '@/lib/logger';
import { plural } from '@/lib/text';
import { workDate } from '@/lib/time';
import { projectPlan } from '@/modules/projectPlan';
import { compareHealth, forecastProject } from '@/modules/projectPlan/forecast';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projectTasks } from '@/modules/projectTasks';

/**
 * One read of the plans and one of the progress for all the rows, never one per project. The table
 * still renders if either fails: with nothing read, a running project reads "No plan yet".
 */
async function readPlanData(ids, { today, timezone, userId }) {
  try {
    const [plans, progress] = await Promise.all([
      projectPlan.listPlans(ids),
      projectTasks.progressByProject(ids, { weeks: lastFullWeeks(today, timezone) }),
    ]);
    return { plans, progress };
  } catch (error) {
    logger.warn({ err: error, userId }, 'projects: could not load the project plans');
    return { plans: {}, progress: {} };
  }
}

/**
 * The rows as the table shows them, the ones that need attention first: forecast rank, then the
 * nearest deadline, then name. Only the rows passed in are sorted, so with more than one page each
 * page is sorted on its own.
 * @param {object[]} rows projects.list rows
 * @param {{ today: string, timezone: string, userId: number }} context today in the company time zone
 * @returns {Promise<Array<object>>} the rows plus `phase`, `deadline`, `kind` and `health`
 *   (forecastProject's result)
 */
export async function withHealth(rows, { today, timezone, userId }) {
  const ids = rows.map((row) => row.id);
  const { plans, progress } = await readPlanData(ids, { today, timezone, userId });
  return rows
    .map((row) => {
      const { currentPhase = null, deadline = null } = plans[row.id] ?? {};
      const health = forecastProject({
        status: row.status,
        total: progress[row.id]?.total ?? 0,
        done: progress[row.id]?.done ?? 0,
        doneByWeek: progress[row.id]?.doneByWeek ?? [],
        deadline,
        today,
        createdOn: row.createdAt ? workDate(timezone, row.createdAt) : null,
      });
      return { ...row, phase: currentPhase, deadline, kind: health.kind, health };
    })
    .sort(compareHealth);
}

/**
 * The page's subtitle: "5 active projects: 1 off track, 1 at risk".
 * @param {number} activeTotal every active project
 * @param {Array<{ kind: string }>} [counted] the rows whose health it counts; only pass all the active
 *   projects, because the counts would be wrong for anything less
 * @returns {string}
 */
export function projectsSubtitle(activeTotal, counted = []) {
  const active = `${activeTotal} active ${plural(activeTotal, 'project')}`;
  const count = (kind) => counted.filter((row) => row.kind === kind).length;
  const counts = [
    [count('off'), 'off track'],
    [count('risk'), 'at risk'],
  ]
    .filter(([number]) => number > 0)
    .map(([number, words]) => `${number} ${words}`);
  return counts.length > 0 ? `${active}: ${counts.join(', ')}` : active;
}
