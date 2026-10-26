// The timer side of the worker (CONTRACT 15): closing timers forgotten overnight, reminding
// people who have no timer running (whenever timers aren't off, CONTRACT 19) and telling auto
// check-out when someone's timer last ran.
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { dayjs, formatTime, isWorkingDay, now } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { endForgotten } from './forgotten';
import * as repo from './repo';
import { canUse, isOpenRow } from './shared';

const REMINDER_TYPE = 'timer.reminder';
const REMINDER_EVERY_MINUTES = 60;

const later = (a, b) => dayjs(a).isAfter(b);

/** Ends one forgotten entry and tells the person. @returns {Promise<boolean>} closed */
function closeOne(entry, tz) {
  return repo.transaction(async (trx) => {
    const locked = await repo.lockById(entry.id, trx);
    if (!locked || locked.endedAt) return false;
    return endForgotten(entry, tz, trx);
  });
}

/**
 * Worker (close-open-timers, once per date after 00:05): ends every timer still running from an
 * earlier work date by the midnight rule (forgotten.js: check-out, else last active screen time,
 * else its start; stop reason midnight) and notifies its person. One entry that fails is
 * logged and left for the next run; the others still close.
 * @param {string} today 'YYYY-MM-DD' (company date)
 * @returns {Promise<{ closed: number }>}
 */
export async function closeForgotten(today) {
  const { timezone } = await settings.getAll();
  let closed = 0;
  for (const entry of await repo.listRunningBefore(today)) {
    try {
      if (await closeOne(entry, timezone)) closed += 1;
    } catch (error) {
      logger.error({ err: error, entryId: entry.id }, 'forgotten timer could not be closed');
    }
  }
  if (closed > 0) logger.info({ closed }, 'forgotten timers closed');
  return { closed };
}

/** The latest of these moments (nulls skipped). */
function latest(moments) {
  return moments.filter(Boolean).reduce((a, b) => (a === null || later(b, a) ? b : a), null);
}

/** Per person: whether a break is on, and when their last break of the day ended. */
function breaksByUser(breaks) {
  const onBreak = new Set();
  const lastEnd = new Map();
  for (const item of breaks) {
    const userId = Number(item.userId);
    if (!item.endedAt) onBreak.add(userId);
    else lastEnd.set(userId, latest([lastEnd.get(userId), item.endedAt]));
  }
  return { onBreak, lastEnd };
}

/**
 * The people to remind: checked in, timer users, no timer, no break, idle long enough.
 * @returns {Promise<Array<{ row: object, timedToday: boolean }>>} timedToday: the person has a
 *   finished entry today (so they have started a timer before)
 */
async function dueForReminder(today, minutes) {
  const rows = (await attendance.listForDate(today)).filter(isOpenRow);
  const ids = rows.map((row) => Number(row.userId));
  if (ids.length === 0) return [];
  const [people, breaks, running, lastEnded] = await Promise.all([
    users.findByIds(ids),
    attendance.listBreaksForDate(today),
    repo.listRunningUserIds(ids),
    repo.lastEndedByUser(today, ids),
  ]);
  const allowed = new Set(people.filter(canUse).map((person) => Number(person.id)));
  const busy = new Set(running);
  const { onBreak, lastEnd: breakEnd } = breaksByUser(breaks);
  const entryEnd = new Map(lastEnded.map((row) => [Number(row.userId), row.lastEndedAt]));
  const threshold = now().subtract(minutes, 'minute');
  return rows
    .filter((row) => {
      const userId = Number(row.userId);
      if (!allowed.has(userId) || busy.has(userId) || onBreak.has(userId)) return false;
      const since = latest([row.checkInAt, entryEnd.get(userId), breakEnd.get(userId)]);
      return Boolean(since) && !later(since, threshold);
    })
    .map((row) => ({ row, timedToday: entryEnd.has(Number(row.userId)) }));
}

/**
 * The reminder's words (CONTRACT 19): the first one after check-in, while no timer has run today,
 * says so with the check-in time; later ones say "No timer is running".
 */
function reminderText({ first, checkInAt, tz }) {
  const body = "Start a timer for what you're working on.";
  if (!first) return { title: 'No timer is running', body };
  return {
    title: "You haven't started a timer yet",
    body: `You checked in at ${formatTime(checkInAt, tz)}. ${body}`,
  };
}

/**
 * Worker (timer-reminders, every minute while the office is open on working days, whenever timers
 * aren't off): reminds each checked-in timer user who is not on a break and has had no timer
 * running for timerReminderMinutes (since their last entry ended, their last break ended or they
 * checked in), at most once an hour. The first reminder after check-in, while they haven't timed
 * anything today, is "You haven't started a timer yet" ("You checked in at 9:32. ..."); later ones
 * are "No timer is running". Re-checks the mode; the job checks the clock.
 * @param {string} today 'YYYY-MM-DD' (company date)
 * @returns {Promise<{ reminded: number }>}
 */
export async function sendReminders(today) {
  const current = await settings.getAll();
  const minutes = Number(current.timerReminderMinutes) || 0;
  if (current.timersMode === 'off' || minutes <= 0) return { reminded: 0 };
  if (!isWorkingDay(today, current.workingDays)) return { reminded: 0 };
  const since = now().subtract(REMINDER_EVERY_MINUTES, 'minute').toDate();
  let reminded = 0;
  for (const { row, timedToday } of await dueForReminder(today, minutes)) {
    const userId = Number(row.userId);
    if (await notifications.hasRecent({ userId, type: REMINDER_TYPE, since })) continue;
    const first =
      !timedToday &&
      !(await notifications.hasRecent({ userId, type: REMINDER_TYPE, since: row.checkInAt }));
    const text = reminderText({ first, checkInAt: row.checkInAt, tz: current.timezone });
    await db.transaction((trx) =>
      notifications.notify(
        { userIds: [userId], type: REMINDER_TYPE, ...text, link: '/today' },
        trx,
      ),
    );
    reminded += 1;
  }
  return { reminded };
}

/**
 * When the person's project timer last ran on a work date (one of auto check-out's signs of work,
 * CONTRACT 19): `at` while one of that date's entries is still running, else when the last one
 * ended; null without entries. One left running from an earlier work date doesn't count (the
 * midnight rule ends it).
 * @param {{ userId: number, workDate: string, at: Date }} input at: now, as the caller sees it
 * @param {import('knex').Knex} [trx] the caller's transaction
 * @returns {Promise<Date | null>}
 */
export async function lastRanAt({ userId, workDate, at }, trx) {
  const { running, lastEndedAt } = await repo.lastRunOn({ userId, workDate }, trx);
  return running ? at : lastEndedAt;
}
