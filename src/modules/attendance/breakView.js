// How a break reads in HR's break list (CONTRACT 25, item 2): its label, the note after it and the
// list's description line. Pure (only @/lib/time), unit tested. HR never sees the project, the
// kind of away span or any screen time here: only times and "Away, removed from timer".
import {
  dayjs,
  formatClock,
  formatClockShort,
  formatDuration,
  minutesBetween,
  toLocal,
} from '@/lib/time';

const NOTES = {
  checkout: 'Ended at check-out',
  timer: 'Ended when a timer started',
  midnight: 'Closed at midnight',
};

/**
 * "On break now" while open, "Away, removed from timer" for an away break, else "Break".
 * @param {{ endedAt: Date | string | null, source?: 'self' | 'away' }} item
 */
export function breakLabel(item) {
  if (!item.endedAt) return 'On break now';
  return item.source === 'away' ? 'Away, removed from timer' : 'Break';
}

/**
 * What follows the label: "Changed by Neha Kapoor" after an HR fix, else how the break ended
 * ("Ended at check-out", "Ended when a timer started", "Closed at midnight"), else null.
 * @param {{ endReason?: string | null, changedById?: number | null }} item
 * @param {string | null} [changedByName]
 */
export function breakNote(item, changedByName = null) {
  if (item.changedById && changedByName) return `Changed by ${changedByName}`;
  return NOTES[item.endReason] ?? null;
}

const clockOf = (at, tz) => toLocal(at, tz).format('HH:mm');
const iso = (value) => (value ? dayjs(value).toISOString() : null);

/**
 * One BreakDetail as a row of the break list.
 * @param {{ id: number, startedAt: Date, endedAt: Date | null, endReason: string | null,
 *   source?: string, changedById?: number | null }} item
 * @param {{ tz: string, at: Date | import('dayjs').Dayjs,
 *   changedBy?: { id: number, name: string } | null }} ctx at: now (an open break counts to it)
 * @returns {{ id, startedAt, endedAt, startClock, endClock, minutes, open, source, endReason,
 *   label, note, changedBy }} ISO times, 'HH:mm' clocks in company time
 */
export function toBreakView(item, { tz, at, changedBy = null }) {
  const open = !item.endedAt;
  return {
    id: Number(item.id),
    startedAt: iso(item.startedAt),
    endedAt: iso(item.endedAt),
    startClock: clockOf(item.startedAt, tz),
    endClock: open ? null : clockOf(item.endedAt, tz),
    minutes: minutesBetween(item.startedAt, item.endedAt ?? at),
    open,
    source: item.source ?? 'self',
    endReason: item.endReason ?? null,
    label: breakLabel(item),
    note: breakNote(item, changedBy?.name ?? null),
    changedBy: item.changedById && changedBy ? { id: changedBy.id, name: changedBy.name } : null,
  };
}

/**
 * Two clocks as words for a message: "2:00 to 2:15 PM", or "11:50 AM to 12:10 PM" across noon
 * ("to" rather than the dash, which screen readers read badly).
 * @param {string} fromClock 'HH:mm'
 * @param {string} toClock 'HH:mm'
 */
export function clockWords(fromClock, toClock) {
  const from = formatClock(fromClock);
  const to = formatClock(toClock);
  const short = from.slice(-2) === to.slice(-2) ? formatClockShort(fromClock) : from;
  return `${short} to ${to}`;
}

/**
 * The break list's description: "Thu, 19 Nov · On break since 1:10 · Breaks 1h 5m · Over 5m"
 * (the break part only when there is a break, "Over" only when over the allowance).
 * @param {{ dayLabel: string, sinceClock?: string | null, breakMinutes: number,
 *   overAllowanceMinutes: number, count: number }} input sinceClock: 'h:mm' of the open break
 */
export function breakListDescription({
  dayLabel,
  sinceClock,
  breakMinutes,
  overAllowanceMinutes,
  count,
}) {
  const parts = [dayLabel];
  if (sinceClock) parts.push(`On break since ${sinceClock}`);
  if (count > 0) parts.push(`Breaks ${formatDuration(breakMinutes)}`);
  if (overAllowanceMinutes > 0) parts.push(`Over ${formatDuration(overAllowanceMinutes)}`);
  return parts.join(' · ');
}
