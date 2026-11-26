// The band on top of the Board (CONTRACT 27 and 28, The band; Phase move sequence), worked out from
// the counts of every task of the project per phase: progress, the six parts (done, current with
// its done share, later, skipped) with their words, where the one current ring sits, the deadline,
// and the plan as it reads right after a phase move (until the refresh brings the server's).
// Pure and safe in the browser: today comes in as an argument, and every date is 'YYYY-MM-DD' in
// the company time zone.
import { plural } from '@/lib/text';
import { PROJECT_PHASES, isPhase, phaseIndex } from '@/modules/projectPlan/phases';
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

/** How much of a part is filled (0 to 100): a done phase all, the current one its done share. */
function shareOf(status, count) {
  if (status === 'done') return 100;
  if (status !== 'current' || !count.total) return 0;
  return Math.round((count.done * 100) / count.total);
}

/**
 * The six parts of the band. Every part draws its fill and its green layer, so a phase move ends
 * exactly on what React draws after it.
 * @param {{ plan: { currentPhase: string | null, phases: object[] },
 *   counts: Record<string, { total: number, done: number }> }} args counts: every task of the
 *   project per phase (countByPhase, or countsByPhase for a member)
 * @returns {Array<{ key: string, label: string, status: 'done'|'current'|'later'|'skipped',
 *   share: number, doneLayer: boolean, text: string, ariaLabel: string }>} share: how much of the
 *   part is filled, 0 to 100 (all of a done phase, the done part of the current one, none of the
 *   others); doneLayer: the green layer shows (a done phase); text: under the part; ariaLabel:
 *   the button's name
 */
export function bandParts({ plan, counts }) {
  return PROJECT_PHASES.map(({ key, label }) => {
    const row = plan.phases.find((phase) => phase.key === key) ?? { key };
    const status = phaseStatus(plan.currentPhase, row);
    const count = counts?.[key] ?? { total: 0, done: 0 };
    const done = count.total
      ? `${count.done} of ${count.total} ${plural(count.total, 'task')} done`
      : 'no tasks yet';
    return {
      key,
      label,
      status,
      share: shareOf(status, count),
      doneLayer: status === 'done',
      text: status === 'skipped' ? 'Skipped' : countText(count),
      ariaLabel: `${label}, ${STATUS_WORDS[status]}, ${done}. Show its column.`,
    };
  });
}

/**
 * What the band draws with motion (useBandMotion compares two of these): the whole project's
 * percent and how much of each part is filled.
 * @param {{ plan: { currentPhase: string | null, phases: object[] },
 *   counts: Record<string, { total: number, done: number }> }} args bandParts'
 * @returns {{ pct: number, currentPhase: string | null, shares: Record<string, number> }} shares:
 *   0 to 1, by phase
 */
export function bandValues({ plan, counts }) {
  const parts = bandParts({ plan, counts });
  return {
    pct: progressOf(counts).pct,
    currentPhase: plan.currentPhase ?? null,
    shares: Object.fromEntries(parts.map((part) => [part.key, part.share / 100])),
  };
}

/** Which part the current ring sits on (0 to 5), or null with no current phase (no ring). */
export function ringIndex(currentPhase) {
  return isPhase(currentPhase) ? phaseIndex(currentPhase) : null;
}

/**
 * The plan as the server writes it for a phase move (projectPlan.movePhase), shown at once while
 * the refresh brings the real one: forward, the phase left ends today and the new one starts
 * today; back, every later phase is cleared and the new one opens again.
 * @param {{ currentPhase: string | null, phases: object[] }} plan the page's plan
 * @param {string} to the phase moved to
 * @param {string} today the company's date
 * @returns {object} a plan of the same shape; the same plan when it is already in `to`
 */
export function shownPlan(plan, to, today) {
  const from = plan.currentPhase ?? null;
  if (!isPhase(to) || from === to) return plan;
  const forward = phaseIndex(to) > phaseIndex(from);
  const phases = plan.phases.map((row) => {
    if (row.key === to) {
      const start = forward ? today : (row.actualStart ?? today);
      return { ...row, actualStart: start, actualEnd: null };
    }
    if (forward && row.key === from) return { ...row, actualEnd: today };
    if (!forward && phaseIndex(row.key) > phaseIndex(to)) {
      return { ...row, actualStart: null, actualEnd: null };
    }
    return row;
  });
  return { ...plan, currentPhase: to, phases };
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
