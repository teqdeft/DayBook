// Parsing and formatting of the time and date text people type into Settings and the People
// drawer. Pure functions, safe in Server and Client Components.
import { dayjs, formatClock } from '@/lib/time';

const CLOCK_TEXT = /^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i;

/**
 * '9:30 AM', '9:30am', '09:30', '17:30', '5 pm' -> '09:30' / '17:30'.
 * @returns {string | null | undefined} 'HH:mm'; null when empty; undefined when not a time
 */
export function parseClockText(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const match = CLOCK_TEXT.exec(value);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const meridiem = match[3]?.replace(/\./g, '').toLowerCase();
  if (minutes > 59) return undefined;
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return undefined;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** '09:30' -> '9:30 AM'; empty stays empty. */
export function clockText(clock) {
  return clock ? formatClock(clock) : '';
}

/** '09:30', '18:30' -> '9:30 AM to 6:30 PM' */
export function shiftText(start, end) {
  return start && end ? `${clockText(start)} to ${clockText(end)}` : '';
}

/**
 * '10:00 AM to 7:00 PM' (also '10:00 - 19:00') -> { start: '10:00', end: '19:00' }.
 * @returns {{ start: string, end: string } | null | undefined} null when empty, undefined when
 *   it can't be read
 */
export function parseShiftText(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const parts = value.split(/\s*(?:\bto\b|–|—|-)\s*/i).filter(Boolean);
  if (parts.length !== 2) return undefined;
  const start = parseClockText(parts[0]);
  const end = parseClockText(parts[1]);
  if (!start || !end) return undefined;
  return { start, end };
}

/** '2026-10-01' -> '01-10-2026' (the date format people type). */
export function dateText(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/**
 * '01-10-2026' (also '1/10/2026', '01.10.2026' or '2026-10-01') -> '2026-10-01'.
 * @returns {string | null | undefined} null when empty; undefined when not a real date
 */
export function parseDateText(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  let match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  let day;
  let month;
  let year;
  if (match) [, day, month, year] = match.map(Number);
  else {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!match) return undefined;
    [, year, month, day] = match.map(Number);
  }
  if (year < 1900 || year > 2200) return undefined;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return dayjs(iso, 'YYYY-MM-DD', true).isValid() ? iso : undefined;
}
