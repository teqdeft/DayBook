// Who hears about a holiday change of today or an earlier day (CONTRACT 25, item 6): the active
// Admins other than the actor get one bell (holiday.past_changed) saying how many attendance rows
// changed, and whether the actor's own row is one of them (the one write path where HR changes
// their own late mark); each person whose late minutes changed gets attendance.edited. Report
// reminders, summaries and notices already sent are not sent again or taken back.
import { formatDayShort } from '@/lib/time';
import { plural } from '@/lib/text';
import { notifications } from '@/modules/notifications';
import { users } from '@/modules/users';
import { tellPerson } from './tellPerson';

const TITLES = {
  added: (actor, day) => `${actor.name} added a holiday on ${day}`,
  moved: (actor, day) => `${actor.name} moved a holiday to ${day}`,
  deleted: (actor, day) => `${actor.name} deleted a holiday on ${day}`,
};

/**
 * The bell to the other active Admins: "Neha Kapoor added a holiday on Fri, 13 Nov", body "12
 * attendance rows changed." (" Neha Kapoor's own row is one of them." when it is).
 * @param {{ actor: { id: number, name: string }, verb: 'added' | 'moved' | 'deleted',
 *   date: string, changed: Array<{ userId: number }> }} input date = the holiday's (new) date
 */
async function tellAdmins({ actor, verb, date, changed }) {
  const admins = (await users.listByRole('admin')).filter((admin) => admin.id !== actor.id);
  if (admins.length === 0) return;
  const own = changed.some((item) => Number(item.userId) === Number(actor.id));
  const count = changed.length;
  const body =
    `${count} attendance ${plural(count, 'row')} changed.` +
    (own ? ` ${actor.name}'s own row is one of them.` : '');
  await notifications.notify({
    userIds: admins.map((admin) => admin.id),
    type: 'holiday.past_changed',
    title: TITLES[verb](actor, formatDayShort(date)),
    body,
    link: `/attendance/holidays?year=${date.slice(0, 4)}`,
  });
}

/**
 * "Your late mark for Fri, 13 Nov changed", body "Holiday removed: Diwali.", to each person whose
 * late minutes changed (never the actor: tellPerson skips them).
 * @param {{ actor: object, changed: Array<{ userId: number, workDate: string,
 *   before: { lateMinutes: number }, after: { lateMinutes: number } }>, reason: string }} input
 */
async function tellPeople({ actor, changed, reason }) {
  for (const item of changed) {
    if (item.before.lateMinutes === item.after.lateMinutes) continue;
    await tellPerson({
      userId: item.userId,
      actor,
      workDate: item.workDate,
      title: `Your late mark for ${formatDayShort(item.workDate)} changed`,
      body: `${reason}.`,
    });
  }
}

/**
 * After a holiday write that touches today or an earlier date and changed at least one row: tells
 * the Admins and the people whose late mark changed. Nothing for a write that changed no row.
 * @param {{ actor: { id: number, name: string }, verb: 'added' | 'moved' | 'deleted',
 *   date: string, dates: string[], today: string, changed: object[], reason: string }} input
 *   dates = every date the write touched (the old and the new one on a move)
 */
export async function tellHolidayChange({ actor, verb, date, dates, today, changed, reason }) {
  if (changed.length === 0 || !dates.some((day) => day <= today)) return;
  await tellAdmins({ actor, verb, date, changed });
  await tellPeople({ actor, changed, reason });
}
