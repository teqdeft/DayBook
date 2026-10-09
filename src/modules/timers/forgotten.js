// The midnight rule (CONTRACT 15) for a timer still running from an earlier work date: it ends at
// that day's check-out, else when screen time last saw the person active, else at its start. The
// worker's close-open-timers uses it, and so does any start or stop that finds such a timer first
// (the worker was down), so it never runs on into the evening or counts as today's.
import { dayjs, formatTimeAmPm, nowDate } from '@/lib/time';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { notifications } from '@/modules/notifications';
import * as repo from './repo';
import { endOfWorkDate, wholeSecond } from './rules';

const later = (a, b) => dayjs(a).isAfter(b);

/**
 * Where a forgotten entry ends: the day's check-out when it is after the start, else the last
 * time screen time saw the person active that day when it is after the start (idle or locked
 * time after it doesn't count), else the start; never past the end of the work date.
 * @returns {Promise<{ endedAt: Date, why: 'checkout' | 'active' | 'start' }>}
 */
export async function forgottenEnd(entry, tz) {
  let end = { at: entry.startedAt, why: 'start' };
  const row = await attendance.getForUserOnDate(entry.userId, entry.workDate);
  if (row?.checkOutAt && later(row.checkOutAt, entry.startedAt)) {
    end = { at: row.checkOutAt, why: 'checkout' };
  } else {
    const day = await activity.getDay(entry.userId, entry.workDate);
    if (day.lastActiveAt && later(day.lastActiveAt, entry.startedAt)) {
      end = { at: day.lastActiveAt, why: 'active' };
    }
  }
  const dayEnd = endOfWorkDate(entry.workDate, tz);
  return { endedAt: wholeSecond(later(end.at, dayEnd) ? dayEnd : end.at), why: end.why };
}

/** The `timer.stopped_midnight` body for how the end was found. */
function midnightBody(why, endedAt, tz) {
  const time = formatTimeAmPm(endedAt, tz);
  const check = 'Check your report before it locks.';
  if (why === 'active') {
    return `We stopped it at ${time}, the last time Daybook saw you active. ${check}`;
  }
  if (why === 'checkout') return `We stopped it at ${time}, when you checked out. ${check}`;
  return `We couldn't tell when you stopped, so we stopped it at ${time}, when it started. ${check}`;
}

/**
 * Ends a locked entry still running from an earlier work date by the midnight rule (stop reason
 * midnight), inside the caller's transaction, and tells its person.
 * @param {{ id: number, userId: number, workDate: string, startedAt: Date,
 *   projectName?: string }} entry
 * @param {string} tz
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<boolean>} false when it had already ended
 */
export async function endForgotten(entry, tz, trx) {
  const { endedAt, why } = await forgottenEnd(entry, tz);
  const stop = { endedAt, stopReason: 'midnight', updatedAt: nowDate() };
  if ((await repo.endRunning(entry.id, stop, trx)) === 0) return false;
  const projectName = entry.projectName ?? (await repo.findById(entry.id, trx))?.projectName;
  await notifications.notify(
    {
      userIds: [entry.userId],
      type: 'timer.stopped_midnight',
      title: `Your timer on ${projectName} was still running`,
      body: midnightBody(why, endedAt, tz),
      link: `/report?date=${entry.workDate}`,
    },
    trx,
  );
  return true;
}
