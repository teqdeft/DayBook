// Who a task can be for in the New task and Edit task window, and what a save would share (CONTRACT
// 28, New task and Edit task; The assignee rule; Linking and the share confirm): the "Assign to"
// radio chips in order, the task to edit in one shape, the person a chip stands for, and the
// "Only PM and Admins" project files a save would let a person who isn't a manager open through
// the task. Pure and safe in the browser (taskFormModel.js re-exports it).
import { isPhase } from '@/modules/projectPlan/phases';
import { filesToShare, personOf, privateFiles } from '@/components/files/shareConfirmView';
import { awayLabel } from '../phasesView';

export const ANYONE_LABEL = 'Anyone on the project';
/** The "Find a person" field shows above the chips past this many. */
export const FIND_FROM = 8;

const KIND_RANK = { me: 0, pm: 1, member: 2 };

/** " (not on the project)", " (deactivated)", " (Admin)" or nothing: why a person is listed last. */
function currentNote(person) {
  const away = person.away !== undefined ? person.away : awayLabel(person);
  if (away) return ` (${away.toLowerCase()})`;
  return person.role === 'admin' ? ' (Admin)' : '';
}

/**
 * The "Assign to" chips: "Anyone on the project" (the default), "Me (Riya Kapoor)", the project's PM
 * when the viewer isn't, the active members A to Z; on Edit the current person stays, last and
 * checked, when they aren't on the list ("Vishal Saini (not on the project)", "Arvind Menon
 * (Admin)"), so no Edit opens with no chip checked and saves the task as Anyone by mistake.
 * @param {Array<{ id: number, name: string, kind?: string }>} options AssigneeOption[]
 * @param {{ assignee?: object | null } | null} task the one being edited (editable()), or null
 * @param {number | null} [viewerId]
 * @returns {Array<{ value: string, label: string, person: object | null, current: boolean }>}
 *   value: '' for anyone, else the id; current: the task's person added because they aren't
 *   on the list
 */
export function assignChoices(options, task, viewerId = null) {
  const isMe = (person) => person.kind === 'me' || Number(person.id) === Number(viewerId);
  const rank = (person) => (isMe(person) ? 0 : (KIND_RANK[person.kind] ?? 2));
  const people = [...(options ?? [])].sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 2 ? a.name.localeCompare(b.name) : 0),
  );
  const list = [{ value: '', label: ANYONE_LABEL, person: null, current: false }];
  for (const person of people) {
    const label = isMe(person) ? `Me (${person.name})` : person.name;
    list.push({ value: String(person.id), label, person, current: false });
  }
  const now = task?.assignee;
  if (now && !list.some((choice) => choice.value === String(now.id))) {
    const label = `${now.name}${currentNote(now)}`;
    list.push({ value: String(now.id), label, person: now, current: true });
  }
  return list;
}

/**
 * The chips a "Find a person" search keeps: every chip whose name holds the text (the checked one
 * always stays, so the choice never disappears from view).
 */
export function findChoices(choices, query, checked) {
  const wanted = String(query ?? '')
    .normalize('NFC')
    .toLowerCase()
    .trim();
  if (!wanted) return choices;
  return choices.filter(
    (choice) =>
      choice.value === checked || choice.label.normalize('NFC').toLowerCase().includes(wanted),
  );
}

/**
 * A task to edit, from a board card or from the task window's details, in one shape.
 * @returns {{ id, title, details, priority, phase, dueDate, privateLinkCount,
 *   assignee: { id, name, initials, avatarUrl, role, status, away } | null }}
 */
export function editable(task) {
  const from = task.assignee;
  const assignee = from
    ? {
        id: from.id,
        name: from.name,
        initials: from.initials ?? null,
        avatarUrl: from.avatarUrl ?? null,
        role: from.role ?? null,
        status: from.status ?? 'active',
        away: from.away !== undefined ? from.away : awayLabel(from),
      }
    : null;
  return {
    id: task.id,
    title: task.title ?? '',
    details: task.details ?? null,
    priority: task.priority ?? 'p2',
    phase: isPhase(task.phase) ? task.phase : null,
    dueDate: task.dueDate ?? null,
    privateLinkCount: Number(task.privateLinkCount ?? 0),
    assignee,
  };
}

/**
 * The person a checked chip stands for, as the access rules take them (`{ id, role, status }`),
 * or null for anyone on the project.
 */
export function chosenPerson(choices, owner) {
  if (!owner) return null;
  const choice = choices.find((item) => item.value === String(owner));
  return personOf(choice?.person ?? { id: Number(owner) });
}

/** The name of a checked chip's person ("Vishal Saini"), or null for anyone on the project. */
export function chosenName(choices, owner) {
  if (!owner) return null;
  return choices.find((item) => item.value === String(owner))?.person?.name ?? null;
}

/**
 * The "Only PM and Admins" project files this save would let the chosen person open through the
 * task: the new links only, or every link that stays when the person changes (a reassign shares
 * them with the new person). None when the person manages the project.
 * @param {{ links: object[], existingIds?: number[], personChanged: boolean,
 *   person: object | null, project: { id: number, pmId: number | null } }} args links: the
 *   linked files the save keeps (removed and gone ones left out)
 */
export function filesShared({ links, existingIds = [], personChanged, person, project }) {
  const kept = privateFiles(links);
  const shared = personChanged ? kept : kept.filter((file) => !existingIds.includes(file.id));
  return filesToShare(shared, person, project);
}

/**
 * True when a save needs the share confirm: it shares files the person hasn't been asked about
 * (the picker's confirm counts for the files it named, while the same chip stays checked).
 * @param {object[]} files filesShared
 * @param {{ owner: string, ids: number[] } | null} confirmed what was confirmed, and for whom
 * @param {string} owner the checked chip
 */
export function shareAsked(files, confirmed, owner) {
  if (files.length === 0) return false;
  if (!confirmed || confirmed.owner !== owner) return true;
  return files.some((file) => !confirmed.ids.includes(file.id));
}
