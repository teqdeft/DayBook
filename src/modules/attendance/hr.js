// HR's direct changes to attendance (guide 7.8): add a row for someone who forgot, edit times or
// place, and confirm an unverified office check-in. Every change needs a reason and is audited
// with before and after. Only an Admin changes an Admin's attendance (company rule).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { dayjs, now, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { getDay } from './calendarReads';
import { hasCheckoutEntered, markCheckoutEntered } from './checkoutEntered';
import * as repo from './repo';
import { clockOn, computeLateMinutes, showsAttendanceOf, todayFor, workingDayFlag } from './rules';
import { tellPerson } from './tellPerson';

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

/**
 * Only Admins add attendance for an Admin (showsAttendanceOf()). Rows and requests addressed by
 * id answer NOT_FOUND instead (findRowForUpdate, decisions.loadPending).
 * @param {{ role?: string }} actor
 * @param {{ role?: string } | null} person whose attendance it is
 * @throws FORBIDDEN
 */
export function assertMayChange(actor, person) {
  if (!showsAttendanceOf(actor, person)) {
    throw new AppError('FORBIDDEN', { message: "Only an Admin can change an Admin's attendance." });
  }
}

/**
 * The row (locked) and its person, once the actor may change it. An Admin's row looks missing to
 * anyone but an Admin, so probing ids never confirms that an Admin checked in.
 */
async function findRowForUpdate(id, actor, trx) {
  const row = await repo.findById(id, trx, { forUpdate: true });
  const person = row && (await users.findById(row.userId));
  if (!row || !showsAttendanceOf(actor, person)) {
    throw new AppError('NOT_FOUND', { message: 'That attendance row no longer exists.' });
  }
  assertNotSelf(actor, row.userId);
  return { row, person };
}

/**
 * A missing check-out the person already sent HR a time for is handled under Corrections, as in
 * the bulk fix (CONTRACT 25, item 7): approving the request later would overwrite HR's change.
 * Read under the row lock, so a page shown before the request still can't save over it.
 * @throws CONFLICT "Handle it under Corrections." (on checkOut, so the dialog shows it there)
 */
async function assertNoPendingCheckout(row, trx) {
  if (row.checkoutStatus !== 'missing') return;
  const where = { userId: row.userId, workDate: row.workDate, type: 'check_out' };
  if (!(await repo.findPendingCorrection(where, trx))) return;
  const message = 'Handle it under Corrections.';
  throw new AppError('CONFLICT', { message, fields: { checkOut: message } });
}

/**
 * HR adds a row for someone who forgot to check in (POST /api/attendance). A past day needs a
 * check-out time; today's row may stay open so the person can check out themselves.
 * @param {{ actor: { id: number, name: string, role: string }, userId: number, workDate: string,
 *   checkIn: string, checkOut?: string | null, location: 'office' | 'wfh', reason: string,
 *   ip?: string | null }} input clocks are 'HH:mm' in company time
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND (person), FORBIDDEN (their own row, or an Admin's when the actor isn't one),
 *   VALIDATION_FAILED (future day or time, check-out before check-in, missing check-out on a
 *   past day), ATTENDANCE_EXISTS, CONFLICT (the person doesn't track attendance)
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
  assertMayChange(actor, person);
  // PMs (and Admins who don't track attendance) never check in, so a row would only be hidden.
  if (!person.tracksAttendance) {
    throw new AppError('CONFLICT', {
      message: `${person.name} doesn't check in, so there's no attendance to add.`,
    });
  }
  const times = resolveTimes({ workDate, checkIn, checkOut, current });
  assertOrder(times.checkInAt, times.checkOutAt);
  // The person's day (CONTRACT 25): no late mark on a holiday or full-day leave.
  const day = await getDay({ person, date: workDate });
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
      day,
    }),
    isWorkingDay: workingDayFlag(workDate, current, day),
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
 * A new check-out HR typed on a row that was missing, or whose check-out someone entered (the
 * person's own fix, or an earlier HR fix), names HR as who entered it, with no suggestion
 * (CONTRACT 25, item 7), so a row never says "By Priya" for a time Neha typed.
 */
async function markEnteredByHr({ row, actor, newCheckOut }, trx) {
  if (!newCheckOut) return;
  if (row.checkoutStatus !== 'missing' && !(await hasCheckoutEntered(row.id, trx))) return;
  await markCheckoutEntered({ rowId: row.id, userId: actor.id, suggestedAt: null }, trx);
}

/**
 * HR changes a row's check-in, check-out or place (PATCH /api/attendance/:id). A new check-out
 * sets checkout_status = corrected (and, on a row that was missing or whose check-out someone
 * entered, names the actor as who entered it); a new check-in recomputes late minutes from the
 * person's day (CONTRACT 25); setting the place counts as verified.
 * @param {{ actor: { id: number, name: string, role: string }, id: number, checkIn?: string,
 *   checkOut?: string, location?: 'office' | 'wfh', reason: string, ip?: string | null }} input
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND (also an Admin's row when the actor isn't one), FORBIDDEN (their own row),
 *   CONFLICT (a missing check-out with a pending check_out correction), VALIDATION_FAILED
 *   (future time, check-out before check-in)
 */
export async function updateRow({ actor, id, checkIn, checkOut, location, reason, ip }) {
  const why = requireReason(reason);
  if (!checkIn && !checkOut && !location) {
    const message = 'Change the check-in, the check-out or the place.';
    throw validationError({ checkIn: message }, message);
  }
  const current = await settings.getAll();
  const rowId = await db.transaction(async (trx) => {
    const { row, person } = await findRowForUpdate(id, actor, trx);
    await assertNoPendingCheckout(row, trx);
    const times = resolveTimes({ workDate: row.workDate, checkIn, checkOut, current });
    const checkInAt = times.checkInAt ?? row.checkInAt;
    const checkOutAt = times.checkOutAt ?? row.checkOutAt;
    assertOrder(checkInAt, checkOutAt, times.checkOutAt ? 'checkOut' : 'checkIn');
    const changes = { updatedAt: nowDate() };
    if (times.checkInAt) {
      changes.checkInAt = times.checkInAt;
      changes.lateMinutes = computeLateMinutes({
        checkInAt: times.checkInAt,
        workDate: row.workDate,
        shiftStart: person?.shiftStart,
        settings: current,
        day: person ? await getDay({ person, date: row.workDate }, trx) : undefined,
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
    await markEnteredByHr({ row, actor, newCheckOut: Boolean(times.checkOutAt) }, trx);
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
 * @param {{ actor: { id: number, role: string }, id: number, reason: string,
 *   ip?: string | null }} input
 * @returns {Promise<AttendanceRow>}
 * @throws NOT_FOUND (also an Admin's row when the actor isn't one), FORBIDDEN (their own row),
 *   CONFLICT when the row is not an unverified office check-in
 */
export async function confirmOffice({ actor, id, reason, ip }) {
  const why = requireReason(reason);
  await db.transaction(async (trx) => {
    const { row } = await findRowForUpdate(id, actor, trx);
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
