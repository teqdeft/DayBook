// Shared pieces of the users module: the PublicUser shape, input parsing and the access checks
// every change starts with.
import { AppError, validationError } from '@/lib/errors';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { initials } from '@/lib/text';

/** '09:30:00' -> '09:30'; null stays null. */
export function clock(value) {
  return value ? String(value).slice(0, 5) : null;
}

/**
 * The user shape every screen and module receives (CONTRACT section 6, PublicUser), plus
 * deactivatedAt.
 */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] ?? row.role,
    designation: row.designation ?? '',
    departmentId: row.departmentId,
    departmentName: row.departmentName ?? null,
    reportsToId: row.reportsToId ?? null,
    reportsToName: row.reportsToName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    slackUserId: row.slackUserId ?? null,
    tracksAttendance: Boolean(row.tracksAttendance),
    shiftStart: clock(row.shiftStart),
    shiftEnd: clock(row.shiftEnd),
    joinedOn: row.joinedOn ?? null,
    status: row.status,
    deactivatedAt: row.deactivatedAt ?? null,
    initials: initials(row.name),
  };
}

/** zod result -> VALIDATION_FAILED with a message per field. */
export function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/** FORBIDDEN unless the user has the permission. */
export function requirePermission(user, key, message) {
  if (!can(user, key)) throw new AppError('FORBIDDEN', message ? { message } : undefined);
}

/** A positive integer id, or NOT_FOUND. */
export function toId(id) {
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) throw new AppError('NOT_FOUND');
  return value;
}

export function notFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that person." });
}

/** An Admin's account (email, status) decides who can sign in as Admin, so only Admins touch it. */
export function guardAdminAccount(actor, target) {
  if (target.role === 'admin' && !can(actor, 'roles.manage')) {
    throw new AppError('FORBIDDEN', { message: "Only an Admin can change an Admin's account." });
  }
}
