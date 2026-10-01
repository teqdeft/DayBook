// Option lists for the Settings selects: time zones with friendly labels ("India (IST,
// UTC+5:30)") and when reports lock. Built on the server (full ICU time zone data).
import { formatClock } from '@/lib/time';

// Zones an Indian agency and its clients use. `abbr` is fixed for zones without daylight saving;
// the others read it from Intl in a locale that names it ("BST", "EDT").
const ZONES = [
  { value: 'Asia/Kolkata', place: 'India', abbr: 'IST' },
  { value: 'Asia/Dubai', place: 'UAE', abbr: 'GST' },
  { value: 'Asia/Riyadh', place: 'Saudi Arabia', abbr: 'AST' },
  { value: 'Asia/Singapore', place: 'Singapore', abbr: 'SGT' },
  { value: 'Asia/Tokyo', place: 'Japan', abbr: 'JST' },
  { value: 'Australia/Sydney', place: 'Australia (Sydney)', locale: 'en-AU' },
  { value: 'Europe/London', place: 'United Kingdom', locale: 'en-GB' },
  { value: 'Europe/Berlin', place: 'Central Europe', locale: 'en-GB' },
  { value: 'America/New_York', place: 'US Eastern', locale: 'en-US' },
  { value: 'America/Chicago', place: 'US Central', locale: 'en-US' },
  { value: 'America/Denver', place: 'US Mountain', locale: 'en-US' },
  { value: 'America/Los_Angeles', place: 'US Pacific', locale: 'en-US' },
  { value: 'UTC', place: 'Coordinated Universal Time', abbr: 'UTC' },
];

function zonePart(timeZone, locale, style, at) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(
      at,
    );
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

/** 'GMT+5:30' -> 'UTC+5:30', 'GMT-4' -> 'UTC-4:00', 'GMT' -> 'UTC+0:00' */
function utcOffset(timeZone, at) {
  const raw = zonePart(timeZone, 'en-US', 'shortOffset', at) ?? 'GMT';
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(raw);
  if (!match || !match[1]) return 'UTC+0:00';
  return `UTC${match[1]}${Number(match[2])}:${match[3] ?? '00'}`;
}

/**
 * Time zone options with the offset in effect at `at`. The saved zone is always included.
 * @param {string} current the saved time zone
 * @param {Date} at usually nowDate()
 * @returns {Array<{ value: string, label: string }>}
 */
export function timezoneOptions(current, at) {
  const options = ZONES.map((zone) => {
    const abbr = zone.abbr ?? zonePart(zone.value, zone.locale, 'short', at);
    const offset = utcOffset(zone.value, at);
    const named = abbr && !/^(GMT|UTC)[+-]/.test(abbr) && abbr !== offset;
    return {
      value: zone.value,
      label:
        zone.value === 'UTC'
          ? `UTC (UTC+0:00)`
          : `${zone.place} (${named ? `${abbr}, ` : ''}${offset})`,
    };
  });
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: `${current} (${utcOffset(current, at)})` });
  }
  return options;
}

const LOCKS = [
  'same_day_23:59',
  'next_day_10:00',
  'next_day_12:00',
  'next_day_15:00',
  'next_day_18:00',
  'next_day_23:59',
];

/** 'next_day_12:00' -> 'Next day at 12:00 PM' */
export function reportLockLabel(value) {
  const match = /^(same|next)_day_(\d{2}:\d{2})$/.exec(value ?? '');
  if (!match) return String(value ?? '');
  return `${match[1] === 'same' ? 'Same day' : 'Next day'} at ${formatClock(match[2])}`;
}

/**
 * "Reports lock" options; the saved value is always included.
 * @returns {Array<{ value: string, label: string }>}
 */
export function reportLockOptions(current) {
  const values = LOCKS.includes(current) || !current ? LOCKS : [...LOCKS, current];
  return values.map((value) => ({ value, label: reportLockLabel(value) }));
}
