// What the Table view of the Board tab shows (CONTRACT 28, Table and bulk bar): its columns for
// each viewer, the rows grouped by phase as the board's columns are (or listed flat while a header
// sorts them), every sort and its reverse, the words of the Status column and of the line under a
// title, and the empty row. The rows are the board's own tasks (`board.columns`), so a filter, the
// persons on their way and a ticked task still leaving show the same here as on the Board. Pure
// and safe in the browser: dates are 'YYYY-MM-DD' in the company time zone.
import { formatDayShort } from '@/lib/time';
import { phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';
import { NO_PHASE, NO_PHASE_LABEL } from '../../phasesView';
import { columnOf } from '../bandView';

/** The header of each column (the select box and the tick have none you can see). */
export const HEADERS = {
  num: '#',
  task: 'Task',
  phase: 'Phase',
  person: 'Person',
  priority: 'Priority',
  due: 'Due',
  status: 'Status',
  files: 'Files',
  time: 'Time',
};

const PRIORITY_RANK = { p1: 1, p2: 2, p3: 3 };
const prank = (task) => PRIORITY_RANK[task.priority] ?? 9;
const text = (value) => String(value ?? '');
const byText = (a, b) => text(a).localeCompare(text(b));
const byDate = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Soonest first, no date last (Priority's tie-break). */
const byDue = (a, b) =>
  Number(!a.dueDate) - Number(!b.dueDate) ||
  (a.dueDate && b.dueDate ? byDate(a.dueDate, b.dueDate) : 0);

/** The files on a task the viewer may see (chipsForTasks' count). */
export const filesOf = (task) => Math.max(0, Number(task?.files?.count ?? task?.fileCount) || 0);
const minutesOf = (task) => Math.max(0, Number(task?.minutes) || 0);

/**
 * Where a task stands in the Status column's order: Blocked, In progress, To do, a Done line,
 * then done tasks.
 */
export function statusRank(task) {
  if (task.status === 'done') return 4;
  const line = task.statusChip?.status;
  if (line === 'blocked') return 0;
  if (line === 'in_progress') return 1;
  return line === 'done' ? 3 : 2;
}

/**
 * Every sort: `first` is the first click's direction (`aria-sort`), `compare` that order, and
 * `last` the rows that stay last both ways (no date, Anyone, No phase yet). Ties fall back to the
 * board order.
 */
export const SORTS = {
  num: { first: 'ascending', compare: (a, b) => Number(a.id) - Number(b.id) },
  task: { first: 'ascending', compare: (a, b) => byText(a.title, b.title) },
  phase: {
    first: 'ascending',
    compare: (a, b) => phaseIndex(a.phase) - phaseIndex(b.phase),
    last: (task) => columnOf(task) === NO_PHASE,
  },
  person: {
    first: 'ascending',
    compare: (a, b) => byText(a.assignee?.name, b.assignee?.name),
    last: (task) => !task.assignee,
  },
  priority: { first: 'ascending', compare: (a, b) => prank(a) - prank(b) || byDue(a, b) },
  due: {
    first: 'ascending',
    compare: (a, b) => byDate(a.dueDate, b.dueDate) || prank(a) - prank(b),
    last: (task) => !task.dueDate,
  },
  status: { first: 'ascending', compare: (a, b) => statusRank(a) - statusRank(b) },
  files: { first: 'descending', compare: (a, b) => filesOf(b) - filesOf(a) },
  time: { first: 'descending', compare: (a, b) => minutesOf(b) - minutesOf(a) },
};

/** The board order: each task's place in the columns, open cards then done ones. */
export function boardRank(columns = []) {
  const rank = new Map();
  for (const column of columns) {
    for (const task of [...column.open, ...column.done]) {
      if (!rank.has(task.id)) rank.set(task.id, rank.size);
    }
  }
  return rank;
}

/**
 * The rows in a header's order: the first click's order, reversed when `dir` isn't that column's
 * first direction; the `last` rows stay last both ways; ties keep the board order.
 * @param {object[]} rows
 * @param {{ key: string | null, dir: 'ascending' | 'descending' }} sort
 * @param {Map<number, number>} [rank] boardRank's
 * @returns {object[]} a new array
 */
export function sortRows(rows, sort, rank = new Map()) {
  const spec = SORTS[sort?.key];
  if (!spec) return [...rows];
  const place = (task) => rank.get(task.id) ?? Number.MAX_SAFE_INTEGER;
  const byBoard = (a, b) => place(a) - place(b);
  const sign = sort.dir === spec.first ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (spec.last) {
      const lastA = spec.last(a);
      const lastB = spec.last(b);
      if (lastA !== lastB) return lastA ? 1 : -1;
      if (lastA) return byBoard(a, b);
    }
    return sign * spec.compare(a, b) || byBoard(a, b);
  });
}

/** The direction a header says it is sorted in (`aria-sort`), only on the sorted header. */
export const ariaSortFor = (key, sort) => (sort?.key === key ? sort.dir : undefined);

/**
 * The Table's columns for a viewer, in order. The project's PM and Admins get the select box and
 * the tick; the Phase column shows only while a header sorts the rows (the groups say it
 * otherwise); Files only for a viewer who may see files; Time only in the PM view (managers and
 * another PM, whose numbers are everyone's).
 * @param {'manage' | 'team' | 'member'} access
 * @param {'manage' | 'member' | 'none'} filesAccess
 * @param {{ sorted?: boolean }} [options]
 * @returns {string[]} keys among select, tick and HEADERS'
 */
export function columnsFor(access, filesAccess, { sorted = false } = {}) {
  const keys = access === 'manage' ? ['select', 'tick'] : [];
  keys.push('num', 'task');
  if (sorted) keys.push('phase');
  keys.push('person', 'priority', 'due', 'status');
  if (filesAccess && filesAccess !== 'none') keys.push('files');
  if (access !== 'member') keys.push('time');
  return keys;
}

/** A phase column's rows: its open tasks, then the done ones while they are shown. */
function rowsOf(column, { matches, filtering, showDone }) {
  const list = showDone ? [...column.open, ...column.done] : column.open;
  return filtering ? list.filter(matches) : list;
}

/**
 * The groups, as the board's columns: one per phase in order, No phase yet last. A past phase
 * with no open tasks (in the Done phases rail), No phase yet, and every phase while something is
 * filtered, show only with rows.
 * @param {object[]} columns boardColumns' (the board object's `columns`)
 * @param {{ matches: (task: object) => boolean, filtering: boolean, showDone: boolean }} filters
 * @returns {Array<{ column: object, rows: object[] }>}
 */
export function groupRows(columns = [], filters) {
  return columns
    .map((column) => ({ column, rows: rowsOf(column, filters) }))
    .filter(({ column, rows }) => {
      if (rows.length > 0) return true;
      return !filters.filtering && !column.folded && column.kind !== 'none';
    });
}

/**
 * What the Table shows: the groups, or one flat list while a header sorts it, and the rows in
 * the order they are drawn (`rows`) with the ones that can be selected (open; `selectable`).
 * @param {{ columns: object[], filters: { matches: Function, any: boolean, showDone: boolean } }}
 *   board the board object's columns and filters
 * @param {{ key: string | null, dir: string }} sort the Table's sort (`board.tableSort`)
 * @returns {{ flat: boolean, groups: Array<{ column: object, rows: object[] }>,
 *   rows: object[], selectable: object[] }}
 */
export function tableRows(board, sort) {
  const filters = {
    matches: board.filters.matches,
    filtering: Boolean(board.filters.any),
    showDone: Boolean(board.filters.showDone),
  };
  const flat = Boolean(SORTS[sort?.key]);
  let groups;
  let rows;
  if (flat) {
    const all = board.columns.flatMap((column) => rowsOf(column, filters));
    rows = sortRows(all, sort, boardRank(board.columns));
    groups = [];
  } else {
    groups = groupRows(board.columns, filters);
    rows = groups.flatMap((group) => group.rows);
  }
  return { flat, groups, rows, selectable: rows.filter((task) => task.status !== 'done') };
}

/**
 * Whether a group offers "+ Add task" (New task in that phase): the project's PM and Admins on a
 * project that isn't Completed, never on a done phase or on No phase yet.
 */
export function canAddTo(column, { access, status }) {
  return (
    access === 'manage' && status !== 'completed' && column.kind === 'phase' && !column.finished
  );
}

/** The line that stands for no rows, or null while rows (or groups) say enough. */
export function emptyText({ rows, filtering, access, total }) {
  if (rows > 0) return null;
  if (filtering) return 'No tasks match.';
  if (total > 0) return null;
  return access === 'member' ? 'Nothing for you on this project yet.' : 'No tasks yet.';
}

const LINE_WORDS = {
  in_progress: { text: 'In progress', tone: 'primary' },
  blocked: { text: 'Blocked', tone: 'red' },
  done: { text: 'Done', tone: 'green' },
};

/**
 * The Status column: "Done" for a done task, the status chip of the newest report line the viewer
 * may see, else the muted "To do".
 * @returns {{ text: string, tone: 'primary' | 'red' | 'green' | null, date: string | null }}
 */
export function statusText(task) {
  if (task.status === 'done') return { text: 'Done', tone: 'green', date: null };
  const words = LINE_WORDS[task.statusChip?.status];
  if (!words) return { text: 'To do', tone: null, date: null };
  const date = task.statusChip.workDate ? formatDayShort(task.statusChip.workDate) : null;
  return { ...words, date };
}

/**
 * The 13 px line under an open task's title: "Blocked · Thu, 19 Nov" (red), "In progress · Mon,
 * 23 Nov" (primary), "Done · Fri, 20 Nov" (green); null on a done task or without a line.
 * @returns {{ text: string, tone: 'primary' | 'red' | 'green' } | null}
 */
export function rowLine(task) {
  const chip = task.statusChip;
  if (task.status === 'done' || !chip?.workDate) return null;
  const words = LINE_WORDS[chip.status] ?? LINE_WORDS.in_progress;
  return { text: `${words.text} · ${formatDayShort(chip.workDate)}`, tone: words.tone };
}

/** The Phase column's words: the phase's name, or "No phase yet". */
export const phaseText = (task) =>
  columnOf(task) === NO_PHASE ? NO_PHASE_LABEL : phaseLabel(task.phase);
