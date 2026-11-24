// Checks across several settings, made on the values after a save (CONTRACT 19, 25 and 27). Each
// one runs only when one of its keys is sent, and throws VALIDATION_FAILED on the field to fix.
// Re-exported from schemas.js.
import { validationError } from '@/lib/errors';
import { clockToMinutes, formatClockShort } from '@/lib/time';

const AUTO_CHECKOUT_KEYS = ['autoCheckoutEnabled', 'autoCheckoutAt', 'officeEnd'];

/**
 * CONTRACT 19: while auto check-out is on, its time must be later than office end (the check
 * window runs from office end to it). Checked on the values after the save whenever one of the
 * three keys is sent.
 * @param {{ autoCheckoutEnabled: boolean, autoCheckoutAt: string, officeEnd: string }} current
 *   the stored settings
 * @param {object} parsed settingsUpdateSchema output (keys not sent are undefined)
 * @throws VALIDATION_FAILED on autoCheckoutAt ("Pick a time after office hours end.")
 */
export function checkAutoCheckout(current, parsed) {
  if (!AUTO_CHECKOUT_KEYS.some((key) => parsed[key] !== undefined)) return;
  const pick = (key) => parsed[key] ?? current[key];
  if (!pick('autoCheckoutEnabled')) return;
  if (clockToMinutes(pick('autoCheckoutAt')) > clockToMinutes(pick('officeEnd'))) return;
  const message = 'Pick a time after office hours end.';
  throw validationError({ autoCheckoutAt: message }, message);
}

/** The value after the save: the one sent, else the stored one. */
const after = (current, parsed) => (key) => parsed[key] ?? current[key];

const DAY_MARK_KEYS = ['halfDayUnderMinutes', 'shortDayUnderMinutes'];

/**
 * CONTRACT 25: while both marks are on (above 0), a half day must be shorter than a short day.
 * Checked on the values after the save whenever one of the two is sent.
 * @param {{ halfDayUnderMinutes: number, shortDayUnderMinutes: number }} current the stored
 *   settings
 * @param {object} parsed settingsUpdateSchema output (keys not sent are undefined)
 * @throws VALIDATION_FAILED on halfDayUnderMinutes ("Half day must be less than the short day
 *   time.")
 */
export function checkDayMarks(current, parsed) {
  if (!DAY_MARK_KEYS.some((key) => parsed[key] !== undefined)) return;
  const pick = after(current, parsed);
  const half = pick('halfDayUnderMinutes');
  const short = pick('shortDayUnderMinutes');
  if (half === 0 || short === 0 || half < short) return;
  const message = 'Half day must be less than the short day time.';
  throw validationError({ halfDayUnderMinutes: message }, message);
}

const HR_SUMMARY_KEYS = ['hrMorningSummary', 'hrSummaryAt', 'lateAfter', 'officeEnd'];

/**
 * CONTRACT 25: while the morning HR summary is on, it is sent at or after the late mark (an
 * earlier one would list everyone as not checked in) and before office hours end. Checked on the
 * values after the save whenever one of the four keys is sent.
 * @param {{ hrMorningSummary: boolean, hrSummaryAt: string, lateAfter: string,
 *   officeEnd: string }} current the stored settings
 * @param {object} parsed settingsUpdateSchema output (keys not sent are undefined)
 * @throws VALIDATION_FAILED on hrSummaryAt ("Pick a time at or after the late mark (9:30)." or
 *   "Pick a time before office hours end.")
 */
export function checkHrSummary(current, parsed) {
  if (!HR_SUMMARY_KEYS.some((key) => parsed[key] !== undefined)) return;
  const pick = after(current, parsed);
  if (!pick('hrMorningSummary')) return;
  const at = clockToMinutes(pick('hrSummaryAt'));
  let message = null;
  if (at < clockToMinutes(pick('lateAfter'))) {
    message = `Pick a time at or after the late mark (${formatClockShort(pick('lateAfter'))}).`;
  } else if (at >= clockToMinutes(pick('officeEnd'))) {
    message = 'Pick a time before office hours end.';
  }
  if (message) throw validationError({ hrSummaryAt: message }, message);
}

const FILE_KEYS = ['fileMaxMb', 'fileStorageLimitGb'];

/** The cross-check message of Settings → Files (CONTRACT 27). */
export const FILE_BIGGER_THAN_LIMIT = "The largest file can't be bigger than the storage limit.";

/**
 * CONTRACT 27: the largest file (MB) fits in the storage limit (GB, 1 GB = 1,024 MB). Checked on
 * the values after the save whenever one of the two keys is sent.
 * @param {{ fileMaxMb: number, fileStorageLimitGb: number }} current the stored settings
 * @param {object} parsed settingsUpdateSchema output (keys not sent are undefined)
 * @throws VALIDATION_FAILED on fileMaxMb ("The largest file can't be bigger than the storage
 *   limit.")
 */
export function checkFileLimits(current, parsed) {
  if (!FILE_KEYS.some((key) => parsed[key] !== undefined)) return;
  const pick = after(current, parsed);
  if (pick('fileMaxMb') <= pick('fileStorageLimitGb') * 1024) return;
  throw validationError({ fileMaxMb: FILE_BIGGER_THAN_LIMIT }, FILE_BIGGER_THAN_LIMIT);
}
