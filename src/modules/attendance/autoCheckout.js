// Auto check-out when inactive (CONTRACT 19). At office end everyone still checked in is reminded
// (worker checkout-reminder); at autoCheckoutAt everyone still checked in since before office end
// who wasn't seen working lately is checked out at the last moment they were (worker
// auto-checkout). Signs of work are active screen time (any source), window-mode idle time (only
// the Daybook window is watched, so it can be work in another app), project timers and breaks.
// Seen working after office end and within the hour before the check means working late: left
// alone. Nothing happens while screen time is off, since nothing tells idle from working then.
// Notifications go to the person only (CONTRACT 16). `timers` is only used inside functions
// (attendance and timers import each other).
import { logger } from '@/lib/logger';
import { clockToMinutes, dayjs, formatClock, formatTimeAmPm, now, nowDate } from '@/lib/time';
import { activity } from '@/modules/activity';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { users } from '@/modules/users';
import { endOpenBreak, lockDay } from './breaks';
import { auditView } from './hr';
import * as repo from './repo';
import { clockOn, isOpenRow, todayFor } from './rules';

/** Someone counts as working late only when seen working this recently before the check. */
const RECENT_MINUTES = 60;

const ms = (value) => dayjs(value).valueOf();

/**
 * The check window of a work date: office end to the auto check-out time, as UTC Dates; null when
 * the auto check-out time isn't after office end (a hand-edited row; Settings refuses it).
 * @param {string} date 'YYYY-MM-DD'
 * @param {{ officeEnd: string, autoCheckoutAt: string, timezone: string }} current settings
 * @returns {{ from: Date, to: Date } | null}
 */
export function checkWindow(date, current) {
  if (clockToMinutes(current.autoCheckoutAt) <= clockToMinutes(current.officeEnd)) return null;
  return {
    from: clockOn(date, current.officeEnd, current),
    to: clockOn(date, current.autoCheckoutAt, current),
  };
}

/**
 * The last moment the person was seen working, capped at `at`: the end of an active screen-time
 * segment (any source) or of a window-mode idle one (CONTRACT 11: only the Daybook window is
 * watched, so idle there can be work in another app, as for away time in CONTRACT 15), when their
 * timer last ran (`at` while it runs), or a break's start or end. Null when there is none.
 * @param {{ segments: Array<{ state: string, source: string, endedAt: Date }>,
 *   timerAt: Date | null, breaks: Array<{ startedAt: Date, endedAt: Date | null }>,
 *   at: Date }} input
 * @returns {Date | null}
 */
export function lastSeenWorking({ segments, timerAt, breaks, at }) {
  const moments = [timerAt];
  for (const segment of segments) {
    const windowIdle = segment.state === 'idle' && segment.source === 'window';
    if (segment.state === 'active' || windowIdle) moments.push(segment.endedAt);
  }
  for (const item of breaks) moments.push(item.startedAt, item.endedAt);
  const known = moments.filter(Boolean).map(ms);
  return known.length === 0 ? null : new Date(Math.min(Math.max(...known), ms(at)));
}

/**
 * True when the person was seen working after office end and within the hour before `at`.
 * @param {Date | null} lastSeen lastSeenWorking()
 * @param {Date} officeEndAt
 * @param {Date} at the check, now
 */
export function workingLately(lastSeen, officeEndAt, at) {
  if (!lastSeen) return false;
  const recent = dayjs(at).subtract(RECENT_MINUTES, 'minute').valueOf();
  return ms(lastSeen) > Math.max(ms(officeEndAt), recent);
}

/**
 * When an inactive person is checked out: the last moment they were seen working when it is after
 * the check-in (after office end too: they left late), else office end (no data). Whole seconds.
 * @param {{ checkInAt: Date }} row AttendanceRow
 * @param {Date | null} lastSeen lastSeenWorking()
 * @param {Date} officeEndAt
 * @returns {Date}
 */
export function autoCheckoutTime(row, lastSeen, officeEndAt) {
  const usable = lastSeen !== null && ms(lastSeen) > ms(row.checkInAt);
  return dayjs(usable ? lastSeen : officeEndAt)
    .startOf('second')
    .toDate();
}

/**
 * True for someone whose own shift ends after office end: their working day isn't over at the
 * check, so they are neither reminded nor checked out (the midnight rule still applies).
 */
function worksLate(person, current) {
  return (
    Boolean(person?.shiftEnd) && clockToMinutes(person.shiftEnd) > clockToMinutes(current.officeEnd)
  );
}

/** The open rows of a date with their people (PublicUser or null), lowest user id first. */
async function openRowsWithPeople(date) {
  const rows = (await repo.listByDate(date)).filter(isOpenRow);
  const people = await users.findByIds([...new Set(rows.map((row) => Number(row.userId)))]);
  const byId = new Map(people.map((person) => [Number(person.id), person]));
  return rows.map((row) => ({ row, person: byId.get(Number(row.userId)) ?? null }));
}

/**
 * Worker (checkout-reminder, once per date at office end): tells everyone still checked in today
 * that they are ("You're still checked in"). Only active people, and nobody whose own shift ends
 * after office end. Does nothing when autoCheckoutEnabled is off.
 * @param {string} [today] 'YYYY-MM-DD', default today's company date
 * @returns {Promise<{ reminded: number }>}
 */
export async function sendCheckoutReminders(today) {
  const current = await settings.getAll();
  if (!current.autoCheckoutEnabled) return { reminded: 0 };
  const open = await openRowsWithPeople(today ?? todayFor(current));
  const userIds = open
    .filter(({ person }) => person?.status === 'active' && !worksLate(person, current))
    .map(({ person }) => person.id);
  const reminded = await notifications.notify({
    userIds,
    type: 'attendance.checkout_reminder',
    title: "You're still checked in",
    body: "Check out if you're done for the day. If you're still working, carry on.",
    link: '/today',
  });
  return { reminded };
}

/**
 * Tells the person they were checked out (attendance.auto_checkout) and audits it. "No activity
 * after" names office end, or the check-out time when they left after office end.
 */
async function recordAutoCheckout({ before, after, person, officeEndAt, current }, trx) {
  const quietAfter = dayjs(after.checkOutAt).isAfter(officeEndAt)
    ? formatTimeAmPm(after.checkOutAt, current.timezone)
    : formatClock(current.officeEnd);
  await audit.log(
    {
      actorId: null,
      action: 'attendance.auto_checkout',
      entityType: 'attendance',
      entityId: after.id,
      before: auditView(before),
      after: auditView(after),
      reason: `No activity after ${quietAfter}`,
    },
    trx,
  );
  if (person?.status !== 'active') return;
  await notifications.notify(
    {
      userIds: [after.userId],
      type: 'attendance.auto_checkout',
      title: `You were checked out at ${formatTimeAmPm(after.checkOutAt, current.timezone)}`,
      body:
        `There was no activity on your computer after ${quietAfter}. ` +
        'If you were working, request a correction.',
      link: '/today',
    },
    trx,
  );
}

/** lastSeenWorking() for one person's work date, read inside the caller's transaction. */
async function lastSeenOf({ userId, workDate, at }, trx) {
  const day = await activity.getDay(userId, workDate);
  const timerAt = await timers.lastRanAt({ userId, workDate, at }, trx);
  const breaks = await repo.listBreaksByUserDate(userId, workDate, trx);
  return lastSeenWorking({ segments: day.segments, timerAt, breaks, at });
}

/**
 * One person, one transaction, in check-out's lock order (CONTRACT 15): their attendance row,
 * then the open break, then the running timer. The check runs at the moment the row is locked,
 * so a heartbeat or timer start that came in while the job worked on others counts, and one
 * after waits and finds the row closed.
 * @returns {Promise<'checked_out' | 'kept' | 'skipped'>} skipped: no longer open
 */
function checkOutIfIdle({ row, person, officeEndAt, current }) {
  const { userId, workDate } = row;
  return repo.transaction(async (trx) => {
    const locked = await lockDay({ userId, workDate }, trx);
    if (!isOpenRow(locked)) return 'skipped';
    const checkedAt = nowDate();
    const lastSeen = await lastSeenOf({ userId, workDate, at: checkedAt }, trx);
    if (workingLately(lastSeen, officeEndAt, checkedAt)) return 'kept';
    const at = autoCheckoutTime(locked, lastSeen, officeEndAt);
    const changes = {
      checkOutAt: at,
      checkOutIp: null,
      checkoutStatus: 'auto',
      updatedAt: checkedAt,
    };
    if ((await repo.closeOpenRow(locked.id, changes, trx)) === 0) return 'skipped';
    await endOpenBreak({ userId, at, reason: 'checkout' }, trx);
    await timers.stopRunning({ userId, at, reason: 'checkout' }, trx);
    const after = await repo.findById(locked.id, trx);
    await recordAutoCheckout({ before: locked, after, person, officeEndAt, current }, trx);
    return 'checked_out';
  });
}

/**
 * Worker (auto-checkout, once per date at autoCheckoutAt): checks out everyone still checked in
 * today since before office end who wasn't seen working (lastSeenWorking: screen time, window-mode
 * idle, timers, breaks) after office end and within the hour before the check, which runs when
 * each row is locked (a late run checks then too). The check-out time is autoCheckoutTime() (the
 * last moment seen working, else office end), checkout_status 'auto', no IP; an open break ends
 * there ('checkout') and a running timer stops there ('checkout'). The person is notified; audit
 * 'attendance.auto_checkout' (no actor). Rows checked in at or after office end, and people whose
 * own shift ends after office end, are left alone (the midnight rule handles forgotten ones). One
 * row that fails is logged and the others still run. Does nothing when autoCheckoutEnabled or
 * screen time (activityTrackingEnabled) is off, before the check time or without a valid window.
 * @param {string} [today] 'YYYY-MM-DD', default today's company date
 * @returns {Promise<{ checkedOut: number, kept: number }>} kept: working, or left alone
 */
export async function autoCheckOut(today) {
  const current = await settings.getAll();
  const counts = { checkedOut: 0, kept: 0 };
  if (!current.autoCheckoutEnabled) return counts;
  const date = today ?? todayFor(current);
  if (!current.activityTrackingEnabled) {
    logger.info({ date }, 'auto check-out skipped: screen time is off, so idle is unknown');
    return counts;
  }
  const window = checkWindow(date, current);
  if (!window) {
    logger.warn(
      { date },
      'auto check-out skipped: the auto check-out time is not after office end',
    );
    return counts;
  }
  if (now().isBefore(window.to)) return counts;
  for (const { row, person } of await openRowsWithPeople(date)) {
    if (!dayjs(row.checkInAt).isBefore(window.from)) continue;
    if (worksLate(person, current)) {
      counts.kept += 1;
      continue;
    }
    try {
      const outcome = await checkOutIfIdle({ row, person, officeEndAt: window.from, current });
      if (outcome === 'checked_out') counts.checkedOut += 1;
      if (outcome === 'kept') counts.kept += 1;
    } catch (error) {
      logger.error({ err: error, attendanceId: row.id }, 'auto check-out failed for one person');
    }
  }
  if (counts.checkedOut > 0) logger.info({ date, ...counts }, 'auto check-outs done');
  return counts;
}
