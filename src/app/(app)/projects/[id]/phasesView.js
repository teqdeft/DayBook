// What the Phases tab shows (CONTRACT 22), worked out from the plan and the task list: the sections
// in order, which one opens first, the order of the tasks in each and the words beside them. Pure and
// safe in the browser: today comes in as an argument, and every date is 'YYYY-MM-DD' in the company
// time zone.
import { plural } from '@/lib/text';
import { formatDayShort, formatRelativeDay } from '@/lib/time';
import { PROJECT_PHASES, isPhase } from '@/modules/projectPlan/phases';
import { dateRange, lateNote, phaseStatus, shortDate } from './planFormat';

/** The key and name of the last section, for tasks without a phase (from before phases). */
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

/**
 * One section per phase, in order, then "No phase yet" when some tasks have no phase.
 * @param {{ plan: { currentPhase: string | null, phases: object[] }, tasks: object[] }} args
 *   tasks: rows with `phase` (null or a key) and `status`
 * @returns {Array<{ key: string, label: string, phase: object | null, status: string | null,
 *   open: object[], done: object[], total: number }>} phase: the plan's row (null for No phase yet);
 *   status: phaseStatus (null for No phase yet); open and done in the order they are shown
 */
export function phaseSections({ plan, tasks }) {
  const byPhase = new Map();
  for (const task of tasks) {
    const key = isPhase(task.phase) ? task.phase : NO_PHASE;
    if (!byPhase.has(key)) byPhase.set(key, []);
    byPhase.get(key).push(task);
  }
  const section = (key, label, phase, status) => {
    const list = byPhase.get(key) ?? [];
    return {
      key,
      label,
      phase,
      status,
      open: sortOpenTasks(list.filter((task) => task.status !== 'done')),
      done: sortDoneTasks(list.filter((task) => task.status === 'done')),
      total: list.length,
    };
  };
  const sections = PROJECT_PHASES.map(({ key, label }) => {
    const phase = plan.phases.find((row) => row.key === key) ?? { key, label };
    return section(key, label, phase, phaseStatus(plan.currentPhase, phase));
  });
  if (byPhase.has(NO_PHASE)) sections.push(section(NO_PHASE, NO_PHASE_LABEL, null, null));
  return sections;
}

/** The section open when the tab loads: the current phase, or the first with no phase yet. */
export function firstOpenSection(currentPhase) {
  return isPhase(currentPhase) ? currentPhase : PROJECT_PHASES[0].key;
}

/** '3 of 12 tasks', '1 of 1 task', 'No tasks yet' */
export function taskCount(done, total) {
  return total > 0 ? `${done} of ${total} ${plural(total, 'task')}` : 'No tasks yet';
}

/** 'Show 10 done tasks', 'Show 1 done task' or 'Hide done tasks'. */
export function doneToggleLabel(shown, count) {
  return shown ? 'Hide done tasks' : `Show ${count} done ${plural(count, 'task')}`;
}

/** What a section with no open task to list says. */
export function emptyTasksText(total) {
  return total > 0 ? 'All tasks are done.' : 'No tasks yet.';
}

/** 'Planned 6 to 23 Oct', 'Planned from 6 Oct', 'Planned until 23 Oct' or 'No planned dates'. */
export function plannedText({ plannedStart, plannedEnd }, today) {
  if (plannedStart && plannedEnd) return `Planned ${dateRange(plannedStart, plannedEnd, today)}`;
  if (plannedStart) return `Planned from ${shortDate(plannedStart, today)}`;
  if (plannedEnd) return `Planned until ${shortDate(plannedEnd, today)}`;
  return 'No planned dates';
}

/**
 * When the phase really ran: 'Started 6 Oct' while current, 'Actual 6 to 23 Oct' once done.
 * @returns {string | null} null for later and skipped phases, and without the dates
 */
export function actualText(status, { actualStart, actualEnd }, today) {
  if (status === 'current' && actualStart) return `Started ${shortDate(actualStart, today)}`;
  if (status !== 'done') return null;
  if (actualStart && actualEnd) return `Actual ${dateRange(actualStart, actualEnd, today)}`;
  return actualEnd ? `Ended ${shortDate(actualEnd, today)}` : null;
}

/**
 * The dates and the late note beside a phase. The note is planFormat's, so Phases, Timeline and
 * the move dialog agree; "Started 7 days late" already says when it started, so the start is left
 * out then.
 * @returns {{ planned: string | null, actual: string | null,
 *   note: { text: string, tone: 'red'|'marigold'|'muted' } | null }} all null for No phase yet
 */
export function sectionDates({ phase, status }, today) {
  if (!phase || !status) return { planned: null, actual: null, note: null };
  const note = lateNote(status, phase, today);
  const actual = note?.text.startsWith('Started') ? null : actualText(status, phase, today);
  return { planned: plannedText(phase, today), actual, note };
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

/**
 * A task as the board shows it: plain values and ready-made labels (listForProject's row in).
 * @returns {{ id, title, details, priority, status, phase, dueDate,
 *   assignee: { id, name, away } | null, latest: string | null, latestStatus: string | null }}
 */
export function toBoardTask(task, today) {
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
      ? { id: task.assignee.id, name: task.assignee.name, away: awayLabel(task.assignee) }
      : null,
    latest: latestReportLabel(latest, today),
    latestStatus: latest ? (latest.status ?? 'in_progress') : null,
  };
}
