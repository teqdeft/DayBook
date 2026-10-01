// Company time zone helpers. All date and time work goes through here; modules and components
// never call `new Date()` themselves. Timestamps are UTC; `work_date` values are 'YYYY-MM-DD'
// strings in the company time zone. Pass the time zone from settings (settings.timezone).
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export { dayjs };

const DATE = 'YYYY-MM-DD';
let fixedNow = null;

/** Current moment as a UTC dayjs. Tests can pin it with setNowForTests(). */
export function now() {
  return fixedNow ? fixedNow : dayjs.utc();
}

/** Current moment as a JS Date (for DATETIME columns). */
export function nowDate() {
  return now().toDate();
}

/** Pins "now" for tests. Pass null to go back to the real clock. */
export function setNowForTests(value) {
  fixedNow = value ? dayjs.utc(value) : null;
}

/** A moment converted to the company time zone. */
export function toLocal(at, tz) {
  return dayjs(at).tz(tz);
}

/** The local calendar date ('YYYY-MM-DD') of a moment (default now) in the company time zone. */
export function workDate(tz, at) {
  return toLocal(at ?? now(), tz).format(DATE);
}

/** '09:30:00' or '9:30' -> '09:30' */
export function normalizeClock(value) {
  const [h = '0', m = '0'] = String(value).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** Minutes after midnight for a clock string like '09:30'. */
export function clockToMinutes(value) {
  const [h, m] = normalizeClock(value).split(':').map(Number);
  return h * 60 + m;
}

/** A local date and clock time in the company time zone, as a UTC dayjs. */
export function localToUtc(date, clock, tz) {
  return dayjs.tz(`${date} ${normalizeClock(clock)}`, 'YYYY-MM-DD HH:mm', tz).utc();
}

/** ISO weekday of a 'YYYY-MM-DD' date: Monday = 1 ... Sunday = 7. */
export function isoWeekday(date) {
  const day = dayjs(date, DATE).day();
  return day === 0 ? 7 : day;
}

/** True when the date's weekday is one of the working days (Monday = 1). */
export function isWorkingDay(date, workingDays) {
  return workingDays.includes(isoWeekday(date));
}

export function addDays(date, days) {
  return dayjs(date, DATE).add(days, 'day').format(DATE);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from, to) {
  const days = [];
  for (let d = dayjs(from, DATE); !d.isAfter(dayjs(to, DATE)); d = d.add(1, 'day')) {
    days.push(d.format(DATE));
  }
  return days;
}

/** Working days after `from` up to and including `to`. */
export function workingDaysBetween(from, to, workingDays) {
  if (!dayjs(to, DATE).isAfter(dayjs(from, DATE))) return 0;
  return eachDay(addDays(from, 1), to).filter((d) => isWorkingDay(d, workingDays)).length;
}

/** Monday to Sunday of the week that contains `date`. */
export function weekRange(date) {
  const from = addDays(date, 1 - isoWeekday(date));
  return { from, to: addDays(from, 6) };
}

/** First and last day of a 'YYYY-MM' month. */
export function monthRange(month) {
  const start = dayjs(`${month}-01`, DATE);
  return { from: start.format(DATE), to: start.endOf('month').format(DATE) };
}

export function monthOf(date) {
  return String(date).slice(0, 7);
}

export function addMonths(month, count) {
  return dayjs(`${month}-01`, DATE).add(count, 'month').format('YYYY-MM');
}

/**
 * Late minutes for a check-in: whole minutes after `lateAfter` (or the person's own shift start)
 * on a working day, otherwise 0.
 */
export function lateMinutesFor({ checkInAt, date, lateAfter, tz, workingDays }) {
  if (workingDays && !isWorkingDay(date, workingDays)) return 0;
  const threshold = localToUtc(date, lateAfter, tz);
  const diff = Math.floor(dayjs(checkInAt).diff(threshold, 'second') / 60);
  return diff > 0 ? diff : 0;
}

/**
 * When a report for `date` locks, from the report_lock setting ('next_day_12:00' or 'same_day_23:59').
 * @returns {Date} UTC
 */
export function locksAtFor(date, reportLock, tz) {
  const match = /^(same|next)_day_(\d{1,2}:\d{2})$/.exec(reportLock ?? '') ?? ['', 'next', '12:00'];
  const day = match[1] === 'next' ? addDays(date, 1) : date;
  return localToUtc(day, match[2], tz).toDate();
}

/** Whole minutes between two moments (b - a), never negative. */
export function minutesBetween(a, b) {
  const diff = Math.floor(dayjs(b).diff(dayjs(a), 'second') / 60);
  return diff > 0 ? diff : 0;
}

// ---------- Formatting (copy rules from the build guide, section 13.2) ----------

/** 'Wednesday, 30 September' */
export function formatDay(date) {
  return dayjs(date, DATE).format('dddd, D MMMM');
}

/** 'Wed, 30 Sep' */
export function formatDayShort(date) {
  return dayjs(date, DATE).format('ddd, D MMM');
}

/** '30 September' */
export function formatDayMonth(date) {
  return dayjs(date, DATE).format('D MMMM');
}

/** '30 Sep' */
export function formatDayMonthShort(date) {
  return dayjs(date, DATE).format('D MMM');
}

/** 'Friday' */
export function formatWeekday(date) {
  return dayjs(date, DATE).format('dddd');
}

/** 'September 2026' */
export function formatMonth(month) {
  return dayjs(`${month}-01`, DATE).format('MMMM YYYY');
}

/** '12 March 2024' */
export function formatDateLong(date) {
  return dayjs(date, DATE).format('D MMMM YYYY');
}

/** '30-09-2026' (Slack report format and date inputs) */
export function formatDateDmy(date) {
  return dayjs(date, DATE).format('DD-MM-YYYY');
}

/** '9:32' for a moment, in tables. */
export function formatTime(at, tz) {
  return at ? toLocal(at, tz).format('h:mm') : null;
}

/** '6:30 PM' for a moment, in sentences. */
export function formatTimeAmPm(at, tz) {
  return at ? toLocal(at, tz).format('h:mm A') : null;
}

/** '18:30' -> '6:30 PM' */
export function formatClock(clock) {
  return dayjs(`2000-01-01 ${normalizeClock(clock)}`, 'YYYY-MM-DD HH:mm').format('h:mm A');
}

/** '18:30' -> '6:30' */
export function formatClockShort(clock) {
  return dayjs(`2000-01-01 ${normalizeClock(clock)}`, 'YYYY-MM-DD HH:mm').format('h:mm');
}

/** Rounds and drops trailing zeros: 2 -> '2', 1.5 -> '1.5', 0.25 -> '0.25'. */
export function trimNumber(value, decimals = 2) {
  return String(Number(Number(value).toFixed(decimals)));
}

/** Minutes as hours without trailing zeros, for Slack and inputs: 90 -> '1.5'. */
export function minutesToHours(minutes) {
  return trimNumber((minutes ?? 0) / 60, 2);
}

/** Logged hours: 480 -> '8h', 510 -> '8.5h'. */
export function formatHours(minutes, decimals = 2) {
  return `${trimNumber((minutes ?? 0) / 60, decimals)}h`;
}

/** Present time: 495 -> '8h 15m', 480 -> '8h', 38 -> '38m', 0 -> '0h'. */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0 && m === 0) return '0h';
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * 'Today', 'Yesterday', a weekday name within the last week, otherwise '22 September'.
 */
export function formatRelativeDay(date, today) {
  if (!date) return null;
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const diff = dayjs(today, DATE).diff(dayjs(date, DATE), 'day');
  if (diff > 0 && diff < 7) return formatWeekday(date);
  return formatDayMonth(date);
}

/** 'Good morning' / 'Good afternoon' / 'Good evening' for the local time. */
export function greeting(tz, at) {
  const hour = toLocal(at ?? now(), tz).hour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
