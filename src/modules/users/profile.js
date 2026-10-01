// Adding people and editing their profile (People > Add employee / Edit).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can, roleTracksAttendance } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import {
  clock,
  guardAdminAccount,
  notFound,
  parseInput,
  requirePermission,
  toId,
  toPublicUser,
} from './helpers';
import * as repo from './repo';
import { addUserSchema, shiftErrors, updateUserSchema } from './schemas';

/** Fields an Edit may change (the role has its own endpoint). */
const PROFILE_FIELDS = [
  'name',
  'email',
  'designation',
  'departmentId',
  'reportsToId',
  'joinedOn',
  'shiftStart',
  'shiftEnd',
  'tracksAttendance',
];

/**
 * Fields people who manage people (HR) can't change on their own account, with the reason shown
 * under each. They decide who signs in as them, which days count against them, when they are
 * late and who approves their report edits, so someone else changes them (the same rule as
 * attendance, where nobody corrects their own rows). Admins are exempt: nobody ranks above them.
 */
const SELF_LOCKED = {
  email: 'Only an Admin can change your email.',
  reportsToId: 'Only another HR person or an Admin can change who you report to.',
  joinedOn: 'Only another HR person or an Admin can change your joining date.',
  shiftStart: 'Only another HR person or an Admin can change your shift.',
  shiftEnd: 'Only another HR person or an Admin can change your shift.',
  tracksAttendance: 'Only another HR person or an Admin can change whether you check in.',
};

/** Whose email the error names, by the role of the account being edited. */
const EMAIL_OWNER = { pm: "a project manager's", hr: "an HR person's" };

/**
 * Throws FORBIDDEN (with the fields that can't change) when the actor may not make these changes.
 * Slack sign-in finds the Daybook user by email, so an account's email decides who signs in with
 * its role. Without roles.manage you may only decide who signs in as an employee (the same rule
 * as add()), never as a PM or HR: changing those emails would hand the role to someone else.
 * Admin accounts are guarded as a whole by guardAdminAccount.
 * @param {{ id: number, role: string }} actor
 * @param {{ id: number, role: string }} target the stored row
 * @param {Record<string, unknown>} changes only the fields that differ from the stored row
 */
function guardProfileChanges(actor, target, changes) {
  if (can(actor, 'roles.manage')) return;
  const fields = {};
  if (target.id === actor.id) {
    for (const key of Object.keys(changes)) {
      if (SELF_LOCKED[key]) fields[key] = SELF_LOCKED[key];
    }
  }
  if ('email' in changes && !fields.email && target.role !== 'employee') {
    const owner = EMAIL_OWNER[target.role] ?? "this person's";
    fields.email = `Only an Admin can change ${owner} email, because it decides who signs in.`;
  }
  const messages = Object.values(fields);
  if (messages.length > 0) throw new AppError('FORBIDDEN', { message: messages[0], fields });
}

function duplicateEmail() {
  return new AppError('DUPLICATE_EMAIL', {
    fields: { email: 'Someone with that email is already in Daybook.' },
  });
}

/** VALIDATION_FAILED on one field, with the same text as the message. */
function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

async function checkDepartment(departmentId, trx) {
  if (!(await repo.findDepartment(departmentId, trx))) {
    throw fieldError('departmentId', 'Pick a department from the list.');
  }
}

async function checkManager(reportsToId, personId, trx) {
  if (reportsToId === null || reportsToId === undefined) return;
  if (personId && reportsToId === personId) {
    throw fieldError('reportsToId', "Someone can't report to themselves.");
  }
  const manager = await repo.findById(reportsToId, trx);
  if (!manager || manager.status !== 'active' || !['pm', 'admin'].includes(manager.role)) {
    throw fieldError('reportsToId', 'Pick an active project manager or Admin.');
  }
}

async function checkEmailFree(email, personId, trx) {
  const existing = await repo.findIdByEmail(email, trx);
  if (existing && existing.id !== personId) throw duplicateEmail();
}

function auditFields(user) {
  const out = {};
  for (const key of [...PROFILE_FIELDS, 'role', 'status']) {
    if (user[key] !== undefined) out[key] = user[key];
  }
  return out;
}

/**
 * Adds a person (People > Add employee). The email is saved in lowercase and must be unused.
 * The role is always 'employee' unless the caller can manage roles. The worker finds their
 * Slack account by email within the hour. Audited as 'user.create'.
 * @param {{ user: object, input: { name: string, email: string, designation: string,
 *   departmentId: number, reportsToId?: number | null, joinedOn?: string | null,
 *   shiftStart?: string | null, shiftEnd?: string | null, tracksAttendance?: boolean,
 *   role?: string }, ip?: string | null }} args shiftStart/shiftEnd 'HH:mm' (null = company
 *   default); joinedOn 'YYYY-MM-DD'
 * @returns {Promise<ReturnType<typeof toPublicUser>>}
 * @throws FORBIDDEN (no people.manage, or a role other than employee without roles.manage),
 *   VALIDATION_FAILED, DUPLICATE_EMAIL
 */
export async function add({ user, input, ip }) {
  requirePermission(user, 'people.manage');
  const data = parseInput(addUserSchema, input);
  const role = data.role ?? 'employee';
  if (role !== 'employee' && !can(user, 'roles.manage')) {
    throw new AppError('FORBIDDEN', {
      message: 'Only Admin can change roles.',
      fields: { role: 'Only Admin can change roles.' },
    });
  }
  const shift = shiftErrors(data.shiftStart ?? null, data.shiftEnd ?? null);
  if (shift) throw validationError(shift, Object.values(shift)[0]);

  try {
    return await db.transaction(async (trx) => {
      await checkEmailFree(data.email, null, trx);
      await checkDepartment(data.departmentId, trx);
      await checkManager(data.reportsToId ?? null, null, trx);
      const at = nowDate();
      const row = {
        name: data.name,
        email: data.email,
        designation: data.designation,
        departmentId: data.departmentId,
        role,
        reportsToId: data.reportsToId ?? null,
        joinedOn: data.joinedOn ?? null,
        shiftStart: data.shiftStart ?? null,
        shiftEnd: data.shiftEnd ?? null,
        // PMs never check in or write reports, whatever was asked for.
        tracksAttendance: roleTracksAttendance(role, data.tracksAttendance ?? true),
        status: 'active',
        createdAt: at,
        updatedAt: at,
      };
      const id = await repo.insertUser(row, trx);
      await audit.log(
        {
          actorId: user.id,
          action: 'user.create',
          entityType: 'user',
          entityId: id,
          after: auditFields(row),
          ip,
        },
        trx,
      );
      return toPublicUser(await repo.findById(id, trx));
    });
  } catch (error) {
    // Two people adding the same email at once: the unique key catches the second one.
    if (error?.errno === 1062) throw duplicateEmail();
    throw error;
  }
}

/** Values of the fields that differ between the stored row and the input. */
function changedFields(current, data) {
  const changes = {};
  for (const key of PROFILE_FIELDS) {
    if (data[key] === undefined) continue;
    const before = key.startsWith('shift') ? clock(current[key]) : current[key];
    const after = data[key];
    const same =
      typeof before === 'boolean' || typeof after === 'boolean'
        ? Boolean(before) === Boolean(after)
        : (before ?? null) === (after ?? null);
    if (!same) changes[key] = after;
  }
  return changes;
}

/**
 * Edits a person's profile fields (never the role). Only fields that changed are written; a
 * changed email clears the Slack user ID so the sync finds the right account. Audited as
 * 'user.update' with before/after of the changed fields. Without roles.manage (HR): no Admin
 * accounts, no email changes on PM or HR accounts, and no changes to your own email, manager,
 * joining date, shift or tracking (unchanged values sent along are fine).
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input: any of
 *   name, email, designation, departmentId, reportsToId, joinedOn, shiftStart, shiftEnd,
 *   tracksAttendance
 * @returns {Promise<ReturnType<typeof toPublicUser>>}
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, DUPLICATE_EMAIL
 */
export async function update({ user, id, input, ip }) {
  requirePermission(user, 'people.manage');
  const personId = toId(id);
  const data = parseInput(updateUserSchema, input);
  try {
    return await db.transaction(async (trx) => {
      const current = await repo.findById(personId, trx);
      if (!current) throw notFound();
      guardAdminAccount(user, current);
      const changes = changedFields(current, data);
      guardProfileChanges(user, current, changes);
      if (changes.tracksAttendance && !roleTracksAttendance(current.role)) {
        throw validationError(
          { tracksAttendance: "Project managers don't check in or write daily reports." },
          "Project managers don't check in or write daily reports.",
        );
      }
      const shift = shiftErrors(
        'shiftStart' in changes ? changes.shiftStart : clock(current.shiftStart),
        'shiftEnd' in changes ? changes.shiftEnd : clock(current.shiftEnd),
      );
      if (shift && ('shiftStart' in changes || 'shiftEnd' in changes)) {
        throw validationError(shift, Object.values(shift)[0]);
      }
      if (Object.keys(changes).length === 0) return toPublicUser(current);

      if ('email' in changes) await checkEmailFree(changes.email, personId, trx);
      if ('departmentId' in changes) await checkDepartment(changes.departmentId, trx);
      if ('reportsToId' in changes) await checkManager(changes.reportsToId, personId, trx);

      const before = {};
      for (const key of Object.keys(changes)) {
        before[key] = key.startsWith('shift') ? clock(current[key]) : current[key];
      }
      const write = { ...changes, updatedAt: nowDate() };
      if ('email' in changes) write.slackUserId = null;
      await repo.updateUser(personId, write, trx);
      await audit.log(
        {
          actorId: user.id,
          action: 'user.update',
          entityType: 'user',
          entityId: personId,
          before,
          after: changes,
          ip,
        },
        trx,
      );
      return toPublicUser(await repo.findById(personId, trx));
    });
  } catch (error) {
    if (error?.errno === 1062) throw duplicateEmail();
    throw error;
  }
}
