// What the Board tab shows (CONTRACT 27 and 28, Done phases rail and columns), worked out from the
// plan and the tasks the viewer may see: the columns in order (which past phases fold into the Done
// phases rail, "No phase yet" only when needed), the order of the cards, the words of each column's
// second line, when the board fills the window, the phone's steps and the words beside them. Every
// phase column has one width (CSS, Columns.module.css); nothing here sizes a column. The filters are
// boardFilters.js's. Pure and safe in the browser: today comes in as an argument, and every date is
// 'YYYY-MM-DD' in the company time zone.
import { plural } from '@/lib/text';
import { PROJECT_PHASES, isPhase, phaseIndex } from '@/modules/projectPlan/phases';
import { NO_PHASE, NO_PHASE_LABEL, sortDoneTasks, sortOpenTasks } from '../phasesView';
import {
  dateRange,
  dayCount,
  daysBetween,
  lateNote,
  phaseStatus,
  plannedRange,
} from '../planFormat';
import { columnOf, countText } from './bandView';

/** In a column's open list: an open task, or a ticked one still playing its leave (holdOpen). */
const isOpen = (task) => task.status !== 'done' || task.holdOpen === true;

/** A column shows 4 or more cards: the toolbar and the board then fill the window (data-fill). */
export const FILL_CARDS = 4;

/**
 * The note beside a phase's dates on the board: planFormat's late note in its tone, else a muted
 * early one ("Ended 4 days early" for a done phase, "Started 7 days early" for the current one).
 * @returns {{ text: string, tone: 'red' | 'marigold' | 'muted' } | null}
 */
export function phaseNote(status, phase, today) {
  const late = lateNote(status, phase, today);
  if (late) return late;
  const { plannedStart, plannedEnd, actualStart, actualEnd } = phase;
  if (status === 'done' && actualEnd && plannedEnd) {
    const early = daysBetween(actualEnd, plannedEnd);
    if (early > 0) return { text: `Ended ${dayCount(early)} early`, tone: 'muted' };
  }
  if (status === 'current' && actualStart && plannedStart) {
    const early = daysBetween(actualStart, plannedStart);
    if (early > 0) return { text: `Started ${dayCount(early)} early`, tone: 'muted' };
  }
  return null;
}

/**
 * A column's second line: the dates, the actual ones for a done phase, then the note. A skipped
 * phase reads "Skipped" and nothing else.
 * @returns {{ dates: string | null, note: { text: string, tone: string } | null }}
 */
export function columnDates(status, phase, today) {
  if (status === 'skipped') return { dates: 'Skipped', note: null };
  const ran = status === 'done' && phase.actualStart && phase.actualEnd;
  const dates = ran
    ? dateRange(phase.actualStart, phase.actualEnd, today)
    : plannedRange(phase, today);
  return { dates, note: phaseNote(status, phase, today) };
}

const isPast = (key, currentPhase) =>
  isPhase(currentPhase) && phaseIndex(key) < phaseIndex(currentPhase);

/** What an empty column says: Completed first, then a member's words, then a manager's. */
function emptyTextFor({ member, completed }) {
  if (completed) return 'No tasks here. This project is completed.';
  return member ? 'Nothing for you yet' : 'No tasks yet';
}

/** A column's open and done cards, in order. */
function cardsOf(tasks, key) {
  const list = tasks.filter((task) => columnOf(task) === key);
  return {
    open: sortOpenTasks(list.filter(isOpen)),
    done: sortDoneTasks(list.filter((task) => !isOpen(task))),
    total: list.length,
  };
}

/** A phase column, before the board decides whether it shows. */
function phaseColumn({ key, label }, { plan, tasks, member, today, completed }) {
  const row = plan.phases.find((phase) => phase.key === key) ?? { key, label };
  const status = phaseStatus(plan.currentPhase, row);
  const cards = cardsOf(tasks, key);
  const folded = isPast(key, plan.currentPhase) && cards.open.length === 0;
  return {
    key,
    label,
    kind: 'phase',
    status,
    phase: row,
    current: status === 'current',
    finished: folded,
    skipped: status === 'skipped',
    folded,
    ...cards,
    ...columnDates(status, row, today),
    emptyText: emptyTextFor({ member, completed }),
  };
}

/** "No phase yet", for tasks from before phases: never folded, never a drop target. */
function noPhaseColumn(tasks) {
  return {
    key: NO_PHASE,
    label: NO_PHASE_LABEL,
    kind: 'none',
    status: null,
    phase: null,
    current: false,
    finished: false,
    skipped: false,
    folded: false,
    ...cardsOf(tasks, NO_PHASE),
    dates: null,
    note: null,
    emptyText: '',
    hidden: false,
    tag: null,
    doneOpen: false,
  };
}

/** The tag beside a column's name: Current, or Done / Skipped on an opened done phase. */
function tagOf(column) {
  if (column.status === 'current') return 'current';
  if (column.folded) return column.status === 'skipped' ? 'skipped' : 'done';
  return null;
}

/**
 * The board's columns and the Done phases rail's tiles.
 * @param {{ plan: { currentPhase: string | null, phases: object[] }, tasks: object[],
 *   member?: boolean, today: string, opened?: string[], completed?: boolean }} args tasks: the
 *   ones the viewer sees (board rows); member: the member's board (their tasks and Anyone tasks);
 *   opened: the done phases opened as columns (from a tile or a band part); completed: the project
 *   is Completed (its empty columns say so)
 * @returns {{ tiles: Array<{ key, label, skipped, text, note, opened }>, columns: Array<{ key,
 *   label, kind: 'phase' | 'none', status, phase, current: boolean, finished: boolean,
 *   skipped: boolean, folded: boolean, hidden: boolean, tag: 'current' | 'done' | 'skipped' |
 *   null, doneOpen: boolean, open: object[], done: object[], total: number, dates, note,
 *   emptyText: string }> }} columns: the six phases in order, then No phase yet when some task has
 *   no phase. A phase before the current one with no open task is `folded` (`finished`) into the
 *   rail and `hidden` until opened (a member's tile only where they have tasks); with no current
 *   phase nothing folds. doneOpen: its "› 6 done" starts open (an opened done phase)
 */
export function boardColumns({
  plan,
  tasks,
  member = false,
  today,
  opened = [],
  completed = false,
}) {
  const args = { plan, tasks, member, today, completed };
  const columns = PROJECT_PHASES.map((phase) => {
    const column = phaseColumn(phase, args);
    return {
      ...column,
      hidden: column.folded && !opened.includes(column.key),
      tag: tagOf(column),
      doneOpen: column.folded,
    };
  });
  const tiles = columns
    .filter((column) => column.folded && (!member || column.total > 0))
    .map((column) => tileOf(column, { member, opened }));
  if (tasks.some((task) => columnOf(task) === NO_PHASE)) columns.push(noPhaseColumn(tasks));
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

/** The closed rail's hidden words: ': Requirement gathering, Design. Show them.' */
export const railHiddenText = (tiles) =>
  `: ${tiles.map((tile) => tile.label).join(', ')}. Show them.`;

/**
 * Whether the toolbar and the board take the window's height: some shown column has 4 or more
 * cards (open, plus the done cards of an opened fold).
 * @param {object[]} columns boardColumns' columns
 * @param {(column: object) => boolean} isFoldOpen
 */
export function fillsWindow(columns, isFoldOpen) {
  return columns.some(
    (column) =>
      !column.hidden &&
      column.open.length + (isFoldOpen(column) ? column.done.length : 0) >= FILL_CARDS,
  );
}

/**
 * The columns that fold away and whether the rail is new, between the board before a phase move
 * and after it (phaseMotion's `folds` and `railIsNew`).
 * @param {{ tiles: object[], columns: object[] }} before boardColumns' answer before the move
 * @param {{ tiles: object[], columns: object[] }} after the same after it
 * @returns {{ folds: string[], railIsNew: boolean }}
 */
export function foldsBetween(before, after) {
  const shownBefore = new Set(before.columns.filter((c) => !c.hidden).map((c) => c.key));
  return {
    folds: after.columns.filter((c) => c.hidden && shownBefore.has(c.key)).map((c) => c.key),
    railIsNew: before.tiles.length === 0 && after.tiles.length > 0,
  };
}

/** The phase move confirm's muted line: '5 open tasks stay in Testing.'; null at 0. */
export function stayText(openCount, label) {
  if (!openCount) return null;
  const verb = openCount === 1 ? 'stays' : 'stay';
  return `${openCount} ${plural(openCount, 'open task')} ${verb} in ${label}.`;
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

/** What the switcher says about the phase shown: 'Development · 6 of 12'. */
export function switcherText(column) {
  const total = column.open.length + column.done.length;
  return [column.label, countText({ total, done: column.done.length })].join(' · ');
}

/** 'Only your tasks and tasks for anyone on the project are shown. Progress counts all 29 tasks.' */
export function memberNote(total) {
  return `Only your tasks and tasks for anyone on the project are shown. Progress counts all ${total} ${plural(total, 'task')}.`;
}

/** "Riya Kapoor and Admins", or just "Admins" on a project without a PM. */
export const editorsText = (pmName) => (pmName ? `${pmName} and Admins` : 'Admins');

/**
 * The ids focus moves to: a card, its title button, a column's "+ Add task", its "› 6 done" fold
 * button, a tile's button, the rail's toggle, the toolbar's Add task, its Board and Table buttons,
 * Reopen project (the toolbar's or the header's, whichever is drawn).
 */
export const cardId = (taskId) => `board-card-${taskId}`;
export const cardTitleId = (taskId) => `board-card-${taskId}-title`;
export const addTaskId = (columnKey) => `board-${columnKey}-add`;
export const foldButtonId = (columnKey) => `board-${columnKey}-done`;
export const tileButtonId = (columnKey) => `board-tile-${columnKey}`;
export const RAIL_BUTTON_ID = 'board-rail';
export const ADD_TASK_ID = 'board-add-task';
export const viewButtonId = (view) => `board-view-${view}`;
export const REOPEN_ID = 'project-reopen';
