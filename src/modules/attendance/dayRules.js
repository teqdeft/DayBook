// The day rules (CONTRACT 25): when a holiday or a leave entry changes, the attendance rows of
// the days it changes get their working-day flag and late minutes worked out again, audited per
// row (attendance.day_rules). Only rows whose day changed are touched: a row whose day didn't
// change keeps its stored values even when Late after or the person's shift changed since (§16
// "Late minutes are stored at check-in"). Check-in and check-out times, checkout_status, source
// and breaks are never touched.
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { lateMinutesForDay } from './calendar';
import * as calendarRepo from './calendarRepo';
import { loadCalendar } from './calendarReads';

const byDayThenPerson = (a, b) => a.workDate.localeCompare(b.workDate) || a.userId - b.userId;

/** A day "changed" when its working-day flag or its late mark differs. */
function dayChanged(before, after) {
  return before.isWorkingDay !== after.isWorkingDay || before.lateMark !== after.lateMark;
}

async function peopleOf(rows) {
  const people = await users.findByIds([...new Set(rows.map((row) => row.userId))]);
  return new Map(people.map((person) => [person.id, person]));
}

/**
 * Locks each row by primary key in work_date, user_id order (as repo.listOpenBefore, so it never
 * deadlocks with the 00:05 markMissingCheckouts), works out the flag and late minutes from its
 * day, and saves and audits the rows whose values differ.
 * @returns {Promise<Array<{ rowId: number, userId: number, workDate: string,
 *   before: { lateMinutes: number, isWorkingDay: boolean },
 *   after: { lateMinutes: number, isWorkingDay: boolean } }>>}
 */
async function rewriteRows(targets, { reason, actorId, current }, trx) {
  const changed = [];
  for (const { row, day } of [...targets].sort((a, b) => byDayThenPerson(a.row, b.row))) {
    const locked = await calendarRepo.lockDayRow(row.id, trx);
    if (!locked) continue;
    const after = {
      lateMinutes: lateMinutesForDay({ checkInAt: locked.checkInAt, day, settings: current }),
      isWorkingDay: day.isWorkingDay,
    };
    const before = { lateMinutes: locked.lateMinutes, isWorkingDay: Boolean(locked.isWorkingDay) };
    if (before.lateMinutes === after.lateMinutes && before.isWorkingDay === after.isWorkingDay) {
      continue;
    }
    await calendarRepo.updateDayRow(locked.id, { ...after, updatedAt: nowDate() }, trx);
    await audit.log(
      {
        actorId: actorId ?? null,
        action: 'attendance.day_rules',
        entityType: 'attendance',
        entityId: locked.id,
        before,
        after,
        reason,
      },
      trx,
    );
    changed.push({
      rowId: locked.id,
      userId: locked.userId,
      workDate: locked.workDate,
      before,
      after,
    });
  }
  return changed;
}

/**
 * Runs a holiday or leave write inside the caller's transaction and fixes the attendance rows
 * whose day it changed: the calendar of the range is loaded before and after `write(trx)`, and
 * each person's day compared. Late = lateMinutesForDay() with the new day and the stored
 * check-in, flag = the new day's isWorkingDay; a row is updated only when a value differs.
 * @template T
 * @param {{ userIds?: number[], from: string, to: string, reason: string,
 *   actorId?: number | null }} scope the dates (and people, for leave) the write can change
 * @param {import('knex').Knex.Transaction} trx the caller's transaction
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} write
 * @returns {Promise<{ result: T, changed: Array<{ rowId: number, userId: number,
 *   workDate: string, before: { lateMinutes: number, isWorkingDay: boolean },
 *   after: { lateMinutes: number, isWorkingDay: boolean } }> }>}
 */
export async function applyDayRules({ userIds, from, to, reason, actorId }, trx, write) {
  const range = { from, to, userIds, withWfh: false };
  const before = await loadCalendar(range, trx);
  const result = await write(trx);
  const [after, rows, current] = await Promise.all([
    loadCalendar(range, trx),
    calendarRepo.listDayRows({ from, to, userIds }, trx),
    settings.getAll(),
  ]);
  const people = await peopleOf(rows);
  const targets = [];
  for (const row of rows) {
    const person = people.get(row.userId);
    if (!person) continue;
    const day = after.dayFor(person, row.workDate);
    if (dayChanged(before.dayFor(person, row.workDate), day)) targets.push({ row, day });
  }
  const changed = await rewriteRows(targets, { reason, actorId, current }, trx);
  return { result, changed };
}

/**
 * After a holiday or leave write has committed, its writer runs this once in a new transaction
 * for the same dates: rows created at or after `since` (the write's start) whose stored flag or
 * late minutes differ from the calendar now are fixed and audited the same way. So a check-in
 * that committed while the write ran (it read the calendar before the write) ends right.
 * @param {{ userIds?: number[], from: string, to: string, since: Date, reason: string,
 *   actorId?: number | null }} scope
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<{ changed: object[] }>} changed as for applyDayRules()
 */
export async function recheckDayRules({ userIds, from, to, since, reason, actorId }, trx) {
  const [calendar, rows, current] = await Promise.all([
    loadCalendar({ from, to, userIds, withWfh: false }, trx),
    calendarRepo.listDayRows({ from, to, userIds, since }, trx),
    settings.getAll(),
  ]);
  const people = await peopleOf(rows);
  const targets = [];
  for (const row of rows) {
    const person = people.get(row.userId);
    if (!person) continue;
    const day = calendar.dayFor(person, row.workDate);
    const late = lateMinutesForDay({ checkInAt: row.checkInAt, day, settings: current });
    if (late !== row.lateMinutes || day.isWorkingDay !== Boolean(row.isWorkingDay)) {
      targets.push({ row, day });
    }
  }
  return { changed: await rewriteRows(targets, { reason, actorId, current }, trx) };
}
