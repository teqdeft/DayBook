// The payroll month (CONTRACT 25, item 4): the period HR pays by. Start day 1 is the calendar
// month; start day 26 runs from the 26th to the 25th of the next month and is named after the
// month it ends in ("November 2026" = 26 Oct to 25 Nov 2026). Its key is that month, 'YYYY-MM'.
// Pure: no database.
import {
  addDays,
  addMonths,
  formatDayMonthShort,
  formatMonth,
  monthOf,
  monthRange,
  workDate as localDate,
} from '@/lib/time';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIRST_MONTH = '2020-01';
const DEFAULT_GRACE_DAYS = 3; // the first 3 days of a period open the one that just closed

/** A start day from 1 to 28 (anything else reads as 1). */
function startDayOf(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1;
}

/**
 * The dates of a payroll month.
 * @param {string} month 'YYYY-MM', the month the period ends in
 * @param {number} startDay 1 to 28 (payroll_month_start_day)
 * @returns {{ month: string, from: string, to: string, label: string,
 *   rangeLabel: string | null }} label "November 2026"; rangeLabel "26 Oct to 25 Nov" (null for
 *   calendar months)
 */
export function payrollPeriod(month, startDay) {
  const start = startDayOf(startDay);
  const label = formatMonth(month);
  if (start === 1) return { month, ...monthRange(month), label, rangeLabel: null };
  const pad = String(start).padStart(2, '0');
  const from = `${addMonths(month, -1)}-${pad}`;
  const to = addDays(`${month}-${pad}`, -1);
  const rangeLabel = `${formatDayMonthShort(from)} to ${formatDayMonthShort(to)}`;
  return { month, from, to, label, rangeLabel };
}

/**
 * The payroll month a date belongs to: its calendar month with start day 1, else the next month
 * from the start day on (25 Nov 2026 → '2026-11', 26 Nov 2026 → '2026-12' with start day 26).
 * @param {string} date 'YYYY-MM-DD'
 * @param {number} startDay
 * @returns {string} 'YYYY-MM'
 */
export function payrollMonthOf(date, startDay) {
  const start = startDayOf(startDay);
  const month = monthOf(date);
  if (start === 1) return month;
  return Number(date.slice(8, 10)) >= start ? addMonths(month, 1) : month;
}

/**
 * The payroll month a screen asks for (`?month=`): the asked month, or the current one when it
 * isn't 'YYYY-MM' or is after the current one (like resolveDate); months before 2020-01 read as
 * 2020-01. Without a month, while today is within the first 3 days of a new period, it answers
 * the previous payroll month (`defaulted: 'previous'`), so the month screens open the period that
 * just closed and the next arrow leads to the current one.
 * @param {string | null | undefined} month
 * @param {{ payrollMonthStartDay?: number, timezone: string }} settings
 * @param {{ today?: string }} [options] today's company date (default now)
 * @returns {{ month: string, from: string, to: string, label: string, rangeLabel: string | null,
 *   startDay: number, isCurrent: boolean, current: string, prevMonth: string | null,
 *   nextMonth: string | null, defaulted: 'previous' | null }}
 */
export function resolvePayrollMonth(month, settings, { today } = {}) {
  const startDay = startDayOf(settings.payrollMonthStartDay);
  const date = today ?? localDate(settings.timezone);
  const current = payrollMonthOf(date, startDay);
  let chosen = current;
  let defaulted = null;
  if (typeof month === 'string' && MONTH_RE.test(month)) {
    chosen = month > current ? current : month < FIRST_MONTH ? FIRST_MONTH : month;
  } else if (month === undefined || month === null || month === '') {
    const opened = payrollPeriod(current, startDay).from;
    if (date < addDays(opened, DEFAULT_GRACE_DAYS) && current > FIRST_MONTH) {
      chosen = addMonths(current, -1);
      defaulted = 'previous';
    }
  }
  return {
    ...payrollPeriod(chosen, startDay),
    startDay,
    isCurrent: chosen === current,
    current,
    prevMonth: chosen > FIRST_MONTH ? addMonths(chosen, -1) : null,
    nextMonth: chosen < current ? addMonths(chosen, 1) : null,
    defaulted,
  };
}
