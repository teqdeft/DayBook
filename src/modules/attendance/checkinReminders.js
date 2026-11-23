// The automatic check-in reminder (CONTRACT 25, item 5; worker checkin-reminders, every minute).
// On working days (not on a weekend or a company holiday), someone who hasn't checked in gets one
// reminder from checkin_reminder_minutes after their own late mark (on first-half leave, the
// split plus the company's grace), at most an hour later than that (a worker that was down sends
// nothing more than an hour late) and before their day ends. Once a day: any check-in reminder
// that day, HR's included, stops it (the claim's range starts at midnight), and auto_key
// 'check_in:<date>' keeps two workers from both sending. Before migration 018 it sends nothing.
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { clockToMinutes, localToUtc, now, toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { presenceOf } from './calendar';
import { companyDay, loadCalendar } from './calendarReads';
import { guard018Read } from './migration018';
import * as reminderRepo from './reminderRepo';
import { claimAndSend } from './reminders';
import * as repo from './repo';
import { todayFor } from './rules';

// A reminder is due for this long after it becomes due, then no more that day.
const LATE_LIMIT_MINUTES = 60;

/** True when the person's reminder is due at `minutes` (after local midnight). */
function isDue(day, minutes, after) {
  if (!day.lateMark || !day.dayEnd) return false;
  const from = clockToMinutes(day.lateMark) + after;
  return (
    minutes >= from && minutes < from + LATE_LIMIT_MINUTES && minutes < clockToMinutes(day.dayEnd)
  );
}

/** Active tracked people (attendance.self) without a check-in or a reminder today, due now. */
async function duePeople(date, current, sentToday) {
  const [people, rows, calendar] = await Promise.all([
    users.listActive({ tracksAttendance: true }),
    repo.listByDate(date),
    loadCalendar({ from: date, to: date, withWfh: false }),
  ]);
  const checkedIn = new Set(rows.map((row) => Number(row.userId)));
  const at = now();
  const local = toLocal(at, current.timezone);
  const minutes = local.hour() * 60 + local.minute();
  const due = [];
  for (const person of people) {
    if (!can(person, 'attendance.self') || checkedIn.has(person.id) || sentToday.has(person.id)) {
      continue;
    }
    const day = calendar.dayFor(person, date);
    const presence = presenceOf({ day, row: null, at, tz: current.timezone });
    if (presence === 'not_checked_in' && isDue(day, minutes, current.checkinReminderMinutes)) {
      due.push({ person, day });
    }
  }
  return due;
}

/**
 * Reminds everyone due now to check in (see the file comment). Each person is sent on their
 * own; one failing never stops the others.
 * @param {string} [today] company date 'YYYY-MM-DD', default today
 * @returns {Promise<{ reminded: number, unavailable?: boolean }>} unavailable: before
 *   migration 018 (one warning per process, nothing sent)
 */
export async function sendCheckinReminders(today) {
  const current = await settings.getAll();
  if (!(current.checkinReminderMinutes > 0)) return { reminded: 0 };
  const date = today ?? todayFor(current);
  if (!(await companyDay(date)).isWorkingDay) return { reminded: 0 };
  const sent = await guard018Read(
    'reminders',
    () => reminderRepo.listUserIdsForDay({ workDate: date, kind: 'check_in' }),
    () => null,
  );
  if (sent === null) return { reminded: 0, unavailable: true };
  const since = localToUtc(date, '00:00', current.timezone).toDate();
  let reminded = 0;
  for (const { person, day } of await duePeople(date, current, new Set(sent))) {
    try {
      const outcome = await claimAndSend(
        { person, kind: 'check_in', since, autoKey: `check_in:${date}` },
        { expectedStart: day.expectedStart },
      );
      if (outcome.status === 'sent') reminded += 1;
    } catch (error) {
      logger.error({ err: error, userId: person.id }, 'check-in reminder not sent');
    }
  }
  return { reminded };
}
