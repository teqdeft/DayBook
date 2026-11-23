// The late alert to HR (CONTRACT 25, item 10): once a person reaches late_alert_days late days in
// a payroll month, HR (or the Admins, pickRecipients) get one bell notification, so also a desktop
// push. Once per person per payroll month: the attendance_alerts unique key is the claim, so the
// three daily attempts of the worker job are safe. No Slack DM, and the person is never told.
import { logger } from '@/lib/logger';
import { plural } from '@/lib/text';
import { addDays, addMonths, eachDay, formatDuration, isWorkingDay, nowDate } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { companyDay, listHolidaysBetween } from './calendarReads';
import { try018Write } from './migration018';
import { summarizeRange } from './month';
import * as monthRepo from './monthRepo';
import { payrollMonthOf, payrollPeriod } from './payroll';
import { loadRecipientPools, pickRecipients } from './recipients';
import { transaction } from './repo';

const DUPLICATE = 1062;

/** True when no working day of the period comes before `today` (holidays skipped). */
async function isFirstWorkingDay(from, today, workingDays) {
  if (today <= from) return true;
  const yesterday = addDays(today, -1);
  const holidays = new Set((await listHolidaysBetween(from, yesterday)).map((item) => item.date));
  return !eachDay(from, yesterday).some((date) => isWorkingDay(date, workingDays, holidays));
}

/** The bell text: "this month" for the current period, "last month" for the one that closed. */
function alertText(person, period, isCurrent) {
  const days = person.lateDays;
  const when = isCurrent ? 'this month' : 'last month';
  const so = isCurrent ? 'so far ' : '';
  return {
    title: `${person.user.name} was late ${days} ${plural(days, 'time')} ${when}`,
    body: `${days} ${plural(days, 'late day')} ${so}in ${period.label}, ${formatDuration(person.lateMinutes)} in all.`,
    link: `/attendance/people/${person.user.id}?month=${period.month}`,
  };
}

/**
 * Claims and sends one person's alert in one transaction: 'sent', 'already' (told this period),
 * or 'unavailable' (before migration 018). A failed notification rolls the claim back.
 */
function alertOne({ person, period, pools, isCurrent }) {
  return transaction(async (trx) => {
    const claim = {
      userId: person.user.id,
      kind: 'late_days',
      periodKey: period.month,
      days: person.lateDays,
      createdAt: nowDate(),
    };
    let claimed;
    try {
      claimed = await try018Write('alerts', () => monthRepo.insertAlert(claim, trx));
    } catch (error) {
      if (error?.errno === DUPLICATE) return 'already';
      throw error;
    }
    if (claimed === null) return 'unavailable';
    const recipients = pickRecipients(pools, person.user);
    if (recipients.length > 0) {
      const text = alertText(person, period, isCurrent);
      await notifications.notify(
        { userIds: recipients.map((user) => user.id), type: 'attendance.late_alert', ...text },
        trx,
      );
    }
    return 'sent';
  });
}

/** The periods to check: the current one, and on its first working day the one before it. */
async function periodsFor(today, current) {
  const startDay = current.payrollMonthStartDay;
  const month = payrollMonthOf(today, startDay);
  const period = payrollPeriod(month, startDay);
  const list = [{ period, isCurrent: true }];
  if (await isFirstWorkingDay(period.from, today, current.workingDays)) {
    list.unshift({ period: payrollPeriod(addMonths(month, -1), startDay), isCurrent: false });
  }
  return list;
}

/**
 * The late alert run (worker `late-alerts`, at office end on working days): every active person
 * whose payroll month so far has at least late_alert_days late days, each in its own transaction
 * and try/catch (one failing person never stops the others). On the first working day of a
 * period the previous period is checked through its last day too (its own key).
 * @param {string} today company date 'YYYY-MM-DD'
 * @returns {Promise<{ alerted: number, checked: number, holiday?: boolean,
 *   unavailable?: boolean }>} holiday: nothing on a company holiday; unavailable: before
 *   migration 018 (one warning, nothing sent)
 */
export async function sendLateAlerts(today) {
  const day = await companyDay(today);
  if (!day.isWorkingDay)
    return { alerted: 0, checked: 0, ...(day.holiday ? { holiday: true } : {}) };
  const current = await settings.getAll();
  const pools = await loadRecipientPools();
  let alerted = 0;
  let checked = 0;
  for (const { period, isCurrent } of await periodsFor(today, current)) {
    const summary = await summarizeRange({ from: period.from, to: period.to });
    for (const person of summary.people) {
      if (person.user.status !== 'active') continue;
      checked += 1;
      if (person.lateDays < current.lateAlertDays) continue;
      try {
        const outcome = await alertOne({ person, period, pools, isCurrent });
        if (outcome === 'unavailable') return { alerted, checked, unavailable: true };
        if (outcome === 'sent') alerted += 1;
      } catch (error) {
        logger.error({ err: error, userId: person.user.id }, 'late alert not sent');
      }
    }
  }
  return { alerted, checked };
}
