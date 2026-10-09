// Required timer mode at submit (CONTRACT 15): report hours must equal the day's timers. In
// optional mode (or for someone who can't use timers) the report is never checked against them.
// Also the day's timers the report page shows, decided by the same rule.
import { AppError } from '@/lib/errors';
import { formatDuration, formatHours, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { getOwnReport } from './drafts';
import { isEditable } from './view';

const NO_TIMER_TIME = 'No timer time on this project today. Remove it or add time on Today.';

/**
 * The required-mode rules on a report's entries (pure): every project entry's minutes equal the
 * project's rounded timer minutes (`entries.N.hours`), and every project with rounded timer
 * minutes above 0 is in the report (`total`, the biggest missing one). Entries for project
 * requests (no project yet) are exempt.
 * @param {Array<{ projectId?: number | null, projectRequestId?: number | null,
 *   minutes: number }>} entries in the order sent (field keys follow it)
 * @param {{ projects: Array<{ projectId: number, projectName: string,
 *   roundedMinutes: number }> }} summary timers.getDaySummary(), biggest project first
 * @returns {Record<string, string>} field -> message; empty when the report matches
 */
export function timerProblems(entries, summary) {
  const fields = {};
  const rounded = new Map(
    (summary?.projects ?? []).map((project) => [Number(project.projectId), project.roundedMinutes]),
  );
  const reported = new Set();
  entries.forEach((entry, i) => {
    if (!entry.projectId) return;
    const projectId = Number(entry.projectId);
    reported.add(projectId);
    const timerMinutes = rounded.get(projectId) ?? 0;
    const key = `entries.${i}.hours`;
    if (timerMinutes <= 0) fields[key] = NO_TIMER_TIME;
    else if ((Number(entry.minutes) || 0) !== timerMinutes) {
      fields[key] = `Hours come from your timers (${formatHours(timerMinutes)}).`;
    }
  });
  const missing = (summary?.projects ?? []).find(
    (project) => project.roundedMinutes > 0 && !reported.has(Number(project.projectId)),
  );
  if (missing) {
    fields.total =
      `${missing.projectName} has ${formatDuration(missing.roundedMinutes)} on your timers. ` +
      'Fill the report from timers.';
  }
  return fields;
}

/**
 * Whether required mode checks a report's day (pure): the day has at least one time entry, or
 * it is today or later. An earlier day nobody timed (yesterday's report before it locks, a day
 * opened by an edit request) keeps typed hours.
 * @param {{ day: string, today: string, summary: { projects: object[] } | null }} input
 * @returns {boolean}
 */
export function requiredApplies({ day, today, summary }) {
  return (summary?.projects?.length ?? 0) > 0 || day >= today;
}

/**
 * The required-mode check for one person's report: runs when timers are required, the person
 * can use timers, and requiredApplies() says the day is checked.
 * @param {{ user: object, workDate: string, loadEntries: () => Promise<Array<{
 *   projectId?: number | null, projectRequestId?: number | null, minutes: number }>> }} input
 *   loadEntries gives the entries to check, only called when the check applies
 * @returns {Promise<Record<string, string> | null>} field errors, or null when nothing is wrong
 */
export async function checkTimerHours({ user, workDate: day, loadEntries }) {
  const current = await settings.getAll();
  if (current.timersMode !== 'required' || !timers.canUse(user)) return null;
  const summary = await timers.getDaySummary(user.id, day);
  if (!requiredApplies({ day, today: workDate(current.timezone), summary })) return null;
  const fields = timerProblems(await loadEntries(), summary);
  return Object.keys(fields).length ? fields : null;
}

/**
 * The day's timers as the daily report shows them ("From your timers", Fill report from timers,
 * read-only hours): null when the report can't change, timers are off or the person can't use
 * them. `required` is true exactly when the submit checks the hours against the timers (the rule
 * of checkTimerHours), so the page never makes hours read-only that the server would take typed.
 * @param {{ user: object, report: { workDate: string, editable: boolean } }} input
 * @returns {Promise<{ mode: 'optional' | 'required', required: boolean, summary: object } | null>}
 *   summary is timers.getDaySummary() (a running timer counts up to now)
 */
export async function timersForReport({ user, report }) {
  const current = await settings.getAll();
  const mode = current.timersMode;
  if (!report?.editable || mode === 'off' || !timers.canUse(user)) return null;
  const summary = await timers.getDaySummary(user.id, report.workDate);
  const today = workDate(current.timezone);
  const required = mode === 'required' && requiredApplies({ day: report.workDate, today, summary });
  return { mode, required, summary };
}

/**
 * GET /api/reports/:id/timers: timersForReport() for one of the person's own reports, so the
 * report page can take the timers as they are now (a running timer moves on, time is added on
 * Today) before "Fill report from timers" and before a submit in required mode.
 * @param {{ user: object, reportId: number }} input
 * @returns {Promise<{ mode, required, summary } | null>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function getTimersForReport({ user, reportId }) {
  const report = await getOwnReport(user, reportId);
  return timersForReport({
    user,
    report: { workDate: report.workDate, editable: isEditable(report) },
  });
}

/**
 * Adds the timer field errors to the submit rules' error (they win on the same field: in required
 * mode the hours can only be fixed through the timers).
 * @param {AppError | null} problem from submitProblems()
 * @param {Record<string, string> | null} timerFields from checkTimerHours()
 * @returns {AppError | null}
 */
export function withTimerProblems(problem, timerFields) {
  if (!timerFields) return problem;
  const fields = { ...(problem?.fields ?? {}), ...timerFields };
  return new AppError('VALIDATION_FAILED', { message: Object.values(timerFields)[0], fields });
}
