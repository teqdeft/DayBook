// The band on top of the Board (CONTRACT 27, The band), worked out from the counts of every task of
// the project per phase: progress, the six parts (done, current with its done share, later,
// skipped) with their words, and the deadline. Pure and safe in the browser: today comes in as an
// argument, and every date is 'YYYY-MM-DD' in the company time zone.
import { plural } from '@/lib/text';
import { PROJECT_PHASES, isPhase } from '@/modules/projectPlan/phases';
import { NO_PHASE } from '../phasesView';
import { dayCount, daysBetween, longDate, phaseStatus } from '../planFormat';

/** A task's column: its phase, or NO_PHASE for one from before phases. */
export const columnOf = (task) => (isPhase(task.phase) ? task.phase : NO_PHASE);

const isOpen = (task) => task.status !== 'done';

/**
 * Tasks and done tasks per phase.
 * @param {Array<{ phase: string | null, status: string }>} tasks
 * @returns {Record<string, { total: number, done: number }>} keyed by phase or NO_PHASE; a phase
 *   without tasks is left out (countsByPhase's shape)
 */
export function countByPhase(tasks) {
  const counts = {};
  for (const task of tasks) {
    const key = columnOf(task);
    counts[key] ??= { total: 0, done: 0 };
    counts[key].total += 1;
    if (!isOpen(task)) counts[key].done += 1;
  }
  return counts;
}

/**
 * The band's progress: every task of the project, whatever the viewer sees.
 * @param {Record<string, { total: number, done: number }>} counts
 * @returns {{ done: number, total: number, pct: number }} pct rounded as the forecast does
 */
export function progressOf(counts) {
  let done = 0;
  let total = 0;
  for (const count of Object.values(counts ?? {})) {
    done += Number(count?.done) || 0;
    total += Number(count?.total) || 0;
  }
  return { done, total, pct: total > 0 ? Math.round((done * 100) / total) : 0 };
}

/** '6 of 12' or 'No tasks yet' */
export function countText(count) {
  return count?.total ? `${count.done} of ${count.total}` : 'No tasks yet';
}

const STATUS_WORDS = { done: 'done', current: 'current phase', later: 'later', skipped: 'skipped' };

/**
 * The six parts of the band.
 * @param {{ plan: { currentPhase: string | null, phases: object[] },
 *   counts: Record<string, { total: number, done: number }> }} args counts: every task of the
 *   project per phase (countByPhase, or countsByPhase for a member)
 * @returns {Array<{ key: string, label: string, status: 'done'|'current'|'later'|'skipped',
 *   share: number, text: string, ariaLabel: string }>} share: the done part of the current phase
 *   (0 to 100, 0 for the others); text: under the part; ariaLabel: the button's name
 */
export function bandParts({ plan, counts }) {
  return PROJECT_PHASES.map(({ key, label }) => {
    const row = plan.phases.find((phase) => phase.key === key) ?? { key };
    const status = phaseStatus(plan.currentPhase, row);
    const count = counts?.[key] ?? { total: 0, done: 0 };
    const share =
      status === 'current' && count.total > 0 ? Math.round((count.done * 100) / count.total) : 0;
    const done = count.total
      ? `${count.done} of ${count.total} ${plural(count.total, 'task')} done`
      : 'no tasks yet';
    return {
      key,
      label,
      status,
      share,
      text: status === 'skipped' ? 'Skipped' : countText(count),
      ariaLabel: `${label}, ${STATUS_WORDS[status]}, ${done}. Show its column.`,
    };
  });
}

/**
 * The deadline in the band.
 * @param {string | null} deadline
 * @param {string} today
 * @returns {{ date: string | null, left: string, late: boolean }} '16 Dec 2026' and '23 days
 *   left', 'Due today' or '5 days late' (late); no date and 'No deadline' without one
 */
export function deadlineText(deadline, today) {
  if (!deadline) return { date: null, left: 'No deadline', late: false };
  const left = daysBetween(today, deadline);
  if (left > 0) return { date: longDate(deadline), left: `${dayCount(left)} left`, late: false };
  if (left === 0) return { date: longDate(deadline), left: 'Due today', late: true };
  return { date: longDate(deadline), left: `${dayCount(-left)} late`, late: true };
}
