// What the Board tab shows (CONTRACT 27, Board tab), worked out from the plan and the tasks the
// viewer may see: the columns in order (which past phases fold into
// "Done phases", which are slim, "No phase yet" only when needed), the order of the cards, which
// cards a filter dims, the phone's steps and the words beside them. Pure and safe in the browser:
// today comes in as an argument, and every date is 'YYYY-MM-DD' in the company time zone.
import { plural } from '@/lib/text';
import { formatDayShort } from '@/lib/time';
import { PROJECT_PHASES, isPhase, phaseIndex } from '@/modules/projectPlan/phases';
import { NO_PHASE, NO_PHASE_LABEL, sortDoneTasks, sortOpenTasks } from '../phasesView';
import { dateRange, lateNote, phaseStatus, plannedRange } from '../planFormat';
import { columnOf, countText } from './bandView';

/** The filter pills, in order: nothing dimmed, open P1s, open tasks with files. */
export const FILTERS = ['all', 'critical', 'files'];

/** The filter a URL asks for (`?show=critical`, `?show=files`); anything else is 'all'. */
export function filterOf(show) {
  const value = Array.isArray(show) ? show[0] : show;
  return value === 'critical' || value === 'files' ? value : 'all';
}

const isOpen = (task) => task.status !== 'done';

/**
 * A column's second line: the dates, the actual ones for a done phase, then planFormat's late
 * note. A skipped phase reads "Skipped" and nothing else.
 * @returns {{ dates: string | null, note: { text: string, tone: string } | null }}
 */
export function columnDates(status, phase, today) {
  if (status === 'skipped') return { dates: 'Skipped', note: null };
  const ran = status === 'done' && phase.actualStart && phase.actualEnd;
  const dates = ran
    ? dateRange(phase.actualStart, phase.actualEnd, today)
    : plannedRange(phase, today);
  return { dates, note: lateNote(status, phase, today) };
}

const isPast = (key, currentPhase) =>
  isPhase(currentPhase) && phaseIndex(key) < phaseIndex(currentPhase);

/** A phase column, before the board decides whether it shows. */
function phaseColumn({ key, label }, { plan, tasks, member, today }) {
  const row = plan.phases.find((phase) => phase.key === key) ?? { key, label };
  const status = phaseStatus(plan.currentPhase, row);
  const list = tasks.filter((task) => columnOf(task) === key);
  const open = sortOpenTasks(list.filter(isOpen));
  const past = isPast(key, plan.currentPhase);
  return {
    key,
    label,
    kind: 'phase',
    status,
    phase: row,
    folded: past && open.length === 0,
    slim: !past && status !== 'current' && list.length === 0,
    open,
    done: sortDoneTasks(list.filter((task) => !isOpen(task))),
    total: list.length,
    ...columnDates(status, row, today),
    emptyText: member ? 'Nothing for you yet' : `No tasks in ${label} yet.`,
  };
}

/** "No phase yet", for tasks from before phases. */
function noPhaseColumn(tasks) {
  const list = tasks.filter((task) => columnOf(task) === NO_PHASE);
  return {
    key: NO_PHASE,
    label: NO_PHASE_LABEL,
    kind: 'none',
    status: null,
    phase: null,
    folded: false,
    slim: false,
    open: sortOpenTasks(list.filter(isOpen)),
    done: sortDoneTasks(list.filter((task) => !isOpen(task))),
    total: list.length,
    dates: null,
    note: null,
    emptyText: '',
    width: 'normal',
  };
}

/**
 * The board's columns and the Done phases tiles.
 * @param {{ plan: { currentPhase: string | null, phases: object[] }, tasks: object[],
 *   member?: boolean, today: string, opened?: string[] }} args tasks: the ones the viewer sees
 *   (board rows); member: the member's board (their tasks and Anyone tasks); opened: the done
 *   phases whose tasks were opened from their tile
 * @returns {{ tiles: Array<{ key, label, skipped, text, note, opened }>, columns: object[] }}
 *   columns: the six phases in order, then No phase yet when some task has no phase. A phase before
 *   the current one with no open task is `folded` into a tile and `hidden` until opened (a
 *   member's tile only where they have tasks); `tag`: 'current', or 'done'/'skipped' on an opened
 *   folded phase; `doneOpen`: whether its done cards start unfolded; `width`: 'slim' (empty, after
 *   the current one), 'current' or 'normal'
 */
export function boardColumns({ plan, tasks, member = false, today, opened = [] }) {
  const args = { plan, tasks, member, today };
  const columns = PROJECT_PHASES.map((phase) => {
    const column = phaseColumn(phase, args);
    let tag = null;
    if (column.status === 'current') tag = 'current';
    else if (column.folded) tag = column.status === 'skipped' ? 'skipped' : 'done';
    return {
      ...column,
      hidden: column.folded && !opened.includes(column.key),
      tag,
      doneOpen: column.folded,
      width: column.slim ? 'slim' : column.status === 'current' ? 'current' : 'normal',
    };
  });
  const tiles = columns
    .filter((column) => column.folded && (!member || column.total > 0))
    .map((column) => tileOf(column, { member, opened }));
  if (tasks.some((task) => columnOf(task) === NO_PHASE)) {
    columns.push({ ...noPhaseColumn(tasks), hidden: false, tag: null, doneOpen: true });
  }
  return { tiles, columns };
}

/** One Done phases tile. */
function tileOf(column, { member, opened }) {
  const skipped = column.status === 'skipped';
  const doneCount = column.done.length;
  const text = member
    ? `${column.total} of yours, done`
    : column.total > 0
      ? `${doneCount} of ${column.total} ${plural(column.total, 'task')}`
      : 'No tasks';
  const note = !skipped && column.note?.tone === 'red' ? column.note.text : null;
  return {
    key: column.key,
    label: column.label,
    skipped,
    text,
    note,
    opened: opened.includes(column.key),
  };
}

/**
 * How many open tasks each pill counts.
 * @param {Array<{ status: string, priority: string, fileCount?: number }>} tasks
 * @returns {{ all: number, critical: number, files: number }}
 */
export function filterCounts(tasks) {
  const open = tasks.filter(isOpen);
  return {
    all: open.length,
    critical: open.filter((task) => task.priority === 'p1').length,
    files: open.filter((task) => task.fileCount > 0).length,
  };
}

/** The pills' words: 'All open (10)', 'Critical (4)', 'With files (4)'. */
export function filterItems(counts, { files = true } = {}) {
  const items = [
    { value: 'all', label: `All open (${counts.all})` },
    { value: 'critical', label: `Critical (${counts.critical})` },
  ];
  if (files) items.push({ value: 'files', label: `With files (${counts.files})` });
  return items;
}

/** The line under the pills, or '' with All open pressed. */
export function filterStatus(filter, counts) {
  if (filter === 'critical') {
    return counts.critical
      ? `${counts.critical} ${plural(counts.critical, 'critical task')} highlighted.`
      : 'No critical tasks open.';
  }
  if (filter === 'files') {
    return counts.files
      ? `${counts.files} ${plural(counts.files, 'task')} with files highlighted.`
      : 'No tasks with files.';
  }
  return '';
}

/** True when a pressed filter fades this card: every done card, and every other open one. */
export function isDimmed(task, filter) {
  if (filter === 'critical') return !isOpen(task) || task.priority !== 'p1';
  if (filter === 'files') return !isOpen(task) || !(task.fileCount > 0);
  return false;
}

/**
 * The phone's steps: the six phases, then No phase yet when it has tasks.
 * @param {object[]} columns boardColumns' columns
 * @returns {string[]}
 */
export function phoneSteps(columns) {
  return columns.map((column) => column.key);
}

/** The step a phone opens on: the current phase, or the first with no phase yet. */
export function firstStep(currentPhase) {
  return isPhase(currentPhase) ? currentPhase : PROJECT_PHASES[0].key;
}

/**
 * What the switcher says about the phase shown: 'Development · 6 of 12', and with a filter
 * pressed its matches among the open cards ('Development · 6 of 12 · 2 critical').
 * @param {{ label: string, open: object[], done: object[] }} column
 * @param {string} filter
 */
export function switcherText(column, filter) {
  const total = column.open.length + column.done.length;
  const parts = [column.label, countText({ total, done: column.done.length })];
  if (filter === 'critical') {
    parts.push(`${column.open.filter((task) => task.priority === 'p1').length} critical`);
  } else if (filter === 'files') {
    parts.push(`${column.open.filter((task) => task.fileCount > 0).length} with files`);
  }
  return parts.join(' · ');
}

/** 'Only your tasks and tasks for anyone on the project are shown. Progress counts all 29 tasks.' */
export function memberNote(total) {
  return `Only your tasks and tasks for anyone on the project are shown. Progress counts all ${total} ${plural(total, 'task')}.`;
}

/** "Riya Kapoor and Admins", or just "Admins" on a project without a PM. */
export const editorsText = (pmName) => (pmName ? `${pmName} and Admins` : 'Admins');

/**
 * The report line on an open card: 'Blocked · Fri, 20 Nov' or 'In progress · Fri, 20 Nov'.
 * @returns {{ text: string, tone: 'red'|'primary' } | null} null on a done task or with no report
 */
export function reportLine(task) {
  if (task.status === 'done' || !task.latestStatus || !task.latestOn) return null;
  const words = { blocked: 'Blocked', done: 'Done' }[task.latestStatus] ?? 'In progress';
  return {
    text: `${words} · ${formatDayShort(task.latestOn)}`,
    tone: task.latestStatus === 'blocked' ? 'red' : 'primary',
  };
}

/**
 * The ids focus moves to: a card, its title button, a column's "+ Add task", its "› 6 done" fold
 * button, a tile's button.
 */
export const cardId = (taskId) => `board-card-${taskId}`;
export const cardTitleId = (taskId) => `board-card-${taskId}-title`;
export const addTaskId = (columnKey) => `board-${columnKey}-add`;
export const foldButtonId = (columnKey) => `board-${columnKey}-done`;
export const tileButtonId = (columnKey) => `board-tile-${columnKey}`;
