// The row menu's remind item and the toast after a remind (CONTRACT 25, item 5), client-safe. The
// item says which remind it sends, so on touch HR can tell: "Remind to check in", "Remind about the
// break", "Remind to check out" or "Ask for the check-out time", with a 14 px BellRing. RowMenu
// (builder F) puts it first in the row's "..." menu.
import { createElement } from 'react';
import { BellRing } from 'lucide-react';
import { plural } from '@/lib/text';

export const REMIND_LABELS = {
  check_in: 'Remind to check in',
  break: 'Remind about the break',
  check_out: 'Remind to check out',
  missing_checkout: 'Ask for the check-out time',
};

/**
 * @param {{ kind: 'check_in' | 'break' | 'check_out' | 'missing_checkout',
 *   user: { id: number, name: string },
 *   send: (kind: string, users: Array<{ id: number, name: string }>) => Promise<unknown> }} input
 *   send from useRemind()
 * @returns {{ label: string, icon: import('react').ReactNode, onSelect: () => void } | null} a
 *   Menu item (null for an unknown kind)
 */
export function remindMenuItem({ kind, user, send }) {
  const label = REMIND_LABELS[kind];
  if (!label) return null;
  return {
    label,
    icon: createElement(BellRing, { size: 14, strokeWidth: 1.8, 'aria-hidden': true }),
    onSelect: () => send(kind, [user]),
  };
}

const SKIP_TITLES = {
  not_needed: 'No reminder needed',
  too_soon: 'Not sent yet',
  not_allowed: "Couldn't send the reminder",
};

/** The toast for one skip: "No reminder needed" and "Not sent yet" in the default tone. */
function skipToast(skip, body) {
  const title = SKIP_TITLES[skip.reason] ?? SKIP_TITLES.not_needed;
  return skip.reason === 'not_allowed' ? { title, body, tone: 'error' } : { title, body };
}

/**
 * The toast after POST /api/attendance/reminders. One person: "Reminder sent" ("Sent to Priya
 * Sharma."), "No reminder needed" or "Not sent yet" with the reason. Several: "Reminded 3
 * people"; partly "Reminded 2 people" with the first skip's message, plus "1 more not sent."
 * when more were skipped.
 * @param {{ sent: Array<{ name: string }>, skipped: Array<{ reason: string, message: string }> }}
 *   result the API's answer
 * @param {number} asked how many people were asked about
 * @returns {{ title: string, body?: string, tone?: 'error' }}
 */
export function remindToast({ sent = [], skipped = [] }, asked) {
  if (asked <= 1 && sent.length === 1) {
    return { title: 'Reminder sent', body: `Sent to ${sent[0].name}.` };
  }
  const [first, ...others] = skipped;
  const more = others.length > 0 ? ` ${others.length} more not sent.` : '';
  if (sent.length === 0) {
    return first ? skipToast(first, `${first.message}${more}`) : { title: 'No reminder needed' };
  }
  const title = `Reminded ${sent.length} ${plural(sent.length, 'person', 'people')}`;
  return first ? { title, body: `${first.message}${more}` } : { title };
}
