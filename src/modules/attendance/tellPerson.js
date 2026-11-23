// Tells a person that HR (or an Admin) changed their attendance (bell, type attendance.edited),
// with a link to that month in My log. Shared by HR's edits, break fixes and missing check-out
// fixes (CONTRACT 25). Never tells the actor about their own row.
import { formatDayShort } from '@/lib/time';
import { notifications } from '@/modules/notifications';

/**
 * @param {{ userId: number, actor: { id: number, name: string }, workDate: string,
 *   what?: string, title?: string, body?: string | null }} input the title is
 *   "<actor> <what> your attendance for Fri, 13 Nov" ("Neha Kapoor changed your attendance for
 *   …", "… changed a break in your attendance for …"), or `title` as given
 * @param {import('knex').Knex.Transaction} [trx]
 */
export async function tellPerson({ userId, actor, workDate, what, title, body = null }, trx) {
  if (Number(userId) === Number(actor.id)) return;
  await notifications.notify(
    {
      userIds: [userId],
      type: 'attendance.edited',
      title: title ?? `${actor.name} ${what} your attendance for ${formatDayShort(workDate)}`,
      body,
      link: `/log?month=${workDate.slice(0, 7)}`,
    },
    trx,
  );
}
