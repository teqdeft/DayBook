// Words the month view and the person month share (CONTRACT 25, items 4 and 8): the payroll
// month's subtitle, its DateSwitcher and the notice before migration 018. Pure.
import { dayjs, formatMonth } from '@/lib/time';

/** The muted notice before migration 018 (Deploy before migrate). */
export const UPDATE_NOTICE =
  "Holidays and leave aren't counted yet. This needs the latest database update. Ask an Admin.";

/**
 * "November 2026 so far", "November 2026", "November 2026 so far, 26 Oct to 25 Nov".
 * @param {{ label: string, rangeLabel: string | null, isCurrent: boolean }} period
 */
export function subtitleOf(period) {
  const soFar = period.isCurrent ? ' so far' : '';
  return `${period.label}${soFar}${period.rangeLabel ? `, ${period.rangeLabel}` : ''}`;
}

/**
 * The payroll month's DateSwitcher: "This month", "Last month" (opened the period that just
 * closed) or "Oct 2026"; the arrows name the months ("October 2026", "No later months").
 * @param {{ month: string, isCurrent: boolean, defaulted: string | null,
 *   prevMonth: string | null, nextMonth: string | null }} period
 * @param {(month: string) => string} hrefFor
 */
export function switcherOf(period, hrefFor) {
  let label = dayjs(`${period.month}-01`, 'YYYY-MM-DD').format('MMM YYYY');
  if (period.isCurrent) label = 'This month';
  if (period.defaulted === 'previous') label = 'Last month';
  return {
    label,
    prevHref: period.prevMonth ? hrefFor(period.prevMonth) : undefined,
    prevLabel: period.prevMonth ? formatMonth(period.prevMonth) : 'No earlier months',
    nextHref: period.nextMonth ? hrefFor(period.nextMonth) : undefined,
    nextLabel: period.nextMonth ? formatMonth(period.nextMonth) : 'No later months',
  };
}
