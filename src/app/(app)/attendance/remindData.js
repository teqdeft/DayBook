// The day table's reminder data for HR and Admins (CONTRACT 25, item 5). Server only (called from
// attendanceData.js). Per person: the remind the row's menu offers now (remindKindFor), the latest
// reminder of that kind ("Reminded 10:05 by Neha": sent today for the first three kinds, on or
// after the row's date for a missing check-out) and, within the 30 minutes, when HR can remind
// again (the menu then leaves the item out). Never the viewer's own row.
import { can } from '@/lib/permissions';
import { dayjs, localToUtc, now } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { users } from '@/modules/users';

const TODAY_KINDS = ['check_in', 'break', 'check_out'];

/** Today's PersonDay of each person (an earlier date's missing_checkout needs it). */
async function todayDaysFor(userIds, today) {
  const [people, calendar] = await Promise.all([
    users.findByIds(userIds),
    attendance.loadCalendar({ from: today, to: today, userIds, withWfh: false }),
  ]);
  return new Map(people.map((person) => [Number(person.id), calendar.dayFor(person, today)]));
}

/** The rows that can have a remind: everyone today, missing rows on an earlier date. */
function candidatesOf(items, { viewer, isToday }) {
  return items.filter(
    (item) =>
      Number(item.user.id) !== Number(viewer.id) &&
      (isToday || item.attendance?.checkoutStatus === 'missing'),
  );
}

/**
 * Per person on the day table: the remind kind that applies now, their latest reminder of that
 * kind and when they can be reminded again.
 * @param {{ items: object[], date: string, today: string, viewer: object,
 *   settings: object }} input items = listDay() items; settings = settings.getAll()
 * @returns {Promise<Map<number, { kind: string | null, reminded: { sentAt: Date,
 *   sentBy: { id: number, name: string } | null, tz: string } | null, nextAt: Date | null }>>}
 *   nextAt is set while the 30 minutes since the last reminder haven't passed; reminded.tz is
 *   the company time zone ReminderNote writes the time in
 */
export async function loadRemindData({ items, date, today, viewer, settings: current }) {
  const result = new Map();
  const isToday = date === today;
  const people = can(viewer, 'attendance.correct') ? candidatesOf(items, { viewer, isToday }) : [];
  if (people.length === 0) return result;
  const tz = current.timezone;
  const ids = people.map((item) => Number(item.user.id));
  const [missing, todayDays] = isToday
    ? [null, null]
    : await Promise.all([attendance.missingCheckoutsFor(ids), todayDaysFor(ids, today)]);
  const at = now();
  const ctx = { now: at.toDate(), today, date, settings: current, missing, todayDays };
  const lineFrom = localToUtc(date, '00:00', tz);
  const againFrom = at.subtract(attendance.REMIND_EVERY_MINUTES, 'minute');
  const since = (againFrom.isBefore(lineFrom) ? againFrom : lineFrom).toDate();
  const kinds = isToday ? TODAY_KINDS : ['missing_checkout'];
  const sent = await attendance.listReminders({ since, userIds: ids, kinds });
  for (const item of people) {
    const id = Number(item.user.id);
    const kind = attendance.remindKindFor(item, ctx);
    if (!kind) continue;
    // Newest first, so the first one of the kind is the latest.
    const latest = sent.find((entry) => entry.userId === id && entry.kind === kind) ?? null;
    const sentAt = latest ? dayjs(latest.sentAt) : null;
    const nextAt = sentAt?.isAfter(againFrom) ? attendance.nextRemindAt(latest.sentAt) : null;
    const shown = sentAt && !sentAt.isBefore(lineFrom);
    result.set(id, {
      kind,
      reminded: shown ? { sentAt: latest.sentAt, sentBy: latest.sentBy, tz } : null,
      nextAt,
    });
  }
  return result;
}
