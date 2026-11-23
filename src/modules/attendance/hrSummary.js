// The morning HR summary and the evening wrap-up (CONTRACT 25, item 1). HR get them (the active
// Admins when there is no HR person), on working days only (never on a weekend or a company
// holiday): the morning from hr_summary_at until office end, the evening from office end + 30
// minutes. Each recipient gets one bell notification (so a desktop push) and one Slack DM
// (slack_hr_summary). Once per recipient per day: the attendance_alerts claim commits with the
// bell row and the DM, so a failed send rolls its claim back and a later attempt sends it, and
// deleting the bell row never brings it back. Before migration 018 notifications.hasRecent since
// midnight stands in for the claim.
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { clockToMinutes, localToUtc, now, nowDate, toLocal } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { companyDay } from './calendarReads';
import { eveningFacts, loadEvening, loadMorning, morningFacts } from './hrSummaryData';
import * as hrSummaryRepo from './hrSummaryRepo';
import { eveningMessage, morningMessage } from './hrSummaryText';
import { try018Write } from './migration018';
import { transaction } from './repo';
import { hidesAdmins, todayFor } from './rules';

const DUPLICATE = 1062;
const LAST_MINUTE = 23 * 60 + 59;
const WRAP_UP_AFTER_MINUTES = 30;

/** HR people get the summaries; the active Admins when there is no HR (as the HR notes). */
async function hrRecipients() {
  const hr = await users.listByRole('hr');
  return hr.length > 0 ? hr : users.listByRole('admin');
}

function nowMinutes(tz) {
  const local = toLocal(now(), tz);
  return local.hour() * 60 + local.minute();
}

/**
 * One recipient's summary in one transaction: the claim, then the bell row and the Slack DM.
 * @returns {Promise<'sent' | 'already'>}
 */
function sendOnce({ recipient, kind, type, date, build }) {
  return transaction(async (trx) => {
    let claimed;
    try {
      const claim = { userId: recipient.id, kind, periodKey: date, createdAt: nowDate() };
      claimed = await try018Write('alerts', () => hrSummaryRepo.insertSummaryClaim(claim, trx));
    } catch (error) {
      if (error?.errno === DUPLICATE) return 'already';
      throw error;
    }
    if (claimed === null) {
      const { timezone } = await settings.getAll();
      const since = localToUtc(date, '00:00', timezone).toDate();
      if (await notifications.hasRecent({ userId: recipient.id, type, since })) return 'already';
    }
    const message = await build(recipient);
    const { title, body, link } = message;
    await notifications.notify({ userIds: [recipient.id], type, title, body, link }, trx);
    await slack.queueDm(
      {
        slackUserId: recipient.slackUserId,
        text: message.slack,
        settingKey: 'slackHrSummary',
        relatedType: 'hr_summary',
        relatedId: recipient.id,
      },
      trx,
    );
    return 'sent';
  });
}

/** Sends to every recipient on their own; one failing never stops the others. */
async function sendToAll(recipients, options) {
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      if ((await sendOnce({ recipient, ...options })) === 'sent') sent += 1;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, userId: recipient.id, kind: options.kind }, 'HR summary not sent');
    }
  }
  return failed > 0 ? { sent, failed } : { sent };
}

/**
 * The morning summary (worker hr-summary): on a working day, at or after hr_summary_at and
 * before office end, while hr_morning_summary is on. Safe to run again (the claim).
 * @param {string} [today] company date 'YYYY-MM-DD', default today
 * @returns {Promise<{ sent: number, failed?: number }>}
 */
export async function sendHrMorningSummary(today) {
  const current = await settings.getAll();
  const date = today ?? todayFor(current);
  if (!current.hrMorningSummary || !(await companyDay(date)).isWorkingDay) return { sent: 0 };
  const minutes = nowMinutes(current.timezone);
  const from = clockToMinutes(current.hrSummaryAt);
  if (minutes < from || minutes >= clockToMinutes(current.officeEnd)) return { sent: 0 };
  const recipients = await hrRecipients();
  if (recipients.length === 0) return { sent: 0 };
  const data = await loadMorning(date);
  const build = async (recipient) => {
    const waiting = await hrSummaryRepo.countWaiting({
      hideAdmins: hidesAdmins(recipient),
      excludeUserId: recipient.id,
      today: date,
    });
    return morningMessage(morningFacts(data, recipient, waiting), { origin: env.appOrigin });
  };
  return sendToAll(recipients, { kind: 'hr_morning', type: 'attendance.hr_summary', date, build });
}

/**
 * When the evening wrap-up may go: office end + 30 minutes, 23:59 at the latest.
 * @param {string} officeEnd 'HH:mm'
 * @returns {number} minutes after local midnight
 */
export function eveningSummaryMinutes(officeEnd) {
  return Math.min(clockToMinutes(officeEnd) + WRAP_UP_AFTER_MINUTES, LAST_MINUTE);
}

/**
 * The evening wrap-up (worker hr-evening-summary): on a working day, from office end + 30
 * minutes, while hr_evening_summary is on (off by default). Safe to run again (the claim).
 * @param {string} [today] company date 'YYYY-MM-DD', default today
 * @returns {Promise<{ sent: number, failed?: number }>}
 */
export async function sendHrEveningSummary(today) {
  const current = await settings.getAll();
  const date = today ?? todayFor(current);
  if (!current.hrEveningSummary || !(await companyDay(date)).isWorkingDay) return { sent: 0 };
  if (nowMinutes(current.timezone) < eveningSummaryMinutes(current.officeEnd)) return { sent: 0 };
  const recipients = await hrRecipients();
  if (recipients.length === 0) return { sent: 0 };
  const data = await loadEvening(date);
  const build = async (recipient) =>
    eveningMessage(eveningFacts(data, recipient), { origin: env.appOrigin });
  return sendToAll(recipients, {
    kind: 'hr_evening',
    type: 'attendance.hr_evening_summary',
    date,
    build,
  });
}
