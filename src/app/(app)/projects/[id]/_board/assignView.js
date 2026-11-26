// Giving a task to someone (CONTRACT 28, Cards and the card menu; The people window): the toast's
// words ("Checkout fix before client demo is now yours." and who gets a notification, from the
// save's answer), what the PATCH sends (and its Undo), when Undo is offered, the person laid over a
// task while the save runs, and a server answer that asks for the share confirm. Pure and safe in
// the browser.
import { awayLabel } from '../phasesView';
import { personIdOf } from './peopleView';

/**
 * Who a save reached, as the toast's body (Every message, Told bodies), or null for nobody.
 * @param {{ told?: 'person' | 'members' | null, toldName?: string | null,
 *   toldEarlierName?: string | null }} answer the PATCH's `told`, `toldName`, `toldEarlierName`
 * @returns {string | null}
 */
export function toldText({ told, toldName, toldEarlierName } = {}) {
  const earlier = toldEarlierName || null;
  if (told === 'members') {
    return earlier
      ? `Everyone on the project and ${earlier} get a notification.`
      : 'Everyone on the project gets a notification.';
  }
  const person = told === 'person' ? toldName || null : null;
  if (person && earlier) return `${person} and ${earlier} get a notification.`;
  const one = person ?? earlier;
  return one ? `${one} gets a notification.` : null;
}

/**
 * The toast after a person change: "… is now yours." / "… is now for Vishal Saini." / "… is now for
 * anyone on the project.", with the body from the answer when there is one.
 * @param {{ title: string }} task
 * @param {{ id: number, name: string } | null} assignee the new person, null for anyone
 * @param {number} viewerId
 * @param {object} [answer] the save's answer (`told`, `toldName`, `toldEarlierName`)
 * @returns {{ title: string, body?: string }}
 */
export function assignToast(task, assignee, viewerId, answer) {
  let title = `${task.title} is now for anyone on the project.`;
  if (assignee && Number(assignee.id) === Number(viewerId)) title = `${task.title} is now yours.`;
  else if (assignee) title = `${task.title} is now for ${assignee.name}.`;
  const body = answer ? toldText(answer) : null;
  return body ? { title, body } : { title };
}

/**
 * What the PATCH sends: the new person ('' never: null is anyone), and with a confirmed share the
 * person the confirm named (`shareWith`, '' for anyone).
 * @param {number | null} assigneeId
 * @param {{ shareConfirmed?: boolean, shareWith?: number | '' }} [share]
 */
export function assignBody(assigneeId, { shareConfirmed = false, shareWith } = {}) {
  const body = { assigneeId: assigneeId ?? null };
  if (!shareConfirmed) return body;
  return { ...body, shareConfirmed: true, shareWith: shareWith ?? assigneeId ?? '' };
}

/**
 * The Undo of a person change: back to the person who held the task a moment ago, who could
 * already open its files, so it always confirms the share (and never asks).
 * @param {number | null} before
 */
export const undoBody = (before) => assignBody(before, { shareConfirmed: true });

/**
 * Undo is offered only when the earlier person can be picked now: anyone on the project, or a row
 * of `head.options` (the viewer is one). Someone away, or an Admin who isn't on the project and
 * isn't the viewer, can't be (the assignee rule would refuse the Undo).
 * @param {number | null} before
 * @param {Array<{ id: number }>} options
 */
export function undoable(before, options = []) {
  if (before === null || before === undefined) return true;
  return options.some((option) => Number(option.id) === Number(before));
}

/**
 * True when the task's person is the viewer (BoardTask's `assignee.isViewer`, else by id).
 * @param {{ assignee?: { id: number, isViewer?: boolean } | null }} task
 * @param {number | null | undefined} viewerId
 */
export function isViewersTask(task, viewerId) {
  const assignee = task?.assignee;
  if (!assignee) return false;
  if (typeof assignee.isViewer === 'boolean') return assignee.isViewer;
  return viewerId !== undefined && viewerId !== null && Number(assignee.id) === Number(viewerId);
}

/** True when the server asks for the share confirm (`fields.shareConfirmed`). */
export const asksShare = (error) => Boolean(error?.fields?.shareConfirmed);

/**
 * A task's person as the board draws it, from a people window row or an option: the card's face
 * shows it at once while the save runs.
 * @param {{ id: number, name: string, initials?: string, avatarUrl?: string | null, role?: string,
 *   status?: string, isMember?: boolean } | null} person
 * @param {number} viewerId
 */
export function shownPerson(person, viewerId) {
  if (!person) return null;
  return {
    id: Number(person.id),
    name: person.name,
    avatarUrl: person.avatarUrl ?? null,
    initials: person.initials,
    role: person.role,
    status: person.status ?? 'active',
    away: person.away ?? awayLabel(person),
    isViewer: Number(person.id) === Number(viewerId),
  };
}

/**
 * The tasks with the person changes still on their way laid over them (the Board, the Table and
 * the task window read tasks through this).
 * @param {object[]} tasks
 * @param {Map<number, { assignee: object | null }>} shown task id → the person shown
 * @returns {object[]} the same array when nothing is waiting
 */
export function withPersons(tasks, shown) {
  if (!Array.isArray(tasks) || !shown || shown.size === 0) return tasks;
  let changed = false;
  const next = tasks.map((task) => {
    const entry = task ? shown.get(Number(task.id)) : undefined;
    if (!entry || personIdOf(task) === (entry.assignee ? entry.assignee.id : null)) return task;
    changed = true;
    return { ...task, assignee: entry.assignee };
  });
  return changed ? next : tasks;
}
