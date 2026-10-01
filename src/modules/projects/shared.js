// Helpers shared by the projects service files: row mapping and the "who may manage" rule.
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';

/** Roles that can own a project (be its PM). */
export const MANAGER_ROLES = ['pm', 'admin'];

/** A person as the pages show them (avatar, name, role label). */
export function toPerson(row, prefix = '') {
  const key = (name) => (prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name);
  const id = row[key('id')];
  if (id === null || id === undefined) return null;
  const name = row[key('name')];
  return {
    id,
    name,
    initials: initials(name),
    designation: row[key('designation')] ?? null,
    role: row[key('role')] ?? null,
    status: row[key('status')] ?? null,
    avatarUrl: row[key('avatarUrl')] ?? null,
  };
}

/** A projects row (joined with client, PM and urgent marker) as the contract's Project. */
export function toProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    clientName: row.clientName,
    clientIsInternal: Boolean(row.clientIsInternal),
    pmId: row.pmId,
    pmName: row.pmName ?? null,
    status: row.status,
    color: row.color,
    isUrgent: Boolean(row.isUrgent),
    urgentNote: row.urgentNote ?? null,
    urgentMarkedAt: row.urgentMarkedAt ?? null,
    urgentMarkedById: row.urgentMarkedById ?? null,
    urgentMarkedByName: row.urgentMarkedByName ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt ?? null,
  };
}

/** A project request row (joined with the requester and handler). */
export function toRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    handledAt: row.handledAt ?? null,
    handledBy: row.handledBy ? { id: row.handledBy, name: row.handledByName ?? null } : null,
    declineReason: row.declineReason ?? null,
    projectId: row.projectId ?? null,
    projectName: row.projectName ?? null,
    requestedBy: row.requestedBy,
    requester: toPerson(row, 'requester'),
  };
}

export function isAdmin(user) {
  return user?.role === 'admin' && user?.status !== 'deactivated';
}

/**
 * True when the user may edit the project: Admin edits every project, a PM only projects
 * where pm_id is them.
 */
export function canManageProject(user, project) {
  if (!user || !project || !can(user, 'project.manage')) return false;
  return isAdmin(user) || Number(project.pmId) === Number(user.id);
}

/** @throws FORBIDDEN when the user may not edit the project. */
export function assertCanManage(user, project) {
  if (!canManageProject(user, project)) {
    throw new AppError('FORBIDDEN', { message: 'Only the project manager or Admin can do that.' });
  }
}

/**
 * Validates service input with a zod schema (routes validate too; services are also called from
 * tests and other modules).
 * @throws VALIDATION_FAILED with a fields map
 */
export function parseInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/** MySQL and MariaDB both report a duplicate key as errno 1062 (the error name can differ). */
export function isDuplicateKey(error) {
  return error?.errno === 1062;
}

/** Escapes %, _ and \ for a LIKE pattern. */
export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}
