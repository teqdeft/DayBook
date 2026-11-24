// What a task on the Board reads (CONTRACT 22 and 27): the order of the open and done tasks, the
// owner's away label, the latest report line and a task as the board's cards read it
// (toBoardTask). The columns themselves are _board/boardView.js's. Pure and safe in the browser:
// today comes in as an argument, and every date is 'YYYY-MM-DD' in the company time zone.
import { formatDayShort, formatRelativeDay } from '@/lib/time';

/** The key and name of the last column, for tasks without a phase (from before phases). */
export const NO_PHASE = 'none';
export const NO_PHASE_LABEL = 'No phase yet';

const PRIORITY_RANK = { p1: 1, p2: 2, p3: 3 };
const NO_DATE = '9999-99-99';
const REPORT_LABELS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };

const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));
const byDue = (a, b) => (a.dueDate ?? NO_DATE).localeCompare(b.dueDate ?? NO_DATE);

/** Open tasks: P1 first, then the nearest due date (no date last), then the title. */
export function sortOpenTasks(tasks) {
  const rank = (task) => PRIORITY_RANK[task.priority] ?? 9;
  return [...tasks].sort((a, b) => rank(a) - rank(b) || byDue(a, b) || byTitle(a, b));
}

/** Done tasks, as the prototype lists them: by due date (no date last), then the title. */
export function sortDoneTasks(tasks) {
  return [...tasks].sort((a, b) => byDue(a, b) || byTitle(a, b));
}

/** 'today', 'yesterday', or the row date ('Thu, 24 Sep'). */
function when(date, today) {
  const day = formatRelativeDay(date, today);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : formatDayShort(date);
}

const firstName = (name) => String(name ?? '').split(' ')[0] || name;

/** Why the owner can't work on the task any more, or null when they can. */
export function awayLabel(assignee) {
  if (!assignee) return null;
  if (assignee.status && assignee.status !== 'active') return 'Deactivated';
  return assignee.isMember === false ? 'Not on the project' : null;
}

/** 'Neha, yesterday: In progress', from the latest report line on the task. */
export function latestReportLabel(latest, today) {
  if (!latest) return null;
  const status = REPORT_LABELS[latest.status] ?? REPORT_LABELS.in_progress;
  return `${firstName(latest.userName)}, ${when(latest.workDate, today)}: ${status}`;
}

/** Who added the task, as the task window names them; null when the row doesn't say. */
function addedBy(task) {
  if (task.createdBy && typeof task.createdBy === 'object') return task.createdBy;
  return task.createdBy ? { id: task.createdBy, name: task.createdByName ?? null } : null;
}

/**
 * A task as the board shows it: plain values and ready-made labels (listForProject's row in).
 * @param {object} task listForProject's row
 * @param {string} today the company's date
 * @param {number} [fileCount] the files on it this viewer may see (projectFiles.countsForTasks)
 * @returns {{ id, title, details, priority, status, phase, dueDate,
 *   assignee: { id, name, avatarUrl, away } | null, latest: string | null,
 *   latestStatus: string | null, latestOn: string | null, fileCount: number,
 *   createdBy: { id, name } | null }} latestOn: the work date of the latest report line
 */
export function toBoardTask(task, today, fileCount = 0) {
  const latest = task.latestReport ?? null;
  return {
    id: task.id,
    title: task.title,
    details: task.details ?? null,
    priority: task.priority,
    status: task.status,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name,
          avatarUrl: task.assignee.avatarUrl ?? null,
          away: awayLabel(task.assignee),
        }
      : null,
    latest: latestReportLabel(latest, today),
    latestStatus: latest ? (latest.status ?? 'in_progress') : null,
    latestOn: latest?.workDate ?? null,
    fileCount: Number(fileCount) || 0,
    createdBy: addedBy(task),
  };
}
