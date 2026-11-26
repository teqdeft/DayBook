// The people window's rows and its share confirm (CONTRACT 28, The people window): who a task can be
// given to, in the window's order (Me, Anyone on the project, the project's PM, the active members A
// to Z, then the task's current person when the list doesn't hold them), the search, and the line
// shown before a pick would let someone who isn't a manager open an "Only PM and Admins" file through
// the task. Pure and safe in the browser.
import { isProjectManager } from '@/modules/projectFiles/access';
import { ROLE_LABELS } from '@/lib/permissions';
import { awayLabel } from '../phasesView';

/** The Anyone row's key (a row's `key` is its person's id, or this). */
export const ANYONE = 'anyone';

/**
 * @typedef {{ id: number, name: string, initials?: string, avatarUrl?: string | null,
 *   designation?: string | null, role: string, status?: string, kind?: 'me' | 'pm' | 'member',
 *   openHere?: number }} AssigneeOption B's listAssigneeOptions row (`head.options`)
 * @typedef {{ key: string, id: number | null, name: string, sub: string, checked: boolean,
 *   disabled: boolean, person: { id: number, name: string, initials?: string,
 *   avatarUrl?: string | null, role: string, status: string } | null }} PeopleRow
 */

/** The id of a task's person, null for anyone on the project. */
export const personIdOf = (task) => (task?.assignee ? Number(task.assignee.id) : null);

const sameId = (a, b) => ((a ?? null) === null ? (b ?? null) === null : Number(a) === Number(b));

const openHere = (option) => `${Number(option.openHere) || 0} open here`;
const roleName = (role) => ROLE_LABELS[role] ?? '';

/** The second line of a row: "Project manager · 3 open here", "Full stack developer · 4 open here". */
function subOf(option) {
  if (option.kind === 'pm') return `Project manager · ${openHere(option)}`;
  if (option.kind === 'me') return `${roleName(option.role)} · ${openHere(option)}`;
  return `${option.designation || roleName(option.role)} · ${openHere(option)}`;
}

/** A row's person: what the avatar and the share rule read. */
function personOf(source) {
  return {
    id: Number(source.id),
    name: source.name,
    initials: source.initials,
    avatarUrl: source.avatarUrl ?? null,
    role: source.role,
    status: source.status ?? 'active',
  };
}

function optionRow(option, task, name) {
  return {
    key: String(option.id),
    id: Number(option.id),
    name,
    sub: subOf(option),
    checked: Boolean(task) && sameId(personIdOf(task), option.id),
    disabled: false,
    person: personOf(option),
  };
}

/**
 * The task's current person when the options don't hold them, checked and last: someone away
 * ("Not on the project", "Deactivated"; can't be picked again) or an Admin who took it and isn't on
 * the project ("Admin"; picking it again changes nothing).
 */
function currentRow(task) {
  const assignee = task.assignee;
  const away = assignee.away ?? awayLabel(assignee);
  return {
    key: String(assignee.id),
    id: Number(assignee.id),
    name: assignee.name,
    sub: away ?? roleName(assignee.role ?? 'admin'),
    checked: true,
    disabled: Boolean(away),
    person: personOf(assignee),
  };
}

/**
 * The rows of the people window.
 * @param {AssigneeOption[]} options `head.options`, in B's order
 * @param {object | null} task the one task (its person is checked), null for several (bulk)
 * @param {number} viewerId
 * @returns {PeopleRow[]}
 */
export function peopleRows(options = [], task, viewerId) {
  const list = options.filter((option) => option && option.status !== 'deactivated');
  const me = list.find((option) => option.kind === 'me' || sameId(option.id, viewerId));
  const pm = list.find((option) => option.kind === 'pm' && option !== me);
  const members = list
    .filter((option) => option !== me && option !== pm)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const rows = [];
  if (me) rows.push(optionRow(me, task, `Me (${me.name})`));
  rows.push({
    key: ANYONE,
    id: null,
    name: 'Anyone on the project',
    sub: 'Everyone on the project sees it',
    checked: Boolean(task) && personIdOf(task) === null,
    disabled: false,
    person: null,
  });
  if (pm) rows.push(optionRow(pm, task, pm.name));
  for (const member of members) rows.push(optionRow(member, task, member.name));
  if (task?.assignee && !rows.some((row) => sameId(row.id, task.assignee.id))) {
    rows.push(currentRow(task));
  }
  return rows;
}

/**
 * The rows whose name holds the search ("Find a person"), case and accents as typed.
 * @param {PeopleRow[]} rows
 * @param {string} query
 */
export function filterRows(rows, query) {
  const wanted = String(query ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
  if (!wanted) return rows;
  return rows.filter((row) => row.name.normalize('NFC').toLowerCase().includes(wanted));
}

/** The tasks a pick of `assigneeId` would newly share a private link on (the person changes). */
export function sharingTasks(tasks = [], assigneeId) {
  return tasks.filter(
    (task) => Number(task?.privateLinkCount) > 0 && !sameId(personIdOf(task), assigneeId),
  );
}

/**
 * True when giving these tasks to `assignee` asks the share confirm first: a task with an "Only PM
 * and Admins" file changes person, and the new person isn't a manager (anyone on the project never
 * is). Taking a task never asks (the viewer manages).
 * @param {object[]} tasks
 * @param {{ id: number, role: string, status: string } | null} assignee null: anyone
 * @param {{ id: number, pmId: number | null }} project
 */
export function shareNeeded(tasks, assignee, project) {
  if (isProjectManager(assignee, project)) return false;
  return sharingTasks(tasks, assignee ? assignee.id : null).length > 0;
}

const fileWords = (count) => (count === 1 ? 'a file' : `${count} files`);
const itThem = (count) => (count === 1 ? 'it' : 'them');

/**
 * The share confirm's line in the people window (Every message).
 * @param {object[]} tasks the window's tasks (one, or the bulk selection)
 * @param {string | null} name the picked person's full name; null for anyone on the project
 * @param {number | null} [assigneeId] the picked person, so a task already theirs isn't counted
 */
export function peopleShareText(tasks = [], name, assigneeId) {
  const who = name ?? 'Everyone on the project';
  if (tasks.length === 1) {
    const count = Number(tasks[0].privateLinkCount) || 1;
    return `This task has ${fileWords(count)} only for PM and Admins. ${who} will be able to open ${itThem(count)} from this task.`;
  }
  const picked = assigneeId === undefined ? tasks : sharingTasks(tasks, assigneeId);
  const sharing = picked.filter((task) => Number(task.privateLinkCount) > 0);
  if (sharing.length <= 1) {
    const count = Number(sharing[0]?.privateLinkCount) || 1;
    return `1 of these tasks has ${fileWords(count)} only for PM and Admins. ${who} will be able to open ${itThem(count)} from that task.`;
  }
  return `${sharing.length} of these tasks have files only for PM and Admins. ${who} will be able to open them from those tasks.`;
}
