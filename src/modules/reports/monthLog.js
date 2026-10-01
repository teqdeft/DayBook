// My log (build guide section 8): a person's month of reports, hours and attendance, as the page,
// GET /api/me/log and the Excel download use it.
import {
  addMonths,
  dayjs,
  eachDay,
  isWorkingDay,
  locksAtFor,
  monthOf,
  monthRange,
  now,
  nowDate,
  workDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import * as repo from './repo';
import { listMinutesByProject } from './queries';
import { editRequestView } from './editRequests';
import { isEditable, loadEntriesFor } from './view';

/** 'next_day_12:00' -> 'Reports lock at 12:00 the next day' */
export function lockRuleText(reportLock) {
  const match = /^(same|next)_day_(\d{1,2}:\d{2})$/.exec(reportLock ?? '');
  if (!match) return 'Reports lock at 12:00 the next day';
  return `Reports lock at ${match[2]} ${match[1] === 'next' ? 'the next day' : 'the same day'}`;
}

function percent(part, whole) {
  if (!whole) return part > 0 ? 100 : 0;
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

/**
 * The report state shown in a My log row: submitted (still editable), locked, edit_requested,
 * draft, not_started (checked in, nothing written yet, still open), missing (checked in or
 * drafted but never submitted before the lock) or not_checked_in.
 */
export function rowStatus({
  report,
  attendanceRow,
  pending,
  dayLocked,
  at,
  tracksAttendance = true,
}) {
  if (pending) return 'edit_requested';
  if (report?.status === 'submitted') return isEditable(report, at) ? 'submitted' : 'locked';
  if (report) return isEditable(report, at) ? 'draft' : 'missing';
  if (!attendanceRow && tracksAttendance) return 'not_checked_in';
  return dayLocked ? 'missing' : 'not_started';
}

/** When the person can still change a report: the lock time, or the approved edit window. */
function editableUntil(report, at) {
  if (!report || !isEditable(report, at)) return null;
  if (at.isBefore(dayjs(report.locksAt))) return report.locksAt;
  return report.unlockedUntil;
}

function buildDay({ day, today, attendanceRow, report, entries, pending, current, at, tracks }) {
  const locksAt = report?.locksAt ?? locksAtFor(day, current.reportLock, current.timezone);
  const dayLocked = report ? !isEditable(report, at) : !at.isBefore(dayjs(locksAt));
  const status = rowStatus({
    report,
    attendanceRow,
    pending,
    dayLocked,
    at,
    tracksAttendance: tracks,
  });
  return {
    date: day,
    isToday: day === today,
    isWorkingDay: isWorkingDay(day, current.workingDays),
    attendance: attendanceRow
      ? {
          checkInAt: attendanceRow.checkInAt,
          checkOutAt: attendanceRow.checkOutAt ?? null,
          location: attendanceRow.location,
          lateMinutes: Number(attendanceRow.lateMinutes) || 0,
          checkoutStatus: attendanceRow.checkoutStatus,
        }
      : null,
    presentMinutes: attendanceRow
      ? Number(attendance.presentMinutes(attendanceRow, nowDate(), current.timezone)) || 0
      : 0,
    report: report
      ? {
          id: report.id,
          status: report.status,
          totalMinutes: Number(report.totalMinutes) || 0,
          locksAt: report.locksAt,
          unlockedUntil: report.unlockedUntil ?? null,
          entries,
        }
      : null,
    status,
    locksAt,
    editableUntil: editableUntil(report, at),
    pendingRequest: pending ? editRequestView(pending) : null,
    canRequestEdit: dayLocked && !pending,
  };
}

function summarize({ days, today, reports, tracks = true }) {
  const worked = days.filter((d) => d.isWorkingDay && (d.date < today || d.attendance));
  const present = days.filter((d) => d.isWorkingDay && d.attendance);
  const withAttendance = days.filter((d) => d.attendance);
  const late = withAttendance.filter((d) => d.attendance.lateMinutes > 0);
  const lateTotal = late.reduce((sum, d) => sum + d.attendance.lateMinutes, 0);
  const submitted = reports.filter((r) => r.status === 'submitted');
  const expected = days.filter(
    (d) => (d.attendance || d.report) && (d.date < today || d.report?.status === 'submitted'),
  ).length;
  const loggedMinutes = submitted.reduce((sum, r) => sum + (Number(r.totalMinutes) || 0), 0);
  const presentMinutes = withAttendance.reduce((sum, d) => sum + d.presentMinutes, 0);
  return {
    kpis: {
      loggedMinutes,
      presentMinutes,
      loggedPercent: percent(loggedMinutes, presentMinutes),
      daysPresent: present.length,
      workingDays: worked.length,
      presentPercent: percent(present.length, worked.length),
      lateDays: late.length,
      lateAverageMinutes: late.length ? Math.round(lateTotal / late.length) : 0,
      latePercent: percent(late.length, worked.length),
      reportsSubmitted: submitted.length,
      reportsExpected: Math.max(expected, submitted.length),
      reportsPercent: percent(submitted.length, Math.max(expected, submitted.length)),
    },
    attendance: {
      office: withAttendance.filter((d) => d.attendance.location === 'office').length,
      wfh: withAttendance.filter((d) => d.attendance.location === 'wfh').length,
      late: late.length,
      // Someone who doesn't track attendance is never "not checked in".
      notCheckedIn: tracks ? Math.max(0, worked.length - present.length) : 0,
    },
  };
}

/**
 * Everything My log shows for one month: the four numbers, one row per working day up to today
 * (newest first; also any other day with a check-in or a report), hours by project, the
 * person's edit requests for the month and the attendance counts.
 * @param {{ user: { id: number, joinedOn?: string | null, tracksAttendance?: boolean },
 *   month?: string }} input month 'YYYY-MM', default this month (a later month shows this one)
 * @returns {Promise<object>}
 */
export async function getMonthLog({ user, month }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const at = now();
  const today = workDate(tz, at);
  const thisMonth = monthOf(today);
  const selected = month && month < thisMonth ? month : thisMonth;
  const { from, to: monthEnd } = monthRange(selected);
  const start = user.joinedOn && user.joinedOn > from ? user.joinedOn : from;
  const end = monthEnd < today ? monthEnd : today;
  const hasDays = start <= end;
  const [attendanceRows, reports, requests, hoursByProject] = await Promise.all([
    hasDays ? attendance.listForUserRange(user.id, start, end) : [],
    hasDays ? repo.listByUserRange(user.id, start, end) : [],
    repo.listEditRequestsByUser(user.id, { from, to: monthEnd, limit: 100 }),
    listMinutesByProject({ from, to: monthEnd, userId: user.id }),
  ]);
  const entries = await loadEntriesFor(reports.map((report) => report.id));
  const attendanceByDay = new Map((attendanceRows ?? []).map((row) => [row.workDate, row]));
  const reportByDay = new Map(reports.map((report) => [report.workDate, report]));
  const pendingByDay = new Map(
    requests.filter((r) => r.status === 'pending').map((r) => [r.workDate, r]),
  );
  const dates = hasDays
    ? eachDay(start, end).filter(
        (day) =>
          isWorkingDay(day, current.workingDays) ||
          attendanceByDay.has(day) ||
          reportByDay.has(day),
      )
    : [];
  const days = dates.reverse().map((day) => {
    const report = reportByDay.get(day) ?? null;
    return buildDay({
      day,
      today,
      attendanceRow: attendanceByDay.get(day) ?? null,
      report,
      entries: report ? (entries.get(report.id) ?? []) : [],
      pending: pendingByDay.get(day) ?? null,
      current,
      at,
      tracks: user.tracksAttendance !== false,
    });
  });
  return {
    month: selected,
    today,
    prevMonth: addMonths(selected, -1),
    nextMonth: selected < thisMonth ? addMonths(selected, 1) : null,
    lockText: lockRuleText(current.reportLock),
    timezone: tz,
    ...summarize({ days, today, reports, tracks: user.tracksAttendance !== false }),
    days,
    hoursByProject,
    editRequests: requests.slice(0, 5).map(editRequestView),
    requestableDays: days.filter((day) => day.canRequestEdit).map((day) => day.date),
  };
}
