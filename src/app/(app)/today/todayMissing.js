// The words and the live limit check of Today's missing check-out line and pop-up (CONTRACT 25,
// item B). Pure and client-safe (only @/lib/time): the rows come from listMyMissingCheckouts()
// with their clocks already in company time ('HH:mm'), so nothing here needs the time zone.
import { formatClock, formatDayShort } from '@/lib/time';

/** The pop-up opens this long after hydration, then tries again while another modal is open. */
export const FIRST_TRY_MS = 1500;
export const RETRY_MS = 2000;
export const MAX_TRIES = 30; // about a minute

/**
 * The line above the correction links: one row names its day, several are counted.
 * @param {Array<{ workDate: string }>} items
 * @returns {{ text: string, button: string } | null}
 */
export function promptLine(items) {
  if (!items?.length) return null;
  if (items.length === 1) {
    return {
      text: `You didn't check out on ${formatDayShort(items[0].workDate)}.`,
      button: 'Add the time',
    };
  }
  return { text: `You have ${items.length} missing check-outs.`, button: 'Add the times' };
}

/**
 * True when a typed time needs HR: after the row's limit, or any time when it has none.
 * @param {string} clock 'HH:mm' from the time input ('' while empty)
 * @param {{ limitClock: string | null }} row
 */
export function needsHr(clock, row) {
  if (!row.limitClock) return true;
  return Boolean(clock) && clock > row.limitClock;
}

/** The marigold box over the limit (or for a row with no limit at all). */
export function limitText(row) {
  if (!row.limitClock) return "That wasn't a working day for you, so HR checks the time first.";
  return `After ${formatClock(row.limitClock)}, HR checks the time first.`;
}

/** The help under "Time you left". */
export function suggestionHelp(row) {
  return row.suggestedClock
    ? `Daybook last saw you working at ${formatClock(row.suggestedClock)}.`
    : 'Daybook has nothing to suggest for that day.';
}

/** The pop-up's title and the muted check-in line. */
export function dialogWords(row) {
  return {
    title: `You didn't check out on ${formatDayShort(row.workDate)}`,
    checkedIn: `You checked in at ${formatClock(row.checkInClock)}.`,
  };
}

/**
 * The toast after a save.
 * @param {'saved' | 'sent'} outcome
 * @param {{ workDate: string }} row
 * @param {string} clock the time sent ('HH:mm')
 */
export function savedToast(outcome, row, clock) {
  const day = formatDayShort(row.workDate);
  if (outcome === 'sent') {
    return { title: 'Sent to HR', body: `HR will check your check-out for ${day}.` };
  }
  return { title: 'Check-out saved', body: `${day}, ${formatClock(clock)}.` };
}

/** The visually hidden status after a save, when another row follows. */
export function nextStatus(row) {
  return `Saved. Next: ${formatDayShort(row.workDate)}.`;
}
