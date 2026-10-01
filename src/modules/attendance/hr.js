// HR's direct changes to attendance (guide 7.8): add a row for someone who forgot, edit times or
// place, and confirm an unverified office check-in. Every change needs a reason and is audited
// with before and after.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { dayjs, formatDayShort, now, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import * as repo from './repo';
import { clockOn, computeLateMinutes, todayFor, workingDayFlag } from './rules';

/** The fields an audit row keeps for an attendance row. */
export function auditView(row) {
  if (!row) return null;
  return {
    workDate: row.workDate,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    location: row.location,
    officeVerified: row.officeVerified,
    lateMinutes: row.lateMinutes,
    checkoutStatus: row.checkoutStatus,
  };
}

/**
 * Turns local clocks on a work date into check-in / check-out moments and checks them: not in the
 * future, and the check-out after the check-in. Errors name the field.
 * @returns {{ checkInAt: Date | null, checkOutAt: Date | null }}
 */
export function resolveTimes({ workDate, checkIn, checkOut, current, fields = {} }) {
  const inField = fields.checkIn ?? 'checkIn';
  const outField = fields.checkOut ?? 'checkOut';
  const checkInAt = checkIn ? clockOn(workDate, checkIn, current) : null;
  const checkOutAt = checkOut ? clockOn(workDate, checkOut, current) : null;
  const moment = now();
  if (checkInAt && moment.isBefore(checkInAt)) {
    throw validationError(
      { [inField]: "That time hasn't come yet." },
      "That time hasn't come yet.",
    );
  }
  if (checkOutAt && moment.isBefore(checkOutAt)) {
    throw validationError(
      { [outField]: "That time hasn't come yet." },
      "That time hasn't come yet.",
    );
  }
  return { checkInAt, checkOutAt };
}

export function assertOrder(checkInAt, checkOutAt, field = 'checkOut') {
  if (checkInAt && checkOutAt && !dayjs(checkOutAt).isAfter(dayjs(checkInAt))) {
    const message = 'The check-out must be after the check-in.';
    throw validationError({ [field]: message }, message);
  }
}

/** Every HR change needs a reason (it is saved in the audit log). */
export function requireReason(reason, field = 'reason') {
  const text = String(reason ?? '').trim();
  if (!text) throw validationError({ [field]: 'Add a reason.' }, 'Add a reason.');
  return text.slice(0, 500);
}

async function findPerson(userId) {
  const person = await users.findById(userId);
  if (!person || person.status !== 'active') {
    throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  }
  return person;
}

/** HR changes other people's attendance; their own goes through another HR person or an Admin. */
export function assertNotSelf(actor, userId) {
  if (Number(actor.id) === Number(userId)) {
    throw new AppError('FORBIDDEN', {
      message: "You can't change your own attendance. Ask another HR person or an Admin.",
    });
  }
}

async function findRowForUpdate(id, actor, trx) {
  const row = await repo.findById(id, trx, { forUpdate: true });
  if (!row) throw new AppError('NOT_FOUND', { message: 'That attendance row no longer exists.' });
  assertNotSelf(actor, row.userId);
  return row;
}

async function tellPerson({ userId, actor, workDate, what }, trx) {
  if (userId === actor.id) return;
  await notifications.notify(
    {
      userIds: [userId],
      type: 'attendance.edited',
      title: `${actor.name} ${what} your attendance for ${formatDayShort(workDate)}`,
      link: `/log?month=${workDate.slice(0, 7)}`,
    },
    trx,
  );
}

/**
 * HR adds a row for someone who forgot to check in (POST /api/attendance). A past day needs a
 * check-out time; today's row may stay open so the person can check out themselves.
 * @param {{ actor: { id: number, name: string }, userId: number, workDate: string,
 *   checkIn: string, checkOut?: string | null, location: 'office' | 'wfh', reason: string,
 *   ip?: string | null }} input clocks are 'HH:mm' in company time
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND (person), FORBIDDEN (their own row), VALIDATION_FAILED (future day or time,
 *   check-out before check-in, missing check-out on a past day), ATTENDANCE_EXISTS, CONFLICT
 *   (the person doesn't track attendance)
 */
export async function createForUser({
  actor,
  userId,
  workDate,
  checkIn,
  checkOut,
  location,
  reason,
  ip,
}) {
  const why = requireReason(reason);
  assertNotSelf(actor, userId);
  const current = await settings.getAll();
  const today = todayFor(current);
  if (workDate > today) {
    throw validationError({ workDate: "That day hasn't come yet." }, "That day hasn't come yet.");
  }
  if (!checkOut && workDate < today) {
    const message = 'Add the check-out time for a past day.';
    throw validationError({ checkOut: message }, message);
  }
  const person = await findPerson(userId);
  // PMs (and Admins who don't track attendance) never check in, so a row would only be hidden.
  if (!person.tracksAttendance) {
    throw new AppError('CONFLICT', {
      message: `${person.name} doesn't check in, so there's no attendance to add.`,
    });
  }
  const times = resolveTimes({ workDate, checkIn, checkOut, current });
  assertOrder(times.checkInAt, times.checkOutAt);
  const at = nowDate();
  const row = {
    userId,
    workDate,
    checkInAt: times.checkInAt,
    checkOutAt: times.checkOutAt,
    location,
    officeVerified: true,
    note: null,
    lateMinutes: computeLateMinutes({
      checkInAt: times.checkInAt,
      workDate,
      shiftStart: person.shiftStart,
      settings: current,
    }),
    isWorkingDay: workingDayFlag(workDate, current),
    checkoutStatus: times.checkOutAt ? 'corrected' : 'open',
    source: 'hr',
    createdAt: at,
    updatedAt: at,
  };
  try {
    const id = await db.transaction(async (trx) => {
      const newId = await repo.insertRow(row, trx);
      const saved = await repo.findById(newId, trx);
      await audit.log(
        {
          actorId: actor.id,
          action: 'attendance.create',
          entityType: 'attendance',
          entityId: newId,
          after: { userId, ...auditView(saved) },
          reason: why,
          ip,
        },
        trx,
      );
      await tellPerson({ userId, actor, workDate, what: 'added' }, trx);
      return newId;
    });
    return repo.findById(id);
  } catch (error) {
    if (error?.errno === 1062) throw new AppError('ATTENDANCE_EXISTS');
    throw error;
  }
}

/**
 * HR changes a row's check-in, check-out or place (PATCH /api/attendance/:id). A new check-out
 * sets checkout_status = corrected; a new check-in recomputes late minutes; setting the place
 * counts as verified.
 * @param {{ actor: { id: number, name: string }, id: number, checkIn?: string,
 *   checkOut?: string, location?: 'office' | 'wfh', reason: string, ip?: string | null }} input
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND, FORBIDDEN (their own row), VALIDATION_FAILED (future time, check-out
 *   before check-in)
 */
export async function updateRow({ actor, id, checkIn, checkOut, location, reason, ip }) {
  const why = requireReason(reason);
  if (!checkIn && !checkOut && !location) {
    const message = 'Change the check-in, the check-out or the place.';
    throw validationError({ checkIn: message }, message);
  }
  const current = await settings.getAll();
  const rowId = await db.transaction(async (trx) => {
    const row = await findRowForUpdate(id, actor, trx);
    const times = resolveTimes({ workDate: row.workDate, checkIn, checkOut, current });
    const checkInAt = times.checkInAt ?? row.checkInAt;
    const checkOutAt = times.checkOutAt ?? row.checkOutAt;
    assertOrder(checkInAt, checkOutAt, times.checkOutAt ? 'checkOut' : 'checkIn');
    const changes = { updatedAt: nowDate() };
    if (times.checkInAt) {
      const person = await users.findById(row.userId);
      changes.checkInAt = times.checkInAt;
      changes.lateMinutes = computeLateMinutes({
        checkInAt: times.checkInAt,
        workDate: row.workDate,
        shiftStart: person?.shiftStart,
        settings: current,
      });
    }
    if (times.checkOutAt) {
      changes.checkOutAt = times.checkOutAt;
      changes.checkoutStatus = 'corrected';
    }
    if (location) {
      changes.location = location;
      changes.officeVerified = true;
    }
    await repo.updateRow(row.id, changes, trx);
    const saved = await repo.findById(row.id, trx);
    await audit.log(
      {
        actorId: actor.id,
        action: 'attendance.edit',
        entityType: 'attendance',
        entityId: row.id,
        before: auditView(row),
        after: auditView(saved),
        reason: why,
        ip,
      },
      trx,
    );
    await tellPerson({ userId: row.userId, actor, workDate: row.workDate, what: 'changed' }, trx);
    return row.id;
  });
  return repo.findById(rowId);
}

/**
 * HR confirms an "Office, unverified" check-in: office_verified = 1 (audited with the reason).
 * @param {{ actor: { id: number }, id: number, reason: string, ip?: string | null }} input
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND, FORBIDDEN (their own row), CONFLICT when the row is not an unverified
 *   office check-in
 */
export async function confirmOffice({ actor, id, reason, ip }) {
  const why = requireReason(reason);
  await db.transaction(async (trx) => {
    const row = await findRowForUpdate(id, actor, trx);
    if (row.location !== 'office' || row.officeVerified) {
      throw new AppError('CONFLICT', { message: "This check-in doesn't need confirming." });
    }
    await repo.updateRow(row.id, { officeVerified: true, updatedAt: nowDate() }, trx);
    await audit.log(
      {
        actorId: actor.id,
        action: 'attendance.confirm_office',
        entityType: 'attendance',
        entityId: row.id,
        before: { officeVerified: false },
        after: { officeVerified: true },
        reason: why,
        ip,
      },
      trx,
    );
  });
  return repo.findById(id);
}
