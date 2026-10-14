// Loads and shapes the Attendance page (artboard 09). Server only (called from page.js). Every read
// passes the viewer: HR and PMs never see an Admin's attendance (company rule). Durations read as
// hours and minutes ("Late 1h 37m"), never a bare minute count past an hour. HR and Admins also
// get the work-from-home requests card (CONTRACT 17, wfhCard.js).
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
import { handledSinceFor, wfhCard } from './wfhCard';

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

/**
 * The Present cell (CONTRACT 15): present time, or worked time (present less breaks) with a
 * "Breaks 45m" line and an "Over 15m" tag past the daily allowance once the person took breaks
 * ("Breaks 1h 2m", "Over 1h 15m" past an hour).
 */
function presentOf(item) {
  const present = item.presentMinutes;
  const breaks = item.breakMinutes ?? 0;
  if (present === null || present === undefined) return { present: null };
  if (breaks <= 0) return { present: formatDuration(present) };
  const worked = item.workedMinutes ?? Math.max(0, present - breaks);
  const over = item.overAllowanceMinutes ?? 0;
  return {
    present: formatDuration(worked),
    breaks: `Breaks ${formatDuration(breaks)}`,
    over: over > 0 ? `Over ${formatDuration(over)}` : null,
    presentTitle: `Present ${formatDuration(present)}, breaks ${formatDuration(breaks)}, worked ${formatDuration(worked)}`,
  };
}

function tableRow(item, ctx) {
  const row = item.attendance;
  return {
    id: item.user.id,
    user: item.user,
    where: item.where,
    checkIn: row ? formatTime(row.checkInAt, ctx.tz) : null,
    late: row?.lateMinutes > 0 ? `Late ${formatDuration(row.lateMinutes)}` : null,
    checkOut: row?.checkOutAt ? formatTime(row.checkOutAt, ctx.tz) : null,
    missing: row?.checkoutStatus === 'missing',
    ...presentOf(item),
    note: row?.note ?? null,
    // HR changes other people's rows; their own go through another HR person or an Admin.
    action: ctx.canCorrect && item.user.id !== ctx.viewerId ? actionFor(item, ctx) : null,
  };
}

/** "average 26 minutes" (the artboard's words), "average 1h 37m" from an hour up. */
function averageLate(minutes) {
  return minutes < 60 ? `${minutes} ${plural(minutes, 'minute')}` : formatDuration(minutes);
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
      sub: summary.late ? `average ${averageLate(summary.lateAverageMinutes)}` : people(0),
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
  const viewer = user;
  const items = await attendance.listDay(date, { viewer });
  const [summary, corrections, missing, wfh, wfhWaiting] = await Promise.all([
    attendance.getDaySummary(date, { items, viewer }),
    canCorrect ? attendance.listCorrections({ status: 'pending', limit: 20, viewer }) : null,
    attendance.listMissingCheckouts({ limit: 5, viewer }),
    // Pending requests, then the ones handled in the last 7 days (whatever day is shown).
    canCorrect
      ? attendance.listWfhRequests({ viewer, handledSince: handledSinceFor(today), limit: 30 })
      : null,
    canCorrect ? attendance.countPendingWfh({ viewer }) : 0,
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
    wfh: wfhCard(wfh, wfhWaiting, { viewer, tz, today }),
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
