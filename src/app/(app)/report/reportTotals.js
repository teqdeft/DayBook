// Pure texts comparing logged hours with the day's attendance (browser side): the top bar's
// "of 8h 58m checked in" line and the gap notice. With breaks that day the comparison uses worked
// time (present time minus breaks, CONTRACT 15): "of 7h 45m worked".
import { formatDuration, formatHours } from '@/lib/time';

/** Worked minutes when breaks made them less than present minutes, else null. */
function workedAfterBreaks(data) {
  const present = data.presentMinutes;
  const worked = data.workedMinutes;
  if (present === null || present === undefined) return null;
  if (worked === null || worked === undefined || worked >= present) return null;
  return worked;
}

/**
 * The line under "8h logged": 'of 8h 58m checked in', 'of 7h 45m worked' (after breaks),
 * 'not checked in yet' / 'not checked in', or null for someone who doesn't check in.
 * @param {{ tracksAttendance: boolean, isToday: boolean, presentMinutes: number | null,
 *   workedMinutes?: number | null }} data
 * @returns {string | null}
 */
export function presentLine(data) {
  if (!data.tracksAttendance && data.presentMinutes === null) return null;
  if (data.presentMinutes === null) return data.isToday ? 'not checked in yet' : 'not checked in';
  const worked = workedAfterBreaks(data);
  if (worked !== null) return `of ${formatDuration(worked)} worked`;
  return `of ${formatDuration(data.presentMinutes)} checked in`;
}

/**
 * The gap warning when logged hours and the day's time differ by more than gapWarningMinutes:
 * against worked time after breaks ("You logged 8h but worked 7h 15m."), else against present
 * time ("You logged 8h but were checked in for only 6h 30m."). Null without a check-in or hours.
 * @param {{ presentMinutes: number | null, workedMinutes?: number | null,
 *   gapWarningMinutes: number }} data
 * @param {number} logged logged minutes
 * @param {'draft' | 'submitted' | string} status
 * @returns {string | null}
 */
export function gapText(data, logged, status) {
  const present = data.presentMinutes;
  if (present === null || present === undefined || logged <= 0) return null;
  const step = status === 'submitted' ? 'update the report' : 'submit';
  const worked = workedAfterBreaks(data);
  if (worked !== null) {
    if (Math.abs(worked - logged) <= data.gapWarningMinutes) return null;
    return (
      `You logged ${formatHours(logged)} but worked ${formatDuration(worked)}. ` +
      `Check your hours before you ${step}.`
    );
  }
  if (Math.abs(present - logged) <= data.gapWarningMinutes) return null;
  const more = logged > present;
  return (
    `You logged ${formatHours(logged)} but were checked in for ${more ? 'only ' : ''}` +
    `${formatDuration(present)}. Check your hours before you ${step}.`
  );
}
