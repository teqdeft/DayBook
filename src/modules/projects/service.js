// Projects: reads for pages, pickers and dashboards. Writes live in create.js and manage.js
// (projects, members, urgent), requests.js and decisions.js (project requests); this file
// re-exports them so the module has one service object.
import { can } from '@/lib/permissions';
import { attachMembers } from './lookup';
import * as repo from './repo';
import { canManageProject, MANAGER_ROLES, toPerson, toProject } from './shared';

export * from './create';
export * from './decisions';
export * from './manage';
export * from './requests';
export { findSimilarName } from './lookup';

/**
 * One project.
 * @param {number} id
 * @returns {Promise<object | null>} the contract's Project: { id, name, clientId, clientName, pmId,
 *   pmName, status, color, isUrgent, urgentNote, urgentMarkedAt, urgentMarkedById,
 *   urgentMarkedByName, completedAt } (plus clientIsInternal, createdAt), or null
 */
export async function findById(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) return null;
  return toProject(await repo.findById(Number(id)));
}

/**
 * True when the project exists and is active (only active projects can be picked in a report).
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function isActive(id) {
  const project = await findById(id);
  return project?.status === 'active';
}

/**
 * A page of projects with their active members, oldest first.
 * @param {{ status?: 'active'|'on_hold'|'completed', memberId?: number, mineFor?: number,
 *   q?: string, limit?: number, offset?: number }} filters memberId: only projects this person is
 *   a member of; mineFor: only projects this person is a member or the PM of (?mine=1)
 * @returns {Promise<{ rows: object[], total: number }>} rows are Projects plus `members`
 */
export async function list({ status, memberId, mineFor, q = '', limit = 50, offset = 0 } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);
  const skip = Math.max(Math.trunc(Number(offset)) || 0, 0);
  const [rows, total] = await Promise.all([
    repo.list({ status, memberId, mineFor, q, limit: size, offset: skip }),
    repo.count({ status, memberId, mineFor, q }),
  ]);
  return { rows: await attachMembers(rows.map(toProject)), total };
}

/**
 * Project counts per status for the tabs, optionally for one member and a search text.
 * @param {{ memberId?: number, q?: string }} [filters]
 * @returns {Promise<{ active: number, on_hold: number, completed: number }>}
 */
export function countByStatus({ memberId, q } = {}) {
  return repo.countByStatus({ memberId, q });
}

/**
 * The projects a person is a member of (My projects), with their active members. Active and
 * on-hold projects come first, then completed ones, each oldest first.
 * @param {number} userId
 * @returns {Promise<object[]>} Projects plus `members`
 */
export async function listForMember(userId) {
  const rows = (await repo.listForMember(userId)).map(toProject);
  const rank = { active: 0, on_hold: 1, completed: 2 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.id - b.id);
  return attachMembers(rows);
}

function toUrgent(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    urgentNote: row.urgentNote,
    urgentMarkedAt: row.urgentMarkedAt,
    urgentMarkedByName: row.urgentMarkedByName ?? null,
    pmId: row.pmId,
    pmName: row.pmName ?? null,
    memberCount: Number(row.memberCount ?? 0),
  };
}

/**
 * Active urgent projects the person is a member of (the Urgent card on Today).
 * @param {number} userId
 * @returns {Promise<Array<{ id, name, color, urgentNote, urgentMarkedAt, urgentMarkedByName, pmId,
 *   pmName, memberCount }>>} most recently marked first
 */
export async function listUrgentForMember(userId) {
  return (await repo.listUrgent({ memberId: userId })).map(toUrgent);
}

/**
 * Every active urgent project (PM dashboard, Company overview). Same shape as listUrgentForMember.
 */
export async function listUrgent() {
  return (await repo.listUrgent()).map(toUrgent);
}

/**
 * The report's project picker: urgent projects first, then the person's projects (member or PM),
 * then every other active project, each by name; plus the person's pending project requests,
 * which can be picked too ("Waiting for approval").
 * @param {number} userId
 * @returns {Promise<{ urgent: Array<{ id, name, color, isUrgent }>, mine: Array<{ id, name, color,
 *   isUrgent }>, others: Array<{ id, name, color, isUrgent }>, requests: Array<{ requestId,
 *   name }> }>}
 */
export async function getPickerFor(userId) {
  const [projects, requests] = await Promise.all([
    repo.listActiveForPicker(userId),
    repo.listRequests({ status: 'pending', requestedBy: userId, limit: 100 }),
  ]);
  const picker = { urgent: [], mine: [], others: [], requests: [] };
  for (const row of projects) {
    const item = { id: row.id, name: row.name, color: row.color, isUrgent: Boolean(row.isUrgent) };
    if (item.isUrgent) picker.urgent.push(item);
    else if (Number(row.isMine) === 1) picker.mine.push(item);
    else picker.others.push(item);
  }
  picker.requests = requests
    .map((row) => ({ requestId: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return picker;
}

/**
 * Every active project, by name: the projects a declined request's logged hours can move to
 * (guide 7.7.3). Not paged, so a project created yesterday is offered as well as the oldest ones.
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export async function listActiveOptions() {
  return (await repo.listActiveOptions()).map((row) => ({ id: Number(row.id), name: row.name }));
}

/**
 * Active and urgent project counts (Company overview).
 * @returns {Promise<{ active: number, urgent: number }>}
 */
export function countActive() {
  return repo.countActive();
}

/**
 * Clients for the "Client" field (type to find or create), names starting with the text first.
 * @param {{ q?: string, limit?: number, offset?: number }} [options] limit at most 100
 * @returns {Promise<Array<{ id: number, name: string, isInternal: boolean }>>}
 */
export async function listClients({ q = '', limit = 20, offset = 0 } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  const skip = Math.max(Math.trunc(Number(offset)) || 0, 0);
  const rows = await repo.searchClients({ q, limit: size, offset: skip });
  return rows.map((row) => ({ id: row.id, name: row.name, isInternal: Boolean(row.isInternal) }));
}

/**
 * Who the user may pick as a project's PM: Admin picks any active PM or Admin, a PM only
 * themselves.
 * @param {{ id: number, role: string }} user
 * @returns {Promise<Array<{ id: number, name: string, role: string }>>}
 */
export async function listManagerOptions(user) {
  if (!can(user, 'project.manage')) return [];
  const rows = await repo.listActiveUsers({ roles: MANAGER_ROLES });
  const people = rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
  if (user.role === 'admin') return people;
  return people.filter((person) => person.id === user.id);
}

/**
 * Active people who can be added to a project team, by name.
 * @returns {Promise<Array<{ id, name, initials, designation, role, status, avatarUrl }>>}
 */
export async function listPeopleOptions() {
  return (await repo.listActiveUsers()).map((row) => toPerson(row));
}

/**
 * Whether the user may edit this project (for showing row actions).
 * @param {{ id: number, role: string }} user
 * @param {{ pmId: number }} project
 */
export function canManage(user, project) {
  return canManageProject(user, project);
}
