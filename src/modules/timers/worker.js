// The timer side of the worker (CONTRACT 15): closing timers forgotten overnight and reminding
// people in required mode who have no timer running.
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { dayjs, isWorkingDay, now } from '@/lib/time';
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

/** The people to remind: checked in, timer users, no timer, no break, idle long enough. */
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
  return rows.filter((row) => {
    const userId = Number(row.userId);
    if (!allowed.has(userId) || busy.has(userId) || onBreak.has(userId)) return false;
    const since = latest([row.checkInAt, entryEnd.get(userId), breakEnd.get(userId)]);
    return Boolean(since) && !later(since, threshold);
  });
}

/**
 * Worker (timer-reminders, every minute while the office is open in required mode): reminds each
 * checked-in timer user who is not on a break and has had no timer running for
 * timerReminderMinutes (since their last entry ended, their last break ended or they checked in),
 * at most once an hour ("No timer is running"). Re-checks the mode; the job checks the clock.
 * @param {string} today 'YYYY-MM-DD' (company date)
 * @returns {Promise<{ reminded: number }>}
 */
export async function sendReminders(today) {
  const current = await settings.getAll();
  const minutes = Number(current.timerReminderMinutes) || 0;
  if (current.timersMode !== 'required' || minutes <= 0) return { reminded: 0 };
  if (!isWorkingDay(today, current.workingDays)) return { reminded: 0 };
  const since = now().subtract(REMINDER_EVERY_MINUTES, 'minute').toDate();
  let reminded = 0;
  for (const row of await dueForReminder(today, minutes)) {
    const userId = Number(row.userId);
    if (await notifications.hasRecent({ userId, type: REMINDER_TYPE, since })) continue;
    await db.transaction((trx) =>
      notifications.notify(
        {
          userIds: [userId],
          type: REMINDER_TYPE,
          title: 'No timer is running',
          body: "Start a timer for what you're working on.",
          link: '/today',
        },
        trx,
      ),
    );
    reminded += 1;
  }
  return { reminded };
}
