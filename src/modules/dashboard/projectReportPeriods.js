// Project report: the range (week, month, all time, custom) and the "Hours over time" buckets.
// A week shows its days; a month, or up to 16 weeks, shows weeks (Monday to Sunday, cut to the
// range); anything longer shows months.
import {
  addDays,
  addMonths,
  dayjs,
  eachDay,
  formatDayMonthShort,
  formatHours,
  monthOf,
  monthRange,
  weekRange,
} from '@/lib/time';

/** '30 Sep', or '30 Sep 2025' outside the current year. */
export function shortDate(date, today) {
  return date.slice(0, 4) === today.slice(0, 4)
    ? formatDayMonthShort(date)
    : dayjs(date, 'YYYY-MM-DD').format('D MMM YYYY');
}

/**
 * The range the report covers. week = Monday to Sunday of this week, month = this calendar month,
 * custom = from..to, all = the first report on the project (or the day it was created) to today.
 * `end` is the last day that can have data (never after today).
 * @param {{ range?: 'week'|'month'|'all'|'custom', from?: string, to?: string }} options
 * @param {{ today: string, firstOn?: string|null, createdOn?: string|null }} known
 */
export function projectReportPeriod(
  { range = 'all', from, to } = {},
  { today, firstOn, createdOn },
) {
  let period;
  if (range === 'week') {
    period = { key: 'week', ...weekRange(today), label: 'This week', sub: 'this week' };
  } else if (range === 'month') {
    period = {
      key: 'month',
      ...monthRange(monthOf(today)),
      label: 'This month',
      sub: 'this month',
    };
  } else if (range === 'custom' && from && to && from <= to) {
    const label = `${shortDate(from, today)} to ${shortDate(to, today)}`;
    period = { key: 'custom', from, to, label, sub: label };
  } else {
    const start = [firstOn ?? createdOn ?? today, today].sort()[0];
    period = {
      key: 'all',
      from: start,
      to: today,
      label: 'All time',
      sub: firstOn ? `since ${shortDate(firstOn, today)}` : 'all time',
    };
  }
  // How empty states end: 'No hours yet' for all time, 'No hours in this range' otherwise.
  const when = period.key === 'all' ? 'yet' : 'in this range';
  return { ...period, when, end: period.to < today ? period.to : today };
}

const DAYS_UP_TO = 14;
const WEEKS_UP_TO = 16;
const DATE = 'YYYY-MM-DD';

const later = (a, b) => (a > b ? a : b);
const earlier = (a, b) => (a < b ? a : b);
const spanDays = (from, to) => dayjs(to, DATE).diff(dayjs(from, DATE), 'day') + 1;

function dayBuckets(period) {
  return eachDay(period.from, period.to).map((date) => ({
    key: date,
    label: period.key === 'week' ? dayjs(date, DATE).format('ddd') : formatDayMonthShort(date),
    from: date,
    to: date,
  }));
}

function weekBuckets(period) {
  const buckets = [];
  for (let start = weekRange(period.from).from; start <= period.to; start = addDays(start, 7)) {
    const from = later(start, period.from);
    buckets.push({
      key: start,
      label: formatDayMonthShort(from),
      from,
      to: earlier(addDays(start, 6), period.to),
    });
  }
  return buckets;
}

function monthBuckets(period) {
  const buckets = [];
  const years = period.from.slice(0, 4) !== period.to.slice(0, 4);
  for (let month = monthOf(period.from); month <= monthOf(period.to); month = addMonths(month, 1)) {
    const days = monthRange(month);
    buckets.push({
      key: month,
      label: dayjs(days.from, DATE).format(years ? "MMM 'YY" : 'MMM'),
      from: later(days.from, period.from),
      to: earlier(days.to, period.to),
    });
  }
  return buckets;
}

/** 'day', 'week' or 'month' for a period. */
export function bucketUnit(period) {
  const days = spanDays(period.from, period.to);
  if (period.key === 'week' || days <= DAYS_UP_TO) return 'day';
  if (period.key === 'month' || days <= WEEKS_UP_TO * 7) return 'week';
  return 'month';
}

/**
 * Minutes per bucket from the range's entries. `current` marks the bucket with today in it;
 * `future` buckets start after today (drawn as empty tracks).
 * @param {{ key: string, from: string, to: string }} period
 * @param {{ workDate: string, minutes: number }[]} entryRows
 * @param {string} today
 * @returns {{ unit: 'day'|'week'|'month', buckets: { key, label, from, to, minutes, display,
 *   current, future }[] }}
 */
export function projectReportBuckets(period, entryRows, today) {
  const unit = bucketUnit(period);
  const shapes =
    unit === 'day'
      ? dayBuckets(period)
      : unit === 'week'
        ? weekBuckets(period)
        : monthBuckets(period);
  const byDay = new Map();
  for (const row of entryRows) {
    byDay.set(row.workDate, (byDay.get(row.workDate) ?? 0) + Number(row.minutes));
  }
  const buckets = shapes.map((bucket) => {
    let minutes = 0;
    for (const [date, value] of byDay) {
      if (date >= bucket.from && date <= bucket.to) minutes += value;
    }
    return {
      ...bucket,
      minutes,
      display: minutes ? formatHours(minutes) : null,
      current: bucket.from <= today && today <= bucket.to,
      future: bucket.from > today,
    };
  });
  return { unit, buckets };
}
