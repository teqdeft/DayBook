// Loads and shapes the Leave page (CONTRACT 25, item 9). Server only (called from page.js): the
// payroll month asked for (from January of last year to December of next year; none = the month
// screens' default), its leave entries 50 a page, the Person filter and the people HR may mark
// leave for, and the date switcher's labels (the month page's: "This month", "Last month",
// "Oct 2026").
import { plural } from '@/lib/text';
import {
  addMonths,
  dayjs,
  formatDayMonthShort,
  formatMonth,
  trimNumber,
  workDate as localDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';

export const PAGE_SIZE = 50;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "5 people, 7.5 working days", "1 person, 0.5 day", "No leave". */
function subtitleOf(summary) {
  if (!summary.people) return 'No leave';
  const people = `${summary.people} ${plural(summary.people, 'person', 'people')}`;
  const days = summary.workingDays;
  const one = days === 1 || days === 0.5;
  const count = `${trimNumber(days)} ${one ? 'day' : 'working days'}`;
  return `${people}, ${count}`;
}

/** The month shown: the asked one inside the window, else the month screens' default. */
function monthShown(asked, current, today) {
  const year = Number(today.slice(0, 4));
  const first = `${year - 1}-01`;
  const last = `${year + 1}-12`;
  const fallback = attendance.resolvePayrollMonth(undefined, current, { today });
  if (typeof asked !== 'string' || !MONTH_RE.test(asked)) return { ...fallback, first, last };
  const month = asked < first ? first : asked > last ? last : asked;
  return {
    ...attendance.payrollPeriod(month, current.payrollMonthStartDay),
    current: fallback.current,
    defaulted: null,
    first,
    last,
  };
}

/**
 * The switcher: "This month", "Last month" (the default on a period's first days), "Oct 2026".
 * Its links keep the Person filter (?userId=), as the filter and the pager do.
 */
function switcherOf(period, userId) {
  const href = (month) => {
    const query = new URLSearchParams({ month });
    if (userId) query.set('userId', String(userId));
    return `/attendance/leave?${query}`;
  };
  const prev = period.month > period.first ? addMonths(period.month, -1) : null;
  const next = period.month < period.last ? addMonths(period.month, 1) : null;
  let label = dayjs(`${period.month}-01`).format('MMM YYYY');
  if (period.month === period.current) label = 'This month';
  else if (period.defaulted === 'previous') label = 'Last month';
  return {
    label,
    prevHref: prev ? href(prev) : undefined,
    prevLabel: prev ? formatMonth(prev) : 'No earlier months',
    nextHref: next ? href(next) : undefined,
    nextLabel: next ? formatMonth(next) : 'No later months',
  };
}

/** "Neha Kapoor, 12 Nov" (who marked it, on which company day). */
function markedBy(entry, tz) {
  if (!entry.createdBy) return '—';
  const day = formatDayMonthShort(localDate(tz, entry.createdAt));
  return `${entry.createdBy.name ?? 'Someone'}, ${day}`;
}

/**
 * @param {{ user: object, month?: string, userId?: string, page?: string }} input from the URL
 */
export async function loadLeave({ user, month, userId, page }) {
  const current = await settings.getAll();
  const today = localDate(current.timezone);
  const period = monthShown(month, current, today);
  const person = /^\d+$/.test(String(userId ?? '')) ? Number(userId) : undefined;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const [list, people] = await Promise.all([
    attendance.listLeave({
      viewer: user,
      month: period.month,
      userId: person,
      limit: PAGE_SIZE,
      offset: (pageNumber - 1) * PAGE_SIZE,
    }),
    attendance.listLeavePeople({ viewer: user, forChange: false }),
  ]);
  return {
    today,
    available: list.available,
    month: period.month,
    title: period.label,
    monthName: dayjs(`${period.month}-01`).format('MMMM'),
    rangeLabel: period.rangeLabel,
    subtitle: subtitleOf(list.summary),
    switcher: switcherOf(period, person),
    userId: person ?? null,
    people,
    markable: people.filter((item) => item.id !== user.id),
    viewerId: user.id,
    rows: list.items.map((entry) => ({ ...entry, markedBy: markedBy(entry, current.timezone) })),
    total: list.total,
    page: pageNumber,
    pageSize: PAGE_SIZE,
  };
}
