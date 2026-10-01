// Who can sign in and with which role: deactivate, reactivate and change role.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { roleTracksAttendance } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { auth } from '@/modules/auth';
import { push } from '@/modules/push';
import {
  guardAdminAccount,
  notFound,
  parseInput,
  requirePermission,
  toId,
  toPublicUser,
} from './helpers';
import * as repo from './repo';
import { changeRoleSchema } from './schemas';

function lastAdmin() {
  return new AppError('LAST_ADMIN', {
    fields: { role: 'Daybook needs at least one active Admin.' },
  });
}

/**
 * Throws LAST_ADMIN when `personId` is the only active Admin. Locks the active Admin rows (in id
 * order, so concurrent changes queue instead of deadlocking) until the caller's transaction ends.
 */
async function guardLastAdmin(personId, trx) {
  const admins = await repo.listActiveAdminIds(trx, { lock: true });
  if (admins.length <= 1 && admins.includes(personId)) throw lastAdmin();
}

/**
 * Deactivates a person: status 'deactivated', deactivated_at now, all their sessions end and
 * their desktop-notification subscriptions are deleted. History (attendance, reports, audit) is
 * kept; they drop out of dashboards and pickers and can't sign in. Already deactivated people
 * are returned unchanged. Audited as 'user.deactivate'.
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<ReturnType<typeof toPublicUser>>}
 * @throws FORBIDDEN, NOT_FOUND, CANNOT_DEACTIVATE_SELF (409), LAST_ADMIN
 */
export async function deactivate({ user, id, ip }) {
  requirePermission(user, 'people.manage');
  const personId = toId(id);
  if (personId === user.id) {
    throw new AppError('CANNOT_DEACTIVATE_SELF', {
      status: 409,
      message: "You can't deactivate your own account.",
    });
  }
  return db.transaction(async (trx) => {
    const current = await repo.findById(personId, trx);
    if (!current) throw notFound();
    guardAdminAccount(user, current);
    if (current.status === 'deactivated') return toPublicUser(current);
    if (current.role === 'admin') await guardLastAdmin(personId, trx);
    const at = nowDate();
    await repo.updateUser(
      personId,
      { status: 'deactivated', deactivatedAt: at, updatedAt: at },
      trx,
    );
    await auth.destroyUserSessions(personId, trx);
    // Their browsers stop getting desktop notifications too (CONTRACT 14).
    await push.deleteForUser(personId, trx);
    await audit.log(
      {
        actorId: user.id,
        action: 'user.deactivate',
        entityType: 'user',
        entityId: personId,
        before: { status: 'active' },
        after: { status: 'deactivated' },
        ip,
      },
      trx,
    );
    return toPublicUser(await repo.findById(personId, trx));
  });
}

/**
 * Reactivates a deactivated person so they can sign in again. Active people are returned
 * unchanged. Audited as 'user.reactivate'.
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<ReturnType<typeof toPublicUser>>}
 * @throws FORBIDDEN, NOT_FOUND
 */
export async function reactivate({ user, id, ip }) {
  requirePermission(user, 'people.manage');
  const personId = toId(id);
  return db.transaction(async (trx) => {
    const current = await repo.findById(personId, trx);
    if (!current) throw notFound();
    guardAdminAccount(user, current);
    if (current.status === 'active') return toPublicUser(current);
    await repo.updateUser(
      personId,
      { status: 'active', deactivatedAt: null, updatedAt: nowDate() },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'user.reactivate',
        entityType: 'user',
        entityId: personId,
        before: { status: 'deactivated' },
        after: { status: 'active' },
        ip,
      },
      trx,
    );
    return toPublicUser(await repo.findById(personId, trx));
  });
}

/**
 * Changes a person's role (Admin only). The last active Admin can't be moved to another role.
 * Takes effect on their next request. Audited as 'user.role_change' with before/after.
 * @param {{ user: object, id: number, role: 'employee' | 'pm' | 'hr' | 'admin',
 *   ip?: string | null }} args
 * @returns {Promise<ReturnType<typeof toPublicUser>>}
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, LAST_ADMIN
 */
export async function changeRole({ user, id, role, ip }) {
  requirePermission(user, 'roles.manage', 'Only Admin can change roles.');
  const personId = toId(id);
  const data = parseInput(changeRoleSchema, { role });
  return db.transaction(async (trx) => {
    const current = await repo.findById(personId, trx);
    if (!current) throw notFound();
    if (current.role === data.role) return toPublicUser(current);
    if (current.role === 'admin' && current.status === 'active') {
      await guardLastAdmin(personId, trx);
    }
    // Tracking follows the role: PMs are never tracked; someone moving from PM to employee or
    // HR starts checking in again. Admin keeps whatever was set (check-in is optional there).
    let tracksAttendance = roleTracksAttendance(data.role, current.tracksAttendance);
    if (current.role === 'pm' && ['employee', 'hr'].includes(data.role)) tracksAttendance = true;
    await repo.updateUser(
      personId,
      { role: data.role, tracksAttendance, updatedAt: nowDate() },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'user.role_change',
        entityType: 'user',
        entityId: personId,
        before: { role: current.role, tracksAttendance: Boolean(current.tracksAttendance) },
        after: { role: data.role, tracksAttendance },
        ip,
      },
      trx,
    );
    return toPublicUser(await repo.findById(personId, trx));
  });
}
