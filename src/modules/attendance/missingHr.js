// Missing check-outs for HR (CONTRACT 25, item 7): the full list behind the "Missing check-out"
// number (50 a page on /attendance/missing, 5 on the side card), with the suggested time, the
// pending check_out correction and the latest reminder of each row; the rows D's reminders ask
// about; and the bulk fix, one transaction per row. Admins' rows are left out unless the viewer
// is an Admin (§16). `reminders` (builder D) is only used inside functions.
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { dayjs, formatDayShort, formatTimeAmPm, localToUtc, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { publicPerson } from './calendarReads';
import { markCheckoutEntered } from './checkoutEntered';
import { forgetSuggestion, suggestCheckoutTimes } from './checkoutSuggest';
import { assertNotSelf, assertOrder, auditView, requireReason, resolveTimes } from './hr';
import * as missingRepo from './missingRepo';
import { clockAt, isSuggestedTime } from './missingRules';
import * as reminders from './reminderExports';
import * as repo from './repo';
import { hidesAdmins, showsAttendanceOf } from './rules';
import { clockString } from './schemas';
import { tellPerson } from './tellPerson';

const MAX_FIX = 50;
const dayKey = (userId, workDate) => `${Number(userId)}:${workDate}`;

/** Each row's pending check_out correction: { id, checkOutClock } ('HH:mm' company time). */
async function pendingFor(rows, tz) {
  const userIds = [...new Set(rows.map((row) => Number(row.userId)))];
  const dates = [...new Set(rows.map((row) => row.workDate))];
  const pending = await missingRepo.listPendingCheckouts({ userIds, dates });
  const byDay = new Map(pending.map((item) => [dayKey(item.userId, item.workDate), item]));
  const result = new Map();
  for (const row of rows) {
    const found = byDay.get(dayKey(row.userId, row.workDate));
    if (found) {
      result.set(row.id, { id: found.id, checkOutClock: clockAt(found.requestedTime, tz) });
    }
  }
  return result;
}

/**
 * Each row's latest missing_checkout reminder sent on or after the row's date (D's
 * listReminders; none before migration 018).
 */
async function remindedFor(rows, tz) {
  if (rows.length === 0) return new Map();
  const startOf = (date) => localToUtc(date, '00:00', tz).valueOf();
  const oldest = rows.map((row) => row.workDate).sort()[0];
  const sent = await reminders.listReminders({
    since: new Date(startOf(oldest)),
    userIds: [...new Set(rows.map((row) => Number(row.userId)))],
    kinds: ['missing_checkout'],
  });
  const result = new Map();
  for (const row of rows) {
    const latest = (sent ?? []).find(
      (item) =>
        Number(item.userId) === Number(row.userId) &&
        dayjs(item.sentAt).valueOf() >= startOf(row.workDate),
    );
    if (latest) result.set(row.id, { sentAt: latest.sentAt, sentBy: latest.sentBy ?? null });
  }
  return result;
}

function inIdOrder(rows, ids) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Rows still marked as a missing check-out (not fixed yet) of active people who track
 * attendance, newest day first, then name, with the person. `total` counts the same rows (the
 * KPI footer's "12 to fix in all"). For attendance.correct viewers (and system reads) each item
 * has its pending check_out correction and latest reminder; `suggest` (pass it only for them)
 * adds the suggested check-out time.
 * @param {{ limit?: number, offset?: number, viewer?: { id: number, role: string },
 *   suggest?: boolean }} [options] viewer as for listDay()
 * @returns {Promise<{ items: Array<AttendanceRow & { user: object, suggestedAt?: Date | null,
 *   pendingCorrection: { id: number, checkOutClock: string } | null,
 *   reminded: { sentAt: Date, sentBy: { id: number, name: string } | null } | null,
 *   own: boolean }>, total: number }>}
 */
export async function listMissingCheckouts({
  limit = 20,
  offset = 0,
  viewer,
  suggest = false,
} = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = Math.max(Number(offset) || 0, 0);
  const hideAdmins = hidesAdmins(viewer);
  const correct = !viewer || can(viewer, 'attendance.correct');
  const [ids, total, current] = await Promise.all([
    missingRepo.listMissingIds({ limit: size, offset: skip, hideAdmins }),
    repo.countMissing({ hideAdmins }),
    settings.getAll(),
  ]);
  const rows = inIdOrder(await repo.findByIds(ids), ids);
  const tz = current.timezone;
  const [people, suggestions, pending, reminded] = await Promise.all([
    users.findByIds([...new Set(rows.map((row) => row.userId))]),
    suggest ? suggestCheckoutTimes(rows) : null,
    correct ? pendingFor(rows, tz) : new Map(),
    correct ? remindedFor(rows, tz) : new Map(),
  ]);
  const byId = new Map(people.map((person) => [person.id, person]));
  const items = rows.map((row) => {
    const person = byId.get(row.userId);
    return {
      ...row,
      user: person ? publicPerson(person) : { id: row.userId, name: 'Someone' },
      ...(suggest ? { suggestedAt: suggestions.get(Number(row.id)) ?? null } : {}),
      pendingCorrection: pending.get(row.id) ?? null,
      reminded: reminded.get(row.id) ?? null,
      own: Boolean(viewer) && Number(row.userId) === Number(viewer.id),
    };
  });
  return { items, total };
}

/**
 * The unfixed missing check-outs of these people without a pending check_out correction (the
 * person already told HR a time), newest first: what D's missing_checkout remind asks about.
 * @param {number[]} userIds
 * @returns {Promise<Map<number, Array<{ attendanceId: number, workDate: string }>>>} only people
 *   with at least one row are keys
 */
export async function missingCheckoutsFor(userIds) {
  const ids = [...new Set((userIds ?? []).map(Number).filter(Boolean))];
  const result = new Map();
  for (const row of await missingRepo.listUnfixedFor(ids)) {
    const key = Number(row.userId);
    result.set(key, [...(result.get(key) ?? []), { attendanceId: row.id, workDate: row.workDate }]);
  }
  return result;
}

function conflict(message) {
  return new AppError('CONFLICT', { message });
}

/** The missing row (locked) once the actor may fix it (hr.findRowForUpdate's rules). */
async function lockForFix(attendanceId, actor, trx) {
  const row = await repo.findById(attendanceId, trx, { forUpdate: true });
  const person = row && (await users.findById(row.userId));
  if (!row || !showsAttendanceOf(actor, person)) {
    throw new AppError('NOT_FOUND', { message: 'That attendance row no longer exists.' });
  }
  assertNotSelf(actor, row.userId);
  if (row.checkoutStatus !== 'missing') throw conflict('Already fixed.');
  const pending = await repo.findPendingCorrection(
    { userId: row.userId, workDate: row.workDate, type: 'check_out' },
    trx,
  );
  // Approving the person's own request later would overwrite HR's time.
  if (pending) throw conflict('Handle it under Corrections.');
  return row;
}

/** The row's 'HH:mm' check-out; a row without one fails on its own ("Add a time."). */
function clockOf(item) {
  const parsed = clockString('Add a time.').safeParse(item.checkOut ?? '');
  if (!parsed.success) throw validationError({ checkOut: 'Add a time.' }, 'Add a time.');
  return parsed.data;
}

/** One row's fix in its own transaction. */
function fixOne({ actor, item, why, ip, current, suggestedAt }) {
  const checkOut = clockOf(item);
  return repo.transaction(async (trx) => {
    const row = await lockForFix(item.attendanceId, actor, trx);
    const { checkOutAt } = resolveTimes({ workDate: row.workDate, checkOut, current });
    assertOrder(row.checkInAt, checkOutAt);
    const changes = { checkOutAt, checkoutStatus: 'corrected', updatedAt: nowDate() };
    if ((await missingRepo.closeMissingRow(row.id, changes, trx)) === 0) {
      throw conflict('Already fixed.');
    }
    // A separate statement, so the fix still saves before migration 018.
    await markCheckoutEntered({ rowId: row.id, userId: actor.id, suggestedAt: null }, trx);
    const saved = await repo.findById(row.id, trx);
    await audit.log(
      {
        actorId: actor.id,
        action: 'attendance.fix_missing',
        entityType: 'attendance',
        entityId: row.id,
        before: auditView(row),
        after: { ...auditView(saved), suggested: isSuggestedTime(suggestedAt, checkOutAt) },
        reason: why,
        ip,
      },
      trx,
    );
    await tellPerson(
      {
        userId: row.userId,
        actor,
        workDate: row.workDate,
        title: `${actor.name} entered your check-out for ${formatDayShort(row.workDate)}`,
        body: `${formatTimeAmPm(checkOutAt, current.timezone)}.`,
      },
      trx,
    );
    return { attendanceId: row.id, checkOutAt };
  });
}

/** A failed row for the answer: the field the message belongs to (checkOut) or null. */
function failureOf(item, error) {
  if (error instanceof AppError) {
    const field = error.fields ? (Object.keys(error.fields)[0] ?? null) : null;
    const message = field ? error.fields[field] : error.message;
    return { attendanceId: item.attendanceId, field, message };
  }
  logger.error({ err: error, attendanceId: item.attendanceId }, 'missing check-out fix failed');
  return {
    attendanceId: item.attendanceId,
    field: null,
    message: "Couldn't save this one. Try again.",
  };
}

/**
 * HR fixes missing check-outs in one go (POST /api/attendance/missing-checkouts/fix), each with
 * the time in its row and one reason. Each row runs in its own transaction: the row locked by
 * primary key; an Admin's row is NOT_FOUND for non-Admins; the actor's own row, a row no longer
 * missing ("Already fixed.") and one with a pending check_out correction ("Handle it under
 * Corrections.") fail; the time is checked as for HR's Edit. A fix sets checkout_status
 * 'corrected', names the actor as who entered it, is audited (attendance.fix_missing,
 * `after.suggested` when the time equals the suggestion) and tells the person. One failure never
 * stops the others.
 * @param {{ actor: { id: number, name: string, role: string }, items: Array<{ attendanceId: number,
 *   checkOut: string }>, reason: string, ip?: string | null }} input checkOut 'HH:mm'
 * @returns {Promise<{ fixed: Array<{ attendanceId: number, checkOutAt: Date }>,
 *   failed: Array<{ attendanceId: number, field: string | null, message: string }> }>}
 * @throws VALIDATION_FAILED (reason, or not 1 to 50 items)
 */
export async function fixMissingCheckouts({ actor, items, reason, ip = null }) {
  const why = requireReason(reason);
  const seen = new Set();
  const list = (items ?? []).filter((item) => {
    const id = Number(item?.attendanceId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (list.length < 1 || list.length > MAX_FIX) {
    throw validationError({ items: 'Pick 1 to 50 check-outs.' }, 'Pick 1 to 50 check-outs.');
  }
  const current = await settings.getAll();
  const suggestions = await suggestCheckoutTimes(await repo.findByIds([...seen]));
  const fixed = [];
  const failed = [];
  for (const item of list) {
    const input = { actor, item, why, ip, current };
    const suggestedAt = suggestions.get(Number(item.attendanceId)) ?? null;
    try {
      fixed.push(await fixOne({ ...input, suggestedAt }));
      forgetSuggestion(item.attendanceId);
    } catch (error) {
      failed.push(failureOf(item, error));
    }
  }
  return { fixed, failed };
}
