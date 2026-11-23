// Loads and shapes /attendance/missing (CONTRACT 25, item 7). Server only (called from page.js).
// Every row still to fix, 50 a page, newest day first; HR and Admins also get the suggested time,
// the pending check_out correction and the latest reminder of each row, which PMs never see.
import { can } from '@/lib/permissions';
import {
  dayjs,
  formatClock,
  formatDayShort,
  formatRelativeDay,
  formatTime,
  now,
  workDate as localDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import { clockValue } from '../rowActions';

export const PAGE_SIZE = 50;

/** "Yesterday" or "Monday" for the days of the past week, else nothing. */
function relativeOf(date, today) {
  const days = dayjs(today).diff(dayjs(date), 'day');
  return days >= 1 && days < 7 ? formatRelativeDay(date, today) : null;
}

/** When HR can remind again: 30 minutes after the last reminder, while that hasn't passed. */
function nextAtOf(reminded) {
  if (!reminded?.sentAt) return null;
  const every = attendance.REMIND_EVERY_MINUTES ?? 30;
  const next = dayjs(reminded.sentAt).add(every, 'minute');
  return next.isAfter(now()) ? next.toDate() : null;
}

/** One table row for MissingTable (serialisable: strings, numbers, Dates). */
function rowOf(item, { tz, today, canCorrect }) {
  const { user } = item;
  const suggestedClock = canCorrect ? clockValue(item.suggestedAt, tz) : null;
  const pending = canCorrect ? item.pendingCorrection : null;
  return {
    id: item.id,
    userId: item.userId,
    user: {
      id: user.id,
      name: user.name,
      initials: user.initials,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      status: user.status,
      designation: user.designation ?? null,
    },
    workDate: item.workDate,
    dayLabel: formatDayShort(item.workDate),
    relLabel: relativeOf(item.workDate, today),
    checkIn: clockValue(item.checkInAt, tz),
    checkInText: formatTime(item.checkInAt, tz),
    location: item.location,
    suggestedClock,
    suggestedText: suggestedClock ? formatClock(suggestedClock) : null,
    pendingText: pending?.checkOutClock
      ? `Asked HR for ${formatClock(pending.checkOutClock)}`
      : null,
    // ReminderNote (builder D) writes the time in the company time zone it carries.
    reminded: canCorrect && item.reminded ? { ...item.reminded, tz } : null,
    nextAt: canCorrect ? nextAtOf(item.reminded) : null,
    own: item.own,
    // The row's checkbox, input, Fix and Remind (HR and Admins, not their own, nothing pending).
    canAct: canCorrect && !item.own && !pending,
    isToday: item.workDate === today,
  };
}

/** "?page=2" links (the first page has none). */
function pageHref(page) {
  return page > 1 ? `/attendance/missing?page=${page}` : '/attendance/missing';
}

/**
 * @param {{ user: object, page?: string }} input page = the raw ?page= value
 * @returns {Promise<{ tz: string, today: string, canCorrect: boolean, total: number,
 *   rows: object[], pager: { first: number, last: number, total: number,
 *   prevHref: string | null, nextHref: string | null } }>}
 */
export async function loadMissing({ user, page: asked }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = localDate(tz);
  const canCorrect = can(user, 'attendance.correct');
  const read = (page) =>
    attendance.listMissingCheckouts({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      viewer: user,
      suggest: canCorrect,
    });
  let page = Math.max(1, Number.parseInt(asked, 10) || 1);
  let list = await read(page);
  // A page past the end (its rows were just fixed) shows the last page instead.
  if (list.items.length === 0 && list.total > 0) {
    page = Math.ceil(list.total / PAGE_SIZE);
    list = await read(page);
  }
  const first = list.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = (page - 1) * PAGE_SIZE + list.items.length;
  return {
    tz,
    today,
    canCorrect,
    total: list.total,
    rows: list.items.map((item) => rowOf(item, { tz, today, canCorrect })),
    pager: {
      first,
      last,
      total: list.total,
      prevHref: page > 1 ? pageHref(page - 1) : null,
      nextHref: last < list.total ? pageHref(page + 1) : null,
    },
  };
}
