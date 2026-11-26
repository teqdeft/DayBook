// Who a task can be for (CONTRACT 28, The assignee rule): the check every write runs (create, edit,
// Assign to me, the Table's bulk save) and the people the browser offers. Anyone on the project
// (null), an active member (any role, tracked or not), the project's PM while active, an active
// Admin setting themself on any project (without becoming a member), or the task's current person
// unchanged. writes.js re-exports assertAssignee (writes.assertAssignee in the contract). The open
// count per person is its own query here (the contract's repo.countOpenByAssignee; repo.js is at
// its size cap).
import { db } from '@/lib/db';
import { validationError } from '@/lib/errors';
import { initials } from '@/lib/text';
import { projects } from '@/modules/projects';
import * as repo from './repo';
import { readableProject } from './shared';

export const ASSIGNEE_MESSAGE = 'Pick someone who is on this project, or anyone on the project.';

const sameId = (a, b) => a !== null && a !== undefined && Number(a) === Number(b);

/**
 * @param {number | null} assigneeId the person to give the task to; null = anyone on the project
 * @param {{ members: object[], manager: object | null }} team teamOf's members and PM (`others`
 *   isn't needed: an Admin outside the team passes only as the actor themself)
 * @param {{ actor?: { id: number, role: string, status?: string },
 *   before?: { assigneeId: number | null } | null }} [context] the person saving; the task before
 *   the save (none on create)
 * @throws VALIDATION_FAILED `fields.assigneeId` "Pick someone who is on this project, or anyone on
 *   the project." for anyone else: a deactivated member, someone taken off, an Admin or another PM
 *   who isn't on the project (when not the actor themself)
 */
export function assertAssignee(assigneeId, { members, manager }, { actor, before } = {}) {
  if (assigneeId === null || assigneeId === undefined) return;
  if (before && sameId(before.assigneeId, assigneeId)) return; // kept as it was
  const actorActive = !actor?.status || actor.status === 'active';
  if (actor && actor.role === 'admin' && actorActive && sameId(actor.id, assigneeId)) return;
  const person = sameId(manager?.id, assigneeId)
    ? manager
    : members.find((row) => sameId(row.id, assigneeId));
  if (!person || person.status !== 'active') {
    throw validationError({ assigneeId: ASSIGNEE_MESSAGE }, ASSIGNEE_MESSAGE);
  }
}

/** `{ assigneeId, total }` open tasks per person of one project (the people window's "4 open here"). */
export function countOpenByAssignee(projectId, trx = db) {
  return trx('projectTasks')
    .where({ projectId, status: 'open' })
    .whereNotNull('assigneeId')
    .groupBy('assigneeId')
    .select('assigneeId')
    .count({ total: '*' });
}

/**
 * @typedef {{ id: number, name: string, initials: string, avatarUrl: string | null,
 *   designation: string | null, role: string, status: 'active', kind: 'me' | 'pm' | 'member',
 *   openHere: number }} AssigneeOption
 */

/** One person row as an AssigneeOption. */
function toOption(person, kind, openHere) {
  return {
    id: person.id,
    name: person.name,
    initials: initials(person.name ?? ''),
    avatarUrl: person.avatarUrl ?? null,
    designation: person.designation || null,
    role: person.role,
    status: 'active',
    kind,
    openHere: openHere.get(person.id) ?? 0,
  };
}

/**
 * The people a task of this project can be given to (`head.options`): the viewer first as 'me'
 * when they manage the project (its PM or an Admin, member or not), then the PM when it isn't the
 * viewer, then every active member A to Z (any role, tracked or not), nobody twice. Only active
 * people. The task's current person when they aren't listed (away, or an Admin who took it) and
 * "Anyone" are added by the browser from the task itself.
 * @param {{ viewer: object, projectId: number }} args
 * @returns {Promise<AssigneeOption[]>} openHere: their open tasks on this project
 * @throws NOT_FOUND, FORBIDDEN (as the project's task reads)
 */
export async function listAssigneeOptions({ viewer, projectId }) {
  const project = await readableProject(viewer, projectId);
  const manages = projects.canManage(viewer, project);
  const [members, manager, me, counts] = await Promise.all([
    repo.listProjectMembers(project.id),
    project.pmId ? repo.findPerson(project.pmId) : null,
    manages ? repo.findPerson(viewer.id) : null,
    countOpenByAssignee(project.id),
  ]);
  const openHere = new Map(counts.map((row) => [row.assigneeId, Number(row.total)]));
  const active = (person) => person?.status === 'active';
  const options = [];
  if (active(me)) options.push(toOption(me, 'me', openHere));
  if (active(manager) && !sameId(manager.id, me?.id)) {
    options.push(toOption(manager, 'pm', openHere));
  }
  const listed = new Set(options.map((option) => option.id));
  const rest = members
    .filter((member) => active(member) && !listed.has(member.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  for (const member of rest) options.push(toOption(member, 'member', openHere));
  return options;
}
