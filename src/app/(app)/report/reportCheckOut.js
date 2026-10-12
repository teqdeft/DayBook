// "Submit and check out" on the Daily report (a company request): who is offered it and what it
// says. Pure: the page decides on the server, the button builds its texts in the browser, and the
// unit tests call it directly.
import { can } from '@/lib/permissions';
import { formatTimeAmPm } from '@/lib/time';
import { checkOutBody } from '../today/timerData';

/**
 * Whether the report page offers "Submit and check out": it is today's report, the person may
 * check out (attendance.self, as the check-out route needs) and today's row is still open
 * (checked in, not checked out, not closed by HR or the midnight job). Like Today's Check out, an
 * open row is enough: an Admin who doesn't track attendance but checked in today gets it too.
 * @param {{ user: { role: string, status?: string } | null,
 *   row: { checkOutAt: Date | string | null, checkoutStatus: string } | null,
 *   isToday: boolean }} input
 * @returns {boolean}
 */
export function canCheckOutFromReport({ user, row, isToday }) {
  if (!isToday || !row || !can(user, 'attendance.self')) return false;
  return !row.checkOutAt && row.checkoutStatus === 'open';
}

/**
 * The question before both happen.
 * @param {string} endsAt the time it would end the day, as in sentences ('6:32 PM')
 * @returns {{ title: string, description: string }}
 */
export function submitAndCheckOutQuestion(endsAt) {
  return {
    title: 'Submit your report and check out?',
    description: `This sends today's report and ends your day at ${endsAt}. You can't check in again today.`,
  };
}

/**
 * The toast once the report is in and the person is checked out: the check-out time, and the
 * same note Today's check-out gives (the gap between worked time and logged hours, or the worked
 * time after breaks).
 * @param {{ row: { checkOutAt: Date | string } }} data the check-out response
 * @param {string} tz company time zone
 * @returns {{ title: string, body?: string }}
 */
export function submittedAndCheckedOutToast(data, tz) {
  return {
    title: `Report submitted. Checked out at ${formatTimeAmPm(data.row.checkOutAt, tz)}`,
    body: checkOutBody(data),
  };
}

/**
 * The toast when the report went in but the check-out didn't: the reason, and where to try again
 * (Today's Check out), unless the day has nothing left to check out.
 * @param {{ code?: string, message?: string }} error an ApiError
 * @returns {{ title: string, body: string, tone: 'error' }}
 */
export function checkOutFailedToast(error) {
  const done = ['ALREADY_CHECKED_OUT', 'NOT_CHECKED_IN'].includes(error?.code);
  const reason = error?.message || "Something went wrong and you're still checked in.";
  return {
    title: "Your report is in, but we couldn't check you out",
    body: done ? reason : `${reason} Check out from Today.`,
    tone: 'error',
  };
}
