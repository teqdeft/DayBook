// Today's attendance status words: the pill next to "Check out" and the gentle "Still working?"
// line under the top bar after office hours (auto check-out, CONTRACT 19). Pure; page data only.
import { clockToMinutes, formatTime, now, toLocal } from '@/lib/time';

export const STILL_WORKING = "Still working? You'll stay checked in as long as you're active.";

/**
 * The status pill next to "Check out": "In office since 9:32", WFH, unverified, on a break
 * ("On break since 1:10", CONTRACT 15) or checked out ("Checked out automatically at 6:12" after
 * an auto check-out, CONTRACT 19).
 * @param {object | null} row today's AttendanceRow
 * @param {string} tz company time zone
 * @param {{ startedAt: Date } | null} openBreak
 * @returns {{ tone: string, text: string } | null}
 */
export function statusPill(row, tz, openBreak) {
  if (!row) return null;
  const since = formatTime(row.checkInAt, tz);
  if (row.checkOutAt && row.checkoutStatus === 'auto') {
    return {
      tone: 'neutral',
      text: `Checked out automatically at ${formatTime(row.checkOutAt, tz)}`,
    };
  }
  if (row.checkOutAt) {
    return { tone: 'neutral', text: `Checked out at ${formatTime(row.checkOutAt, tz)}` };
  }
  if (row.checkoutStatus !== 'open') return { tone: 'neutral', text: 'Checked out' };
  if (openBreak) {
    return { tone: 'marigold', text: `On break since ${formatTime(openBreak.startedAt, tz)}` };
  }
  if (row.location === 'wfh') return { tone: 'violet', text: `Working from home since ${since}` };
  if (!row.officeVerified) {
    return { tone: 'marigold', text: `In office since ${since}, unverified` };
  }
  return { tone: 'green', text: `In office since ${since}` };
}

/**
 * "Still working? You'll stay checked in as long as you're active." while today's row is open
 * after the office ends and auto check-out is on; otherwise null.
 * @param {{ row: object | null, settings: { autoCheckoutEnabled: boolean, officeEnd: string },
 *   tz: string, at?: import('dayjs').Dayjs | Date }} input at: defaults to now()
 * @returns {string | null}
 */
export function stillWorkingNote({ row, settings, tz, at = now() }) {
  if (!settings?.autoCheckoutEnabled) return null;
  if (!row || row.checkOutAt || row.checkoutStatus !== 'open') return null;
  const clock = toLocal(at, tz).format('HH:mm');
  return clockToMinutes(clock) >= clockToMinutes(settings.officeEnd) ? STILL_WORKING : null;
}
