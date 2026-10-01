// The report-reminder job (build guide sections 11 and 12): at report_reminder_at on working days,
// everyone checked in today without a submitted report gets a notification and a Slack DM.
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { can } from '@/lib/permissions';
import { formatDayShort } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { notifications } from '@/modules/notifications';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import * as repo from './repo';

/**
 * Reminds each active, tracked person who writes reports (never a PM) who checked in on `day`
 * but hasn't submitted that day's report: an in-app notification ("Your report for Wed, 30 Sep
 * isn't in yet.") and a Slack DM with a link to /report (only when slack_remind is on). The
 * worker runs it once per day through runOnce.
 * @param {string} day 'YYYY-MM-DD'
 * @returns {Promise<{ reminded: number }>}
 */
export async function sendReportReminders(day) {
  const rows = await attendance.listForDate(day);
  const ids = [...new Set((rows ?? []).map((row) => Number(row.userId)).filter(Boolean))];
  if (ids.length === 0) return { reminded: 0 };
  // Only tracked people who write reports: PMs never do (company rule), even with an old
  // attendance row from before that rule.
  const people = (await users.findByIds(ids)).filter(
    (person) =>
      person &&
      person.status === 'active' &&
      person.tracksAttendance !== false &&
      can(person, 'report.self'),
  );
  const submitted = new Set(
    (
      await repo.listSubmittedUserIds(
        people.map((person) => person.id),
        day,
      )
    ).map(Number),
  );
  const due = people.filter((person) => !submitted.has(Number(person.id)));
  const title = `Your report for ${formatDayShort(day)} isn't in yet.`;
  const text = `${title} <${env.appOrigin}/report|Write your report>`;
  for (const person of due) {
    await db.transaction(async (trx) => {
      await notifications.notify(
        { userIds: [person.id], type: 'report.reminder', title, link: '/report' },
        trx,
      );
      await slack.queueDm(
        {
          slackUserId: person.slackUserId,
          text,
          settingKey: 'slackRemind',
          relatedType: 'report_reminder',
          relatedId: person.id,
        },
        trx,
      );
    });
  }
  return { reminded: due.length };
}
