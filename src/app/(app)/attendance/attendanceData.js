// Loads and shapes the Attendance page (artboard 09). Server only (called from page.js).
import { can } from '@/lib/permissions';
import {
  addDays,
  formatDayShort,
  formatDuration,
  formatRelativeDay,
  formatTime,
  toLocal,
  workDate as localDate,
} from '@/lib/time';
import { plural } from '@/lib/text';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';

export const FILTERS = ['all', 'late', 'wfh', 'not_checked_in', 'unverified'];

/** 'HH:mm' in company time for a time input, or null. */
function clockValue(at, tz) {
  return at ? toLocal(at, tz).format('HH:mm') : null;
}

function actionFor(item, { date, today, dayLabel, tz }) {
  const base = {
    userId: item.user.id,
    name: item.user.name,
    workDate: date,
    dayLabel,
    isToday: date === today,
  };
  const row = item.attendance;
  if (!row) return { kind: 'add', row: { ...base, location: 'office' } };
  const attendanceRow = {
    ...base,
    attendanceId: row.id,
    checkIn: clockValue(row.checkInAt, tz),
    checkOut: clockValue(row.checkOutAt, tz),
    location: row.location,
    note: row.note,
    checkInText: formatTime(row.checkInAt, tz),
  };
  return { kind: item.where === 'unverified' ? 'confirm' : 'edit', row: attendanceRow };
}

function tableRow(item, ctx) {
  const row = item.attendance;
  return {
    id: item.user.id,
    user: item.user,
    where: item.where,
    checkIn: row ? formatTime(row.checkInAt, ctx.tz) : null,
    lateMinutes: row?.lateMinutes ?? 0,
    checkOut: row?.checkOutAt ? formatTime(row.checkOutAt, ctx.tz) : null,
    missing: row?.checkoutStatus === 'missing',
    present: item.presentMinutes === null ? null : formatDuration(item.presentMinutes),
    note: row?.note ?? null,
    // HR changes other people's rows; their own go through another HR person or an Admin.
    action: ctx.canCorrect && item.user.id !== ctx.viewerId ? actionFor(item, ctx) : null,
  };
}

function kpis(summary, date) {
  const total = summary.tracked || 0;
  const pct = (count) => (total > 0 ? (count / total) * 100 : 0);
  const people = (count) => plural(count, 'person', 'people');
  // "1 from yesterday"; on a Monday "2 from Friday", or "3 since Friday" when the weekend had
  // missing check-outs too.
  const relative = formatRelativeDay(summary.missingFromDate, date) ?? 'Yesterday';
  const when = relative === 'Yesterday' || relative === 'Today' ? relative.toLowerCase() : relative;
  return [
    {
      label: 'Present',
      value: summary.present,
      sub: `of ${total} people`,
      percent: pct(summary.present),
      color: 'primary',
    },
    {
      label: 'In office',
      value: summary.inOffice,
      sub: people(summary.inOffice),
      percent: pct(summary.inOffice),
      color: 'primary',
    },
    {
      label: 'Working from home',
      value: summary.wfh,
      sub: people(summary.wfh),
      percent: pct(summary.wfh),
      color: 'violet',
    },
    {
      label: 'Late',
      value: summary.late,
      sub: summary.late
        ? `average ${summary.lateAverageMinutes} ${plural(summary.lateAverageMinutes, 'minute')}`
        : people(0),
      percent: pct(summary.late),
      color: 'marigold',
    },
    {
      label: 'Missing check-out',
      value: summary.missingCheckouts,
      sub: `${summary.missingDays > 1 ? 'since' : 'from'} ${when}`,
      percent: pct(summary.missingCheckouts),
      color: 'red',
    },
  ];
}

/**
 * @param {{ user: object, date?: string, filter?: string }} input from the URL
 */
export async function loadAttendance({ user, date: asked, filter: askedFilter }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = localDate(tz);
  const date = await attendance.resolveDate(asked);
  const filter = FILTERS.includes(askedFilter) ? askedFilter : 'all';
  const canCorrect = can(user, 'attendance.correct');
  const items = await attendance.listDay(date);
  const [summary, corrections, missing] = await Promise.all([
    attendance.getDaySummary(date, items),
    canCorrect ? attendance.listCorrections({ status: 'pending', limit: 20 }) : null,
    attendance.listMissingCheckouts({ limit: 5 }),
  ]);
  const dayLabel = formatDayShort(date);
  const ctx = { date, today, dayLabel, tz, canCorrect, viewerId: user.id };
  return {
    tz,
    today,
    date,
    filter,
    canCorrect,
    summary,
    kpis: kpis(summary, date),
    rows: attendance.filterDay(items, filter).map((item) => tableRow(item, ctx)),
    corrections: corrections && {
      total: corrections.total,
      items: corrections.items.map((item) => ({ ...item, own: item.userId === user.id })),
    },
    missing: {
      total: missing.total,
      items: missing.items.map((row) => ({
        id: row.id,
        title: `${row.user.name}, ${formatDayShort(row.workDate).replace(',', '')}`,
        action:
          canCorrect && row.userId !== user.id
            ? {
                kind: 'fix',
                row: {
                  attendanceId: row.id,
                  userId: row.userId,
                  name: row.user.name,
                  workDate: row.workDate,
                  dayLabel: formatDayShort(row.workDate),
                  checkIn: clockValue(row.checkInAt, tz),
                  checkOut: null,
                  location: row.location,
                  isToday: row.workDate === today,
                },
              }
            : null,
      })),
    },
    prevDate: addDays(date, -1),
    nextDate: date < today ? addDays(date, 1) : null,
  };
}
