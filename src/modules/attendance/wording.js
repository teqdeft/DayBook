// Sentences about correction requests: the second line of HR's cards and what the person is told.
import { formatDayShort, formatTime, formatTimeAmPm } from '@/lib/time';

/**
 * The second line of a correction card: what the person says happened.
 * "Says they left at 6:40 PM on Tue, 29 Sep." / "Says they arrived at 9:35 but checked in at
 * 10:08." / "Says they were in the office from 9:30 to 6:30 PM on Mon, 28 Sep."
 */
export function describeCorrection(correction, row, tz) {
  const day = formatDayShort(correction.workDate);
  if (correction.type === 'check_out') {
    return `Says they left at ${formatTimeAmPm(correction.requestedTime, tz)} on ${day}.`;
  }
  if (correction.type === 'check_in') {
    const arrived = formatTime(correction.requestedTime, tz);
    return row?.checkInAt
      ? `Says they arrived at ${arrived} but checked in at ${formatTime(row.checkInAt, tz)}.`
      : `Says they arrived at ${arrived} on ${day}.`;
  }
  const where = correction.requestedLocation === 'wfh' ? 'working from home' : 'in the office';
  return `Says they were ${where} from ${formatTime(correction.requestedTime, tz)} to ${formatTimeAmPm(correction.requestedEndTime, tz)} on ${day}.`;
}

/** What changed, for the person whose correction was approved. */
export function approvedDetail(correction, tz) {
  const day = formatDayShort(correction.workDate);
  if (correction.type === 'check_in') {
    return `Your check-in on ${day} is now ${formatTime(correction.requestedTime, tz)}.`;
  }
  if (correction.type === 'check_out') {
    return `Your check-out on ${day} is now ${formatTimeAmPm(correction.requestedTime, tz)}.`;
  }
  const where = correction.requestedLocation === 'wfh' ? 'working from home' : 'in the office';
  return `${day} is saved: ${formatTime(correction.requestedTime, tz)} to ${formatTimeAmPm(correction.requestedEndTime, tz)}, ${where}.`;
}
