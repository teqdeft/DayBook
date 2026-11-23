// Away breaks (CONTRACT 25 A): time a person removed from a timer ("Remove, it was a break") is
// saved as a break with source 'away', so it counts like any other break everywhere. The timers
// module calls these inside its own transaction, after attendance.lockDay. Before migration 018
// the new columns are missing: the save answers null, the reads fall back (breakRepo).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { dayjs, now, nowDate } from '@/lib/time';
import * as breakRepo from './breakRepo';
import { guard018Read, guard018Write, try018Write } from './migration018';
import * as repo from './repo';

/**
 * @typedef {BreakRow & { source: 'self' | 'away', awayEntryId: number | null,
 *   changedById: number | null, changedAt: Date | null }} BreakDetail
 */

export const OVERLAP_MESSAGE = 'That time overlaps a break. Keep it, or ask HR.';

const ms = (value) => dayjs(value).valueOf();
const toSecond = (value) => Math.floor(ms(value) / 1000);

/** True when [a.start, a.end) and [b.start, b.end) share a second (touching isn't overlap). */
function overlaps(a, b) {
  return toSecond(a.start) < toSecond(b.end) && toSecond(b.start) < toSecond(a.end);
}

/**
 * Saves the time a timer lost as an away break, inside the caller's transaction (which holds the
 * attendance row lock). Refused when it overlaps a break of the day (only possible after an HR
 * fix). Before migration 018 nothing is saved and it answers null (the transaction goes on).
 * @param {{ userId: number, attendanceId: number, workDate: string, startedAt: Date,
 *   endedAt: Date, awayEntryId: number | null }} input whole seconds
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<BreakRow | null>}
 * @throws CONFLICT ("That time overlaps a break. Keep it, or ask HR.")
 */
export async function saveAwayBreak(
  { userId, attendanceId, workDate, startedAt, endedAt, awayEntryId },
  trx,
) {
  const span = { start: startedAt, end: endedAt };
  const at = now();
  for (const item of await repo.listBreaksByUserDate(userId, workDate, trx)) {
    if (overlaps(span, { start: item.startedAt, end: item.endedAt ?? at })) {
      throw new AppError('CONFLICT', { message: OVERLAP_MESSAGE });
    }
  }
  const stamp = nowDate();
  const id = await try018Write('breaks', () =>
    breakRepo.insertAwayBreak(
      {
        userId,
        attendanceId,
        workDate,
        startedAt,
        endedAt,
        pausedEntryId: null,
        awayEntryId: awayEntryId ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      },
      trx,
    ),
  );
  return id ? ((await repo.findBreakById(id, trx)) ?? null) : null;
}

/**
 * One of the person's away breaks, locked for the rest of the caller's transaction (Put back).
 * @param {{ userId: number, breakId: number }} input
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<BreakDetail | null>} null when it isn't the person's away break
 * @throws UPDATE_NEEDED (503) before migration 018
 */
export async function lockAwayBreak({ userId, breakId }, trx) {
  const item = await guard018Write('breaks', () => breakRepo.lockDetail(breakId, trx));
  if (!item || Number(item.userId) !== Number(userId) || item.source !== 'away') return null;
  return item;
}

/**
 * Deletes an away break inside the caller's transaction (Put back).
 * @param {number} breakId
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number>} rows deleted
 */
export function deleteAwayBreak(breakId, trx) {
  return breakRepo.deleteBreak(breakId, trx);
}

/**
 * One person's away breaks of a work date, oldest first (Today's removed time).
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<BreakDetail[] | null>} null before migration 018 (unavailable)
 */
export function listAwayBreaks(userId, workDate, trx = db) {
  return guard018Read(
    'breaks',
    () => breakRepo.listAwayByUserDate({ userId, workDate }, trx),
    () => null,
  );
}

/**
 * One person's breaks of a work date with the 1.10 columns, oldest first. Before migration 018
 * every break reads as source 'self' with no change.
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<BreakDetail[]>}
 */
export async function listBreakDetails(userId, workDate, trx = db) {
  const { rows } = await breakRepo.readWithBreakColumns((columns) =>
    breakRepo.listByUserDate(columns, { userId, workDate }, trx),
  );
  return rows;
}
