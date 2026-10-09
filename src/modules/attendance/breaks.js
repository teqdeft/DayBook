// Breaks (CONTRACT 15): Start break / End break on Today. A break pauses the running timer and
// worked time is present time minus breaks. The timers module and this one call each other, so
// `timers` is only used inside functions, never at module top level.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { dayjs, formatDuration, now, nowDate, workDate as localDate } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import * as repo from './repo';
import { breakMinutesWithin, forgottenBreakEnd, nowToSecond, todayFor } from './rules';

/**
 * @typedef {{ id: number, userId: number, attendanceId: number, workDate: string,
 *   startedAt: Date, endedAt: Date | null, endReason: 'self' | 'checkout' | 'timer' | 'midnight'
 *   | null, pausedEntryId: number | null }} BreakRow
 */

/**
 * Locks the person's attendance row of a work date for the rest of the caller's transaction and
 * returns it as it is now (a check-out that committed first shows). Breaks, check-out and
 * timers.start take their locks in one order: this row, then the break, then the running timer,
 * so they wait for each other instead of deadlocking. The lock is by primary key, like
 * check-out's update: one through the (user, date) index would deadlock with it.
 * @param {{ userId: number, workDate: string }} input
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<AttendanceRow | null>} null when the person has no row that day
 */
export async function lockDay({ userId, workDate }, trx) {
  const row = await repo.findByUserAndDate(userId, workDate, trx);
  return row ? ((await repo.findById(row.id, trx, { forUpdate: true })) ?? null) : null;
}

/** True when the row is checked in and not checked out. */
function isOpenRow(row) {
  return Boolean(row) && !row.checkOutAt && row.checkoutStatus === 'open';
}

/** Today's row must be open: checked in and not checked out. */
function ensureOpenRow(row) {
  if (!row) throw new AppError('NOT_CHECKED_IN');
  if (!isOpenRow(row)) throw new AppError('ALREADY_CHECKED_OUT');
}

/**
 * Ends an open break inside the caller's transaction. A break left open from a day before
 * `today` ends by the midnight rule instead (the row's check-out, else its own start).
 * @returns {Promise<BreakRow>}
 */
async function finishBreak(open, { at, reason, today }, trx) {
  let endedAt = dayjs(at).isBefore(open.startedAt) ? open.startedAt : dayjs(at).toDate();
  let endReason = reason;
  if (open.workDate < today) {
    endedAt = forgottenBreakEnd(open, await repo.findById(open.attendanceId, trx));
    endReason = 'midnight';
  }
  await repo.endBreakRow(open.id, { endedAt, endReason, updatedAt: nowDate() }, trx);
  return repo.findBreakById(open.id, trx);
}

/**
 * Starts a break for the signed-in person. One transaction: locks today's attendance row, stops
 * the running timer (timers.stopRunning, reason 'break') and saves the break with the id of the
 * timer it paused, so End break can start it again.
 * @param {{ user: { id: number, role: string, status?: string, tracksAttendance: boolean } }} input
 * @returns {Promise<{ break: BreakRow, pausedEntryId: number | null }>}
 * @throws FORBIDDEN (not someone who checks in), NOT_CHECKED_IN, ALREADY_CHECKED_OUT,
 *   ALREADY_ON_BREAK (also when two taps arrive at once)
 */
export async function startBreak({ user }) {
  if (!can(user, 'attendance.self') || !user.tracksAttendance) throw new AppError('FORBIDDEN');
  const today = todayFor(await settings.getAll());
  const row = await repo.findByUserAndDate(user.id, today);
  ensureOpenRow(row);
  const at = nowToSecond();
  try {
    return await repo.transaction(async (trx) => {
      ensureOpenRow(await repo.findById(row.id, trx, { forUpdate: true }));
      const open = await repo.findOpenBreak(user.id, trx, { forUpdate: true });
      if (open && open.workDate >= today) throw new AppError('ALREADY_ON_BREAK');
      if (open) await finishBreak(open, { at, reason: 'midnight', today }, trx);
      const stopped = await timers.stopRunning({ userId: user.id, at, reason: 'break' }, trx);
      const pausedEntryId = stopped?.id ?? null;
      const id = await repo.insertBreak(
        {
          userId: user.id,
          attendanceId: row.id,
          workDate: row.workDate,
          startedAt: at,
          pausedEntryId,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      );
      return { break: await repo.findBreakById(id, trx), pausedEntryId };
    });
  } catch (error) {
    // Two taps at once: the unique open_user_id stops the second break.
    if (error?.errno === 1062) throw new AppError('ALREADY_ON_BREAK');
    throw error;
  }
}

/**
 * Ends the signed-in person's break ('self') and starts the timer it paused again
 * (timers.resumeAfterBreak, which does nothing when a timer runs, timers are off or the project is
 * no longer active). Nothing resumes once today's row is closed (e.g. by HR) or when the person
 * may no longer use timers (timers.canUse, e.g. no longer tracked): the break still ends. After
 * commit, tells the person once when this break took today's breaks over the daily allowance
 * (breakAllowanceMinutes; 0 = no allowance).
 * @param {{ user: { id: number, role: string, status?: string, tracksAttendance: boolean } }} input
 * @returns {Promise<{ break: BreakRow, breakMinutesToday: number, overAllowanceMinutes: number }>}
 *   minutes of break inside today's present window, and how far that is over the allowance
 * @throws NOT_ON_BREAK
 */
export async function endBreak({ user }) {
  const current = await settings.getAll();
  const today = todayFor(current);
  const at = nowToSecond();
  const ended = await repo.transaction(async (trx) => {
    const row = await lockDay({ userId: user.id, workDate: today }, trx);
    const open = await repo.findOpenBreak(user.id, trx, { forUpdate: true });
    if (!open) throw new AppError('NOT_ON_BREAK');
    const done = await finishBreak(open, { at, reason: 'self', today }, trx);
    const resume = done.endReason === 'self' && open.pausedEntryId && isOpenRow(row);
    if (resume && timers.canUse(user)) {
      await timers.resumeAfterBreak({ userId: user.id, entryId: open.pausedEntryId, at }, trx);
    }
    return done;
  });
  const totals = await breakTotals({ userId: user.id, ended, today, current });
  return { break: ended, ...totals };
}

/** Today's break minutes after a break ended, notifying the person when it crossed the allowance. */
async function breakTotals({ userId, ended, today, current }) {
  const [row, breaks] = await Promise.all([
    repo.findByUserAndDate(userId, today),
    repo.listBreaksByUserDate(userId, today),
  ]);
  const at = now();
  const tz = current.timezone;
  const total = breakMinutesWithin(breaks, row, at, tz);
  const before = breakMinutesWithin(
    breaks.filter((item) => item.id !== ended.id),
    row,
    at,
    tz,
  );
  const allowance = current.breakAllowanceMinutes;
  if (allowance > 0 && before <= allowance && total > allowance) {
    await notifications.notify({
      userIds: [userId],
      type: 'attendance.break_over_allowance',
      title: `Your breaks today are over the ${allowance} min allowance`,
      body: `You've had ${formatDuration(total)} of breaks today.`,
      link: '/today',
    });
  }
  return {
    breakMinutesToday: total,
    overAllowanceMinutes: allowance > 0 ? Math.max(0, total - allowance) : 0,
  };
}

/**
 * The person's open break, if any (one from an earlier day too, until closeForgottenBreaks runs).
 * @param {number} userId
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<BreakRow | null>}
 */
export async function getOpenBreak(userId, trx = db) {
  return (await repo.findOpenBreak(userId, trx)) ?? null;
}

/**
 * Ends the person's open break inside the caller's transaction, without starting a timer again
 * (timers.start uses it with reason 'timer'; check-out with 'checkout'). A break left open from
 * an earlier day ends by the midnight rule instead. It first locks the person's attendance row of
 * that day (see lockDay), so callers must call it before locking the running timer.
 * @param {{ userId: number, at: Date, reason: 'self' | 'checkout' | 'timer' | 'midnight' }} input
 * @param {import('knex').Knex} trx
 * @returns {Promise<BreakRow | null>} the ended break, or null when there was none
 */
export async function endOpenBreak({ userId, at, reason }, trx) {
  const today = localDate((await settings.getAll()).timezone, at);
  await lockDay({ userId, workDate: today }, trx);
  const open = await repo.findOpenBreak(userId, trx, { forUpdate: true });
  if (!open) return null;
  return finishBreak(open, { at, reason, today }, trx);
}

/**
 * One person's breaks on a work date, oldest first.
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<BreakRow[]>}
 */
export function listBreaks(userId, workDate) {
  return repo.listBreaksByUserDate(userId, workDate);
}

/**
 * Everyone's breaks on a work date, by user id, oldest first (one query, for the day views).
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<BreakRow[]>}
 */
export function listBreaksForDate(workDate) {
  return repo.listBreaksByDate(workDate);
}

/**
 * Worker job: ends every break still open from a day before `today` ('midnight'), at that day's
 * check-out when the row has one after the break started, else at the break's own start.
 * @param {string} [today] 'YYYY-MM-DD', default today's company date
 * @returns {Promise<{ closed: number }>}
 */
export async function closeForgottenBreaks(today) {
  const date = today ?? todayFor(await settings.getAll());
  const closed = await repo.transaction(async (trx) => {
    const open = await repo.listOpenBreaksBefore(date, trx);
    if (open.length === 0) return 0;
    const rows = await repo.findByIds([...new Set(open.map((item) => item.attendanceId))], trx);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const updatedAt = nowDate();
    let count = 0;
    for (const item of open) {
      const endedAt = forgottenBreakEnd(item, byId.get(item.attendanceId));
      count += await repo.endBreakRow(item.id, { endedAt, endReason: 'midnight', updatedAt }, trx);
    }
    return count;
  });
  return { closed };
}
