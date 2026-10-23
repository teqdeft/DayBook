// The report's hours boxes (browser side, pure): time to the minute (company request: "8h 30m",
// not "8.5" or 0.25-hour steps). A box shows '2h 15m' and reads every form parseDuration takes
// ('2h 15m', '2:15', '2.25', ...); saves send whole minutes.
import { formatDuration, parseDuration } from '@/lib/time';

export const HOURS_MAX = 24;
const MAX_MINUTES = HOURS_MAX * 60;
/** Under an hours box that can't be read. */
export const TIME_FORMAT_ERROR = 'Enter time like 2h 15m';

/**
 * Time as typed ('2h 15m', '2:15', '2.25', '2,25', '') -> { minutes } or { error }, to the
 * minute (parseDuration). '' counts as 0 while drafting. Decimals off the 0.25-hour steps are an
 * error ('8.30' may mean 8h 30m), so they are never saved as something else.
 * @returns {{ minutes: number } | { error: string }}
 */
export function parseHours(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { minutes: 0 };
  const minutes = parseDuration(raw, { max: Infinity });
  if (minutes === null) return { error: TIME_FORMAT_ERROR };
  if (minutes > MAX_MINUTES) return { error: `Hours must be ${HOURS_MAX} or less.` };
  return { minutes };
}

/** What an hours box shows for minutes: 135 -> '2h 15m', 120 -> '2h', 0 -> '' (a 0h placeholder). */
export function timeText(minutes) {
  const value = Math.round(Number(minutes) || 0);
  return value <= 0 ? '' : formatDuration(value);
}

/** The box's text once the person leaves it: valid time as '2h 15m' ('2.25', '2:15'), else as is. */
export function normalizeHours(text) {
  const parsed = parseHours(text);
  return 'minutes' in parsed ? timeText(parsed.minutes) : text;
}

/** The last valid minutes of a row (a backup kept by an older page has savedHours instead). */
function lastValidMinutes(entry) {
  if (Number.isFinite(entry.savedMinutes)) return entry.savedMinutes;
  return Math.round((Number(entry.savedHours) || 0) * 60);
}

/**
 * The minutes an entry counts as in the totals and the Slack preview: what is typed when valid,
 * else the last valid value.
 */
export function entryMinutes(entry) {
  const parsed = parseHours(entry.hours);
  return 'minutes' in parsed ? parsed.minutes : lastValidMinutes(entry);
}

/**
 * The time a save sends: `{ minutes }` when the box is valid, else `{ hours }` with the text
 * exactly as shown, so the server refuses it under that field instead of quietly saving an older
 * value. Only the keepalive save on leaving the page (`keepLastValid`) falls back to the last
 * valid minutes, so the rest of a draft still saves when the person leaves with a box still wrong.
 * @returns {{ minutes: number } | { hours: string }}
 */
export function timeToSend(entry, { keepLastValid = false } = {}) {
  const parsed = parseHours(entry.hours);
  if ('minutes' in parsed) return { minutes: parsed.minutes };
  if (keepLastValid) return { minutes: lastValidMinutes(entry) };
  return { hours: String(entry.hours ?? '').trim() };
}

/** The first hours box a save can't accept, or null: { entryKey, message }. */
export function firstHoursError(entries) {
  for (const entry of entries) {
    const parsed = parseHours(entry.hours);
    if ('error' in parsed) return { entryKey: entry.key, message: parsed.error };
  }
  return null;
}

/** The minutes of every card together ("8h 30m logged", the gap notice). */
export function totalMinutes(entries) {
  return entries.reduce((sum, entry) => sum + entryMinutes(entry), 0);
}
