// What a task on the Board reads (CONTRACT 22, 27 and 28): the order of the open and done tasks, the
// owner's away label, the latest report line and a task as the board's cards and the Table read it
// (toBoardTask). The columns themselves are _board/boardView.js's. Pure and safe in the browser:
// today comes in as an argument, and every date is 'YYYY-MM-DD' in the company time zone.
import { formatDayShort, formatRelativeDay } from '@/lib/time';

/** The key and name of the last column, for tasks without a phase (from before phases). */
export const NO_PHASE = 'none';
export const NO_PHASE_LABEL = 'No phase yet';

const PRIORITY_RANK = { p1: 1, p2: 2, p3: 3 };
const NO_DATE = '9999-99-99';
const REPORT_LABELS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };
const CHIP_STATUSES = new Set(Object.keys(REPORT_LABELS));

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

/** The task's person as a card shows them, with what the people window and Mine need. */
function personOf(assignee, viewerId) {
  if (!assignee) return null;
  return {
    id: assignee.id,
    name: assignee.name,
    avatarUrl: assignee.avatarUrl ?? null,
    initials: assignee.initials ?? null,
    role: assignee.role ?? null,
    status: assignee.status ?? null,
    away: awayLabel(assignee),
    isViewer:
      viewerId !== null && viewerId !== undefined && Number(assignee.id) === Number(viewerId),
  };
}

/** The status chip: the newest report line the viewer may see ('in_progress' when unknown). */
function chipOf(line) {
  if (!line?.workDate) return null;
  const status = CHIP_STATUSES.has(line.status) ? line.status : 'in_progress';
  return { status, workDate: line.workDate };
}

const count = (value) => Math.max(0, Math.trunc(Number(value)) || 0);

/**
 * A task as the board shows it: plain values and ready-made labels (listForProject's row in, with
 * what BoardTab read per task for this viewer).
 * @param {object} task listForProject's row
 * @param {string} today the company's date
 * @param {{ viewerId?: number | null, files?: { count: number, chips: object[] },
 *   line?: { status: string, workDate: string, userName?: string } | null, minutes?: number,
 *   updateCount?: number, privateLinkCount?: number }} [extras] files: chipsForTasks' entry (the
 *   files on it this viewer may see, own and linked); line: latestLinesFor's (the newest report
 *   line the viewer may see); minutes: minutesByTask's (everyone's, or only the viewer's without
 *   team.view); updateCount: updateCountsFor's; privateLinkCount: privateLinkCounts' (managers)
 * @returns {{ id, title, details, priority, status, phase, dueDate,
 *   assignee: { id, name, avatarUrl, initials, role, status, away, isViewer } | null,
 *   statusChip: { status: 'in_progress' | 'blocked' | 'done', workDate: string } | null,
 *   latest: string | null, files: { count: number, chips: object[] }, fileCount: number,
 *   minutes: number, updateCount: number, privateLinkCount: number,
 *   createdBy: { id, name } | null }} latest: 'Neha, yesterday: In progress' (the status chip's
 *   line in words); fileCount: files.count
 */
export function toBoardTask(task, today, extras = {}) {
  const { viewerId = null, files, line = null } = extras;
  const fileCount = count(files?.count);
  return {
    id: task.id,
    title: task.title,
    details: task.details ?? null,
    priority: task.priority,
    status: task.status,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
    assignee: personOf(task.assignee, viewerId),
    statusChip: chipOf(line),
    latest: line ? latestReportLabel(line, today) : null,
    files: { count: fileCount, chips: Array.isArray(files?.chips) ? files.chips : [] },
    fileCount,
    minutes: count(extras.minutes),
    updateCount: count(extras.updateCount),
    privateLinkCount: count(extras.privateLinkCount),
    createdBy: addedBy(task),
  };
}
