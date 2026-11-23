// Leave days (CONTRACT 25, item 9): HR or an Admin marks a range of dates as leave for one person
// (full day, or the first or second half of one day; paid or unpaid; casual, sick or other; an
// optional note only HR and Admins see). Only the working days inside it are leave days. Each
// write checks the input and the person first (leaveRules.js), then runs in one REPEATABLE READ
// transaction: the overlap read locks the gap a double tap would use (the WFH pattern, a deadlock
// retried up to 3 times), the day rules fix the late marks of the days it changes, it is audited
// and the person is told (never the note). After the commit the days are re-checked once and the
// Needs a look cache is cleared. No employee requests and no balances in this release.
import { AppError, validationError } from '@/lib/errors';
import { addDays, formatDayShort, nowDate, workDate as localDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { afterCalendarWrite, distinctScopes, withDayRules } from './calendarEffects';
import { loadCalendar } from './calendarReads';
import * as writeRepo from './calendarWriteRepo';
import { getLeaveEntry } from './leaveList';
import {
  HIDDEN_ENTRY,
  checkLeaveDays,
  checkLeaveDetails,
  checkLeavePerson,
  checkLeaveReason,
  leaveDaysText,
  leaveKindText,
  leaveSnapshot,
} from './leaveRules';
import { guard018Write, updateNeededError } from './migration018';
import { previewLeave } from './leavePreview';
import * as repo from './repo';
import { nowToSecond } from './rules';

export { previewLeave };

const REPEATABLE = { isolationLevel: 'repeatable read' };

function goneError() {
  return new AppError('NOT_FOUND', { message: 'That leave no longer exists.' });
}

/** VALIDATION_FAILED when the days hold no working day for the person; UPDATE_NEEDED before 018. */
async function checkWorkingDays(person, { fromDate, toDate }) {
  const calendar = await loadCalendar({
    from: fromDate,
    to: toDate,
    userIds: [person.id],
    withWfh: false,
  });
  if (!calendar.available) throw updateNeededError();
  const working = (date) => {
    const day = calendar.dayFor(person, date);
    return day.isWorkingDay && day.employed;
  };
  let date = fromDate;
  while (date <= toDate) {
    if (working(date)) return;
    date = addDays(date, 1);
  }
  const message = 'No working days in these dates.';
  throw validationError({ fromDate: message }, message);
}

/** CONFLICT "Priya Sharma already has leave on Mon, 23 Nov." (the first overlapping day). */
async function checkNoOverlap({ person, fromDate, toDate, excludeId }, trx) {
  const clash = await writeRepo.findOverlappingLeave(
    { userId: person.id, fromDate, toDate, excludeId },
    trx,
    { forUpdate: true },
  );
  if (!clash) return;
  const first = clash.fromDate > fromDate ? clash.fromDate : fromDate;
  const message = `${person.name} already has leave on ${formatDayShort(first)}.`;
  throw new AppError('CONFLICT', { message, fields: { fromDate: message } });
}

/** The bell to the person (leave.marked, leave.changed, leave.removed): never the note. */
async function tellPerson({ person, type, title, entry, body }, trx) {
  const today = localDate((await settings.getAll()).timezone);
  const link = entry.toDate >= today ? '/today' : `/log?month=${entry.fromDate.slice(0, 7)}`;
  await notifications.notify({ userIds: [person.id], type, title, body, link }, trx);
}

/**
 * HR or an Admin marks leave for a person (POST /api/leave).
 * @param {{ actor: { id: number, name: string, role: string }, userId: number, fromDate: string,
 *   toDate?: string | null, part?: 'full' | 'first_half' | 'second_half', paid?: boolean,
 *   leaveType?: 'casual' | 'sick' | 'other', note?: string | null, ip?: string | null }} input
 * @returns {Promise<LeaveEntry>} as listLeave() items (workingDays = the whole entry's)
 * @throws VALIDATION_FAILED (the days, the note, no working days), NOT_FOUND (person), FORBIDDEN
 *   (an Admin's leave for a non-Admin, their own), CONFLICT (not tracked, overlaps their leave),
 *   UPDATE_NEEDED (before 018)
 */
export async function createLeave({ actor, userId, fromDate, toDate, part, ip, ...details }) {
  const days = checkLeaveDays({ fromDate, toDate, part });
  const extra = checkLeaveDetails(details);
  const person = await checkLeavePerson({ actor, userId });
  await checkWorkingDays(person, days);
  const since = nowToSecond();
  const reason = `Leave marked: ${leaveDaysText(days)}`;
  const scopes = [
    { userIds: [person.id], from: days.fromDate, to: days.toDate, reason, actorId: actor.id },
  ];
  const record = { userId: person.id, ...days, ...extra };
  const id = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      await checkNoOverlap({ person, ...days }, trx);
      const at = nowDate();
      const row = { ...record, createdBy: actor.id, updatedBy: actor.id };
      const { result } = await withDayRules(scopes, trx, (tx) =>
        writeRepo.insertLeave({ ...row, createdAt: at, updatedAt: at }, tx),
      );
      await audit.log(
        {
          actorId: actor.id,
          action: 'leave.create',
          entityType: 'leave',
          entityId: result,
          after: leaveSnapshot(record),
          ip,
        },
        trx,
      );
      const title = `${actor.name} marked leave for you: ${leaveDaysText(days)}`;
      await tellPerson(
        { person, type: 'leave.marked', title, entry: record, body: leaveKindText(extra) },
        trx,
      );
      return result;
    }, REPEATABLE),
  );
  await afterCalendarWrite({ scopes, since });
  return getLeaveEntry(id, { viewer: actor });
}

/** The entry (unlocked) and its person, once the actor may change it. */
async function entryAndPerson({ actor, id }) {
  const entry = await guard018Write('calendar', () => writeRepo.findLeave(id));
  if (!entry) throw goneError();
  const person = await checkLeavePerson({ actor, userId: entry.userId, hidden: HIDDEN_ENTRY });
  return { entry, person };
}

/** The entry after the change, checked. */
function nextOf(entry, changes) {
  const days = checkLeaveDays({
    fromDate: changes.fromDate ?? entry.fromDate,
    toDate: changes.toDate ?? entry.toDate,
    part: changes.part ?? entry.part,
  });
  const extra = checkLeaveDetails({
    paid: changes.paid ?? entry.paid !== false,
    leaveType: changes.leaveType ?? entry.leaveType,
    note: changes.note === undefined ? entry.note : changes.note,
  });
  return { ...days, ...extra };
}

const sameDays = (a, b) => a.fromDate === b.fromDate && a.toDate === b.toDate && a.part === b.part;

/** The day-rule scopes of a change: the old and the new days (none when only the details change). */
function changeScopes(before, next, person, actor) {
  if (sameDays(before, next)) return [];
  const reason = `Leave changed: ${leaveDaysText(next)}`;
  const ranges = [before, next].map((days) => ({
    userIds: [person.id],
    from: days.fromDate,
    to: days.toDate,
    reason,
    actorId: actor.id,
  }));
  return distinctScopes(ranges);
}

/**
 * HR or an Admin changes a leave entry (PATCH /api/leave/:id), with a reason. The day rules run
 * over the old and the new days only when the days or the part change; a change of pay, type or
 * note alone leaves the late minutes as stored.
 * @param {{ actor: object, id: number, fromDate?: string, toDate?: string, part?: string,
 *   paid?: boolean, leaveType?: string, note?: string | null, reason: string,
 *   ip?: string | null }} input
 * @returns {Promise<LeaveEntry>}
 * @throws VALIDATION_FAILED, NOT_FOUND ("That leave no longer exists.", also an Admin's for a
 *   non-Admin), FORBIDDEN (their own), CONFLICT, UPDATE_NEEDED
 */
export async function updateLeave({ actor, id, reason, ip, ...changes }) {
  const why = checkLeaveReason(reason);
  const { entry, person } = await entryAndPerson({ actor, id });
  const planned = nextOf(entry, changes);
  if (!sameDays(entry, planned)) await checkWorkingDays(person, planned);
  const since = nowToSecond();
  const scopes = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      const locked = await writeRepo.findLeave(id, trx, { forUpdate: true });
      if (!locked) throw goneError();
      const next = nextOf(locked, changes);
      const ranges = changeScopes(locked, next, person, actor);
      if (ranges.length > 0) await checkNoOverlap({ person, ...next, excludeId: id }, trx);
      const saved = { ...next, updatedBy: actor.id, updatedAt: nowDate() };
      await withDayRules(ranges, trx, (tx) => writeRepo.updateLeave(id, saved, tx));
      await audit.log(
        {
          actorId: actor.id,
          action: 'leave.update',
          entityType: 'leave',
          entityId: id,
          before: leaveSnapshot(locked),
          after: leaveSnapshot({ userId: locked.userId, ...next }),
          reason: why,
          ip,
        },
        trx,
      );
      const title = `${actor.name} changed your leave: ${leaveDaysText(next)}`;
      await tellPerson(
        { person, type: 'leave.changed', title, entry: next, body: leaveKindText(next) },
        trx,
      );
      return ranges;
    }, REPEATABLE),
  );
  await afterCalendarWrite({ scopes, since });
  return getLeaveEntry(id, { viewer: actor });
}

/**
 * HR or an Admin deletes a leave entry (DELETE /api/leave/:id), with a reason: its days count as
 * working days again. A hard delete, audited with the whole entry in `before`.
 * @param {{ actor: object, id: number, reason: string, ip?: string | null }} input
 * @returns {Promise<{ id: number }>}
 * @throws VALIDATION_FAILED (reason), NOT_FOUND, FORBIDDEN (their own), CONFLICT (not tracked),
 *   UPDATE_NEEDED
 */
export async function deleteLeave({ actor, id, reason, ip }) {
  const why = checkLeaveReason(reason);
  const { person } = await entryAndPerson({ actor, id });
  const since = nowToSecond();
  const scopes = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      const locked = await writeRepo.findLeave(id, trx, { forUpdate: true });
      if (!locked) throw goneError();
      const ranges = [
        {
          userIds: [person.id],
          from: locked.fromDate,
          to: locked.toDate,
          reason: `Leave removed: ${leaveDaysText(locked)}`,
          actorId: actor.id,
        },
      ];
      await withDayRules(ranges, trx, (tx) => writeRepo.deleteLeave(id, tx));
      await audit.log(
        {
          actorId: actor.id,
          action: 'leave.delete',
          entityType: 'leave',
          entityId: id,
          before: leaveSnapshot(locked),
          reason: why,
          ip,
        },
        trx,
      );
      const title = `${actor.name} removed your leave on ${leaveDaysText(locked)}`;
      await tellPerson({ person, type: 'leave.removed', title, entry: locked, body: null }, trx);
      return ranges;
    }),
  );
  await afterCalendarWrite({ scopes, since });
  return { id };
}
