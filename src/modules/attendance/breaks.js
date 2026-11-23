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
import { breakMinutesWithin, forgottenBreakEnd, isOpenRow, nowToSecond, todayFor } from './rules';

/**
 * @typedef {{ id: number, userId: number, attendanceId: number, workDate: string,
 *   startedAt: Date, endedAt: Date | null, endReason: 'self' | 'checkout' | 'timer' | 'midnight'
 *   | 'away' | 'hr' | null, pausedEntryId: number | null }} BreakRow
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
 * may no longer use timers (timers.canUse, e.g. no longer tracked): the break still ends. Inside
 * the transaction, under the attendance row lock, it works out whether this break took today's
 * breaks over the daily allowance (breakTotalsIn); after commit the person is told once when it
 * did (noticeOverAllowance; breakAllowanceMinutes 0 = no allowance), so a Remove and an End break
 * that cross it together tell them once.
 * @param {{ user: { id: number, role: string, status?: string, tracksAttendance: boolean } }} input
 * @returns {Promise<{ break: BreakRow, breakMinutesToday: number, overAllowanceMinutes: number }>}
 *   minutes of break inside today's present window, and how far that is over the allowance
 * @throws NOT_ON_BREAK
 */
export async function endBreak({ user }) {
  const current = await settings.getAll();
  const today = todayFor(current);
  const at = nowToSecond();
  const { ended, totals } = await repo.transaction(async (trx) => {
    const row = await lockDay({ userId: user.id, workDate: today }, trx);
    const open = await repo.findOpenBreak(user.id, trx, { forUpdate: true });
    if (!open) throw new AppError('NOT_ON_BREAK');
    const done = await finishBreak(open, { at, reason: 'self', today }, trx);
    const resume = done.endReason === 'self' && open.pausedEntryId && isOpenRow(row);
    if (resume && timers.canUse(user)) {
      await timers.resumeAfterBreak({ userId: user.id, entryId: open.pausedEntryId, at }, trx);
    }
    // Today's totals: a break left open from an earlier day ends by the midnight rule and
    // never counts towards today's allowance.
    const counted = await breakTotalsIn(
      { userId: user.id, workDate: today, breakId: done.id },
      trx,
    );
    return { ended: done, totals: counted };
  });
  await noticeOverAllowance({ userId: user.id, crossed: totals.crossed, total: totals.total });
  return {
    break: ended,
    breakMinutesToday: totals.total,
    overAllowanceMinutes: totals.overAllowanceMinutes,
  };
}

/**
 * A day's break minutes inside the caller's transaction, after a break ended or an away break was
 * saved (call it under the attendance row lock, so of two that end together exactly one sees the
 * crossing): `before` without that break, `total` with it, and whether it took the day over the
 * allowance (allowance above 0, before at or under it, total over it). Only finished breaks
 * count: a break still open counts once it ends, so it never crosses twice.
 * @param {{ userId: number, workDate: string, breakId: number }} input
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<{ before: number, total: number, crossed: boolean,
 *   overAllowanceMinutes: number }>}
 */
export async function breakTotalsIn({ userId, workDate, breakId }, trx) {
  const [current, row, breaks] = await Promise.all([
    settings.getAll(),
    repo.findByUserAndDate(userId, workDate, trx),
    repo.listBreaksByUserDate(userId, workDate, trx),
  ]);
  const at = now();
  const tz = current.timezone;
  const finished = breaks.filter((item) => item.endedAt);
  const total = breakMinutesWithin(finished, row, at, tz);
  const others = finished.filter((item) => Number(item.id) !== Number(breakId));
  const before = breakMinutesWithin(others, row, at, tz);
  const allowance = Number(current.breakAllowanceMinutes) || 0;
  return {
    before,
    total,
    crossed: allowance > 0 && before <= allowance && total > allowance,
    overAllowanceMinutes: allowance > 0 ? Math.max(0, total - allowance) : 0,
  };
}

/**
 * After commit: tells the person their breaks today went over the allowance
 * (attendance.break_over_allowance), only when `crossed` (breakTotalsIn). End break and Remove
 * call it; HR's break fixes never do.
 * @param {{ userId: number, crossed: boolean, total: number }} input
 */
export async function noticeOverAllowance({ userId, crossed, total }) {
  if (!crossed) return;
  const allowance = Number((await settings.getAll()).breakAllowanceMinutes) || 0;
  if (allowance <= 0) return;
  // "the 30 min allowance", "the 1h allowance": never a bare minute count of an hour or more.
  const limit = allowance < 60 ? `${allowance} min` : formatDuration(allowance);
  await notifications.notify({
    userIds: [userId],
    type: 'attendance.break_over_allowance',
    title: `Your breaks today are over the ${limit} allowance`,
    body: `You've had ${formatDuration(total)} of breaks today.`,
    link: '/today',
  });
}

/**
 * The person's open break, if any (one from an earlier day too, until closeForgottenBreaks runs).
 * Lock it (`forUpdate`) only inside a READ COMMITTED transaction, after attendance.lockDay.
 * @param {number} userId
 * @param {import('knex').Knex} [trx]
 * @param {{ forUpdate?: boolean }} [options]
 * @returns {Promise<BreakRow | null>}
 */
export async function getOpenBreak(userId, trx = db, { forUpdate = false } = {}) {
  return (await repo.findOpenBreak(userId, trx, { forUpdate })) ?? null;
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
