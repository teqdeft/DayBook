// Checks and helpers shared by the project writes (create.js, manage.js, requests.js).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { findSimilarName } from './lookup';
import * as repo from './repo';
import { isDuplicateKey, MANAGER_ROLES, toPerson } from './shared';

export const URGENT_NOTE_MESSAGE = 'Add a short note so members know what is urgent.';

export function notFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that project." });
}

export function duplicate(message) {
  return new AppError('DUPLICATE_PROJECT', { message, fields: { name: message } });
}

/**
 * @param {string} name
 * @param {{ excludeProjectId?: number, excludeRequestId?: number, ignoreRequestsLike?: string }}
 *   [options] as findSimilarName
 * @throws DUPLICATE_PROJECT when a project or a pending request has the same compact name.
 */
export async function assertNameFree(name, options = {}, trx = db) {
  const similar = await findSimilarName(name, options, trx);
  if (!similar) return;
  if (similar.kind === 'project') {
    throw duplicate(`There is already a project called ${similar.name}.`);
  }
  throw duplicate(
    `${similar.requestedByName} already asked for ${similar.name}. Handle their request on Requests.`,
  );
}

/** @throws VALIDATION_FAILED unless the person is an active PM or Admin. */
export async function assertManager(pmId, trx) {
  const [pm] = await repo.findUsersByIds([pmId], trx);
  if (!pm || pm.status !== 'active' || !MANAGER_ROLES.includes(pm.role)) {
    throw validationError(
      { pmId: 'Pick an active project manager or Admin.' },
      'Pick an active project manager or Admin.',
    );
  }
  return pm;
}

/** The people for these ids, in the same order. @throws VALIDATION_FAILED if one isn't active. */
export async function loadActivePeople(ids, trx) {
  const rows = await repo.findUsersByIds(ids, trx);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inactive = ids.filter((id) => byId.get(id)?.status !== 'active');
  if (inactive.length > 0) {
    const person = byId.get(inactive[0]);
    const message = person
      ? `${person.name} is deactivated, so they can't be added.`
      : 'Pick people from the list.';
    throw validationError({ memberIds: message }, message);
  }
  return ids.map((id) => byId.get(id));
}

/** The client with this name (any case), created in the same transaction when it is new. */
export async function findOrCreateClient(name, trx) {
  const existing = await repo.findClientByName(name, trx);
  if (existing) return existing.id;
  const at = nowDate();
  try {
    return await repo.insertClient({ name, isInternal: false, createdAt: at, updatedAt: at }, trx);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Someone added the same client a moment ago.
    const again = await repo.findClientByName(name, trx, { lock: true });
    if (again) return again.id;
    throw error;
  }
}

/** Active members of a project with their Slack ids, in the order they were added. */
export async function activeMembers(projectId, trx) {
  const rows = await repo.listMembers([projectId], trx);
  return rows.filter((row) => row.status === 'active');
}

export function snapshot(project, memberIds) {
  return {
    name: project.name,
    clientName: project.clientName,
    pmId: project.pmId,
    status: project.status,
    color: project.color,
    isUrgent: project.isUrgent,
    urgentNote: project.urgentNote,
    ...(memberIds ? { memberIds } : {}),
  };
}

export function withMembers(project, rows) {
  return { ...project, members: rows.map((row) => toPerson(row)) };
}
