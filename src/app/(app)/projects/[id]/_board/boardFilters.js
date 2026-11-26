// The board's filters (CONTRACT 28, Board toolbar, filters, faces, Mine and search): the search
// ("pay", "#88", "88"), the Filter menu's items (Critical, With files, Overdue, Blocked, Show done
// tasks), Mine and one face, all combined; their counts, the line under the toolbar and the faces
// in order. On the Board the open cards that don't match are faded (done cards never are); in the
// Table the rows that don't match are hidden. "Show done tasks" isn't a match rule: it opens the
// done folds (Board) and adds the done rows (Table). Pure and safe in the browser: today comes in
// as an argument ('YYYY-MM-DD', the company's date).
import { plural } from '@/lib/text';

/** The Filter menu's match items, in order ("Show done tasks" comes after them). */
export const MATCH_ITEMS = ['critical', 'files', 'overdue', 'blocked'];
const ITEM_WORDS = {
  critical: 'Critical',
  files: 'With files',
  overdue: 'Overdue',
  blocked: 'Blocked',
};
/** The face for tasks for anyone on the project. */
export const ANYONE = 'anyone';
/** How many faces show before "+2". */
export const FACES_SHOWN = 5;

/**
 * Nothing filtered.
 * @returns {{ query: string, critical: boolean, files: boolean, overdue: boolean,
 *   blocked: boolean, showDone: boolean, mine: boolean, face: number | 'anyone' | null }}
 */
export function noFilters() {
  return {
    query: '',
    critical: false,
    files: false,
    overdue: false,
    blocked: false,
    showDone: false,
    mine: false,
    face: null,
  };
}

const isOpen = (task) => task.status !== 'done';
const fold = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .toLowerCase();
const filesOf = (task) => Number(task.files?.count ?? task.fileCount) || 0;

/**
 * Whether a task's title or number matches what was typed: a title that contains the text
 * (case-insensitive, after NFC), "#88" also task #88, and digits only ("88") task #88 as well as
 * titles containing 88, so "404" still finds "Fix the 404 page".
 * @param {{ id: number, title: string }} task
 * @param {string} query
 */
export function searchMatches(task, query) {
  const text = fold(query).trim();
  if (!text) return true;
  if (fold(task.title).includes(text)) return true;
  const digits = text.startsWith('#') ? text.slice(1).trim() : text;
  return /^\d+$/.test(digits) && Number(digits) === Number(task.id);
}

/** True when a task is open and its due date is before today. */
export const isOverdue = (task, today) =>
  isOpen(task) && Boolean(task.dueDate) && Boolean(today) && task.dueDate < today;

/** Whether the task's person is this face: a person's id, or 'anyone' for no person. */
function faceMatches(task, face) {
  if (face === null || face === undefined) return true;
  if (face === ANYONE) return !task.assignee;
  return Number(task.assignee?.id) === Number(face);
}

/**
 * Whether a task matches every filter that is on (search, the menu's match items, Mine and the
 * face). "Show done tasks" never takes a task out.
 * @param {object} task a board row (phasesView.toBoardTask)
 * @param {ReturnType<typeof noFilters>} filters
 * @param {number | null} viewerId Mine's person
 * @param {string} today the company's date (Overdue)
 */
export function matches(task, filters, viewerId, today) {
  if (!searchMatches(task, filters.query)) return false;
  if (filters.critical && task.priority !== 'p1') return false;
  if (filters.files && filesOf(task) === 0) return false;
  if (filters.overdue && !isOverdue(task, today)) return false;
  if (filters.blocked && task.statusChip?.status !== 'blocked') return false;
  if (filters.mine && Number(task.assignee?.id) !== Number(viewerId)) return false;
  return faceMatches(task, filters.face);
}

/** True when something takes tasks out of view: search, a match item, Mine or a face. */
export function isFiltering(filters) {
  const items = MATCH_ITEMS.some((item) => filters[item]);
  return Boolean(fold(filters.query).trim()) || items || filters.mine || filters.face !== null;
}

/** The Filter button's badge: the menu items that are on, "Show done tasks" included. */
export const badgeCount = (filters) =>
  MATCH_ITEMS.filter((item) => filters[item]).length + (filters.showDone ? 1 : 0);

/** True when a filter fades this card on the Board: an open card that doesn't match. */
export function isDimmed(task, filters, viewerId, today) {
  return isOpen(task) && isFiltering(filters) && !matches(task, filters, viewerId, today);
}

/**
 * How many open tasks each menu item and Mine count.
 * @param {object[]} tasks the tasks the viewer sees
 * @returns {{ critical: number, files: number, overdue: number, blocked: number, mine: number }}
 */
export function filterCounts(tasks, viewerId, today) {
  const open = tasks.filter(isOpen);
  const howMany = (test) => open.filter(test).length;
  return {
    critical: howMany((task) => task.priority === 'p1'),
    files: howMany((task) => filesOf(task) > 0),
    overdue: howMany((task) => isOverdue(task, today)),
    blocked: howMany((task) => task.statusChip?.status === 'blocked'),
    mine: howMany((task) => Number(task.assignee?.id) === Number(viewerId)),
  };
}

/**
 * The Filter menu: "Critical (4)", "With files (4)" (only for a viewer who may see files),
 * "Overdue (2)", "Blocked (1)", "Show done tasks".
 * @returns {Array<{ key: string, label: string }>}
 */
export function menuItems(counts, { files = true } = {}) {
  const items = MATCH_ITEMS.filter((item) => item !== 'files' || files).map((item) => ({
    key: item,
    label: `${ITEM_WORDS[item]} (${counts[item] ?? 0})`,
  }));
  return [...items, { key: 'showDone', label: 'Show done tasks' }];
}

/**
 * The line under the toolbar while something is filtered, counting open tasks only.
 * @param {{ count: number, view: 'board' | 'table', filters: object }} args count: the open
 *   tasks that match
 * @returns {{ text: string, clear: 'Clear all' | 'Show everyone' } | null} "Show everyone" when
 *   only a face is on; null while nothing is filtered
 */
export function filterLine({ count, view, filters }) {
  if (!isFiltering(filters)) return null;
  const faded = view === 'board' ? ' The others are faded.' : '';
  const text = count
    ? `${count} ${plural(count, 'task')} ${count === 1 ? 'matches' : 'match'}.${faded}`
    : 'No tasks match.';
  const onlyFace =
    filters.face !== null &&
    !fold(filters.query).trim() &&
    !filters.mine &&
    !MATCH_ITEMS.some((item) => filters[item]);
  return { text, clear: onlyFace ? 'Show everyone' : 'Clear all' };
}

/**
 * The faces in the toolbar: one per person with open tasks on this board, the project's PM first,
 * then A to Z by name; and how many open tasks are for anyone.
 * @param {object[]} tasks the tasks the viewer sees
 * @param {number | null} pmId
 * @returns {{ people: Array<{ id, name, avatarUrl, initials, count }>, anyone: number }}
 */
export function facesOf(tasks, pmId) {
  const byId = new Map();
  let anyone = 0;
  for (const task of tasks.filter(isOpen)) {
    if (!task.assignee) {
      anyone += 1;
      continue;
    }
    const { id, name, avatarUrl = null, initials = null } = task.assignee;
    const face = byId.get(id) ?? { id, name, avatarUrl, initials, count: 0 };
    face.count += 1;
    byId.set(id, face);
  }
  const isPm = (face) => pmId !== null && Number(face.id) === Number(pmId);
  const people = [...byId.values()].sort(
    (a, b) => Number(isPm(b)) - Number(isPm(a)) || String(a.name).localeCompare(String(b.name)),
  );
  return { people, anyone };
}

/** "Show only Simran Kaur's tasks (4)" */
export const faceLabel = (face) => `Show only ${face.name}'s tasks (${face.count})`;
/** "Show only tasks for anyone on the project (2)" */
export const anyoneLabel = (count) => `Show only tasks for anyone on the project (${count})`;

/**
 * The filters a page opens with: `?show=critical` or `?show=files` (the Summary tab's links) ticks
 * that item first, With files only for a viewer who may see files; never for a member.
 * @param {{ access: string, filesAccess?: string, show?: string | string[] | null }} input
 */
export function firstFilters({ access, filesAccess, show }) {
  const filters = noFilters();
  const wanted = Array.isArray(show) ? show[0] : show;
  if (access === 'member') return filters;
  if (wanted === 'critical') filters.critical = true;
  if (wanted === 'files' && filesAccess && filesAccess !== 'none') filters.files = true;
  return filters;
}
