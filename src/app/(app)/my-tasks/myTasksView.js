// My tasks as the page and the home cards show them (CONTRACT 28, My tasks: sidebar, page and home
// cards): the groups by when a task is due (the company's Monday-to-Sunday week) or by project, the
// project select and the search, the home card's first 6 rows, and the hold that keeps a ticked
// row in its place until its leave has played. Pure and safe in the browser: today comes in as an
// argument ('YYYY-MM-DD', the company's date).
import { weekRange } from '@/lib/time';
import { phaseLabel, isPhase } from '@/modules/projectPlan/phases';

/** The groups by date, in order, with their headings. */
export const WHEN_GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
];

/** How many rows the home card shows. */
export const CARD_ROWS = 6;

/** The project select's first choice. */
export const ALL_PROJECTS = 'all';

/**
 * When a task is due, as its group: before today, today, after today up to this week's Sunday,
 * later, or no date. On a Sunday nothing is "This week" (Monday's tasks are "Later").
 * @param {string | null | undefined} dueDate 'YYYY-MM-DD'
 * @param {string} today the company's date
 * @returns {'overdue' | 'today' | 'week' | 'later' | 'none'}
 */
export function whenOf(dueDate, today) {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= weekRange(today).to ? 'week' : 'later';
}

/**
 * The tasks by date: Overdue, Today, This week, Later, No date, leaving out a group with nothing.
 * Each keeps the order it was given (due date, then P1 to P3).
 * @returns {Array<{ key: string, label: string, tone: 'red' | null, tasks: object[] }>}
 */
export function groupByWhen(tasks, today) {
  return WHEN_GROUPS.map(({ key, label }) => ({
    key,
    label,
    tone: key === 'overdue' ? 'red' : null,
    tasks: tasks.filter((task) => whenOf(task.dueDate, today) === key),
  })).filter((group) => group.tasks.length > 0);
}

const byName = (a, b) =>
  String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }) ||
  Number(a.id) - Number(b.id);

/** The projects of these tasks, once each, A to Z by name. */
export function projectsOf(tasks) {
  const seen = new Map();
  for (const task of tasks) {
    if (task.project?.id && !seen.has(task.project.id)) seen.set(task.project.id, task.project);
  }
  return [...seen.values()].sort(byName);
}

/**
 * The tasks by project, one group per project A to Z, each in the order it was given.
 * @returns {Array<{ key: string, label: string, tone: null, tasks: object[] }>}
 */
export function groupByProject(tasks) {
  return projectsOf(tasks).map((project) => ({
    key: `project-${project.id}`,
    label: project.name,
    tone: null,
    tasks: tasks.filter((task) => task.project?.id === project.id),
  }));
}

/** The groups for "Group by": When (the default) or Project. */
export function groupsFor(tasks, { by = 'when', today }) {
  return by === 'project' ? groupByProject(tasks) : groupByWhen(tasks, today);
}

/** The project select's choices: "All projects", then the projects of my tasks A to Z. */
export function projectChoices(tasks) {
  return [
    { value: ALL_PROJECTS, label: 'All projects' },
    ...projectsOf(tasks).map((project) => ({ value: String(project.id), label: project.name })),
  ];
}

const fold = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .toLowerCase();

/**
 * Whether a task's title or number matches the search: a title that contains the text (case
 * does not matter), "#61" task #61, and digits only ("61") task #61 as well as titles with 61.
 */
export function searchMatches(task, query) {
  const text = fold(query).trim();
  if (!text) return true;
  if (fold(task.title).includes(text)) return true;
  const digits = text.startsWith('#') ? text.slice(1).trim() : text;
  return /^\d+$/.test(digits) && Number(digits) === Number(task.id);
}

/**
 * The tasks the project select and the search keep.
 * @param {object[]} tasks
 * @param {{ projectId?: string, query?: string }} filters projectId: a project's id as text, or
 *   'all'
 */
export function filterMine(tasks, { projectId = ALL_PROJECTS, query = '' } = {}) {
  return tasks.filter(
    (task) =>
      (projectId === ALL_PROJECTS || String(task.project?.id) === String(projectId)) &&
      searchMatches(task, query),
  );
}

/**
 * The home card: the first `limit` tasks by date, under the headings of the groups they fall in
 * (each heading counts its whole group, as the page does), and how many more there are.
 * @returns {{ groups: Array<{ key, label, tone, count: number, tasks: object[] }>,
 *   total: number, more: number }}
 */
export function cardRows(tasks, limit = CARD_ROWS, today) {
  let left = limit;
  const groups = [];
  for (const group of groupByWhen(tasks, today)) {
    const shown = group.tasks.slice(0, Math.max(left, 0));
    left -= shown.length;
    if (shown.length) groups.push({ ...group, count: group.tasks.length, tasks: shown });
  }
  return { groups, total: tasks.length, more: Math.max(tasks.length - limit, 0) };
}

/** The phase's name, or "No phase yet". */
export const phaseName = (key) => (isPhase(key) ? phaseLabel(key) : 'No phase yet');

const PRIORITY_RANK = { p1: 1, p2: 2, p3: 3 };

/** listMine's order: due date (none last), then P1 to P3, then the older task first. */
export function mineOrder(a, b) {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  return rank || Number(a.id) - Number(b.id);
}

/**
 * The rows as the ticks show them: a ticked task stays in its place until its leave has played
 * (`held`, even when the refresh already left it out; drawn ticked, `ticking: true`, unless it was
 * opened again meanwhile, `open`), and one that left stays out until the page stops listing it
 * (`gone`).
 * @param {object[]} tasks the page's tasks, in listMine's order
 * @param {{ held: Map<number, object>, gone: Set<number>, open?: Set<number> }} ticks
 */
export function withTicks(tasks, { held, gone, open = new Set() }) {
  if (!held.size && !gone.size) return tasks;
  const rows = tasks.filter((task) => !gone.has(task.id));
  for (const task of held.values()) {
    if (rows.some((row) => row.id === task.id)) continue;
    const at = rows.findIndex((row) => mineOrder(task, row) < 0);
    rows.splice(at === -1 ? rows.length : at, 0, task);
  }
  const ticking = (id) => held.has(id) && !open.has(id);
  return rows.map((task) => (ticking(task.id) ? { ...task, ticking: true } : task));
}
