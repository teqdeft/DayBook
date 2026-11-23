// My log (build guide section 8): a person's month of reports, hours and attendance, as the page,
// GET /api/me/log and the Excel download use it. The person's day (CONTRACT 25) decides the
// working days: a company holiday or the person's own leave is never "not checked in", and the
// day carries the person's own leave type and pay (never HR's note).
import {
  addMonths,
  dayjs,
  eachDay,
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
 * drafted but never submitted before the lock), not_checked_in, or for a day off with no
 * check-in and no report `off`: 'holiday' or 'on_leave' (CONTRACT 25).
 */
export function rowStatus({
  report,
  attendanceRow,
  pending,
  dayLocked,
  at,
  tracksAttendance = true,
  off = null,
}) {
  if (pending) return 'edit_requested';
  if (report?.status === 'submitted') return isEditable(report, at) ? 'submitted' : 'locked';
  if (report) return isEditable(report, at) ? 'draft' : 'missing';
  if (!attendanceRow && off) return off;
  if (!attendanceRow && tracksAttendance) return 'not_checked_in';
  return dayLocked ? 'missing' : 'not_started';
}

/** When the person can still change a report: the lock time, or the approved edit window. */
function editableUntil(report, at) {
  if (!report || !isEditable(report, at)) return null;
  if (at.isBefore(dayjs(report.locksAt))) return report.locksAt;
  return report.unlockedUntil;
}

/** A company holiday on a working weekday ({ name }), else null. */
function holidayOf(personDay) {
  return personDay.holiday && personDay.weekday ? { name: personDay.holiday.name } : null;
}

/** Holiday or full-day leave without a check-in: the row reads 'holiday' or 'on_leave'. */
function offStatusOf(personDay) {
  if (holidayOf(personDay)) return 'holiday';
  return personDay.leave?.part === 'full' ? 'on_leave' : null;
}

function buildDay({ day, personDay, today, attendanceRow, report, entries, pending, ctx }) {
  const { current, at, tracks } = ctx;
  const locksAt = report?.locksAt ?? locksAtFor(day, current.reportLock, current.timezone);
  const dayLocked = report ? !isEditable(report, at) : !at.isBefore(dayjs(locksAt));
  const status = rowStatus({
    report,
    attendanceRow,
    pending,
    dayLocked,
    at,
    tracksAttendance: tracks,
    off: offStatusOf(personDay),
  });
  const leave = personDay.leave;
  return {
    date: day,
    isToday: day === today,
    isWorkingDay: personDay.isWorkingDay,
    holiday: holidayOf(personDay),
    // The person's own leave: the part, type and pay (CONTRACT 25), never HR's note.
    leave: leave ? { part: leave.part, paid: leave.paid, leaveType: leave.leaveType } : null,
    attendance: attendanceRow
      ? {
          checkInAt: attendanceRow.checkInAt,
          checkOutAt: attendanceRow.checkOutAt ?? null,
          location: attendanceRow.location,
          lateMinutes: attendance.effectiveLateMinutes({ row: attendanceRow, day: personDay }),
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

/**
 * The working days so far and what became of them, from attendance.dayCounts (CONTRACT 25): a
 * working day counts once it has passed, or today once checked in or on leave; present, leave
 * and absent may be halves (half-day leave). Holidays and days off never count.
 */
function countDays(items, today) {
  const totals = { workingDays: 0, present: 0, leave: 0, absent: 0 };
  for (const { date, personDay, row } of items) {
    if (!personDay.isWorkingDay || !personDay.employed) continue;
    const counts = attendance.dayCounts({ day: personDay, row, past: date < today });
    if (date >= today && counts.present + counts.leave === 0) continue;
    totals.workingDays += 1;
    totals.present += counts.present;
    totals.leave += counts.leave;
    totals.absent += counts.absent;
  }
  return totals;
}

function summarize({ items, days, today, reports, tracks = true }) {
  const counted = countDays(items, today);
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
      daysPresent: counted.present,
      workingDays: counted.workingDays,
      presentPercent: percent(counted.present, counted.workingDays),
      leaveDays: counted.leave,
      lateDays: late.length,
      lateAverageMinutes: late.length ? Math.round(lateTotal / late.length) : 0,
      latePercent: percent(late.length, counted.workingDays),
      reportsSubmitted: submitted.length,
      reportsExpected: Math.max(expected, submitted.length),
      reportsPercent: percent(submitted.length, Math.max(expected, submitted.length)),
    },
    attendance: {
      office: withAttendance.filter((d) => d.attendance.location === 'office').length,
      wfh: withAttendance.filter((d) => d.attendance.location === 'wfh').length,
      late: late.length,
      leave: counted.leave,
      // Someone who doesn't track attendance is never "not checked in"; a half-day leave no-show
      // counts half (dayCounts' absent).
      notCheckedIn: tracks ? counted.absent : 0,
    },
  };
}

/**
 * The month's reads for one person, in parallel, and the person's day for each date: their own
 * calendar with leaveDetail (the leave's type and pay are theirs to see; the note is never read).
 * Someone who doesn't track attendance is counted against the company's working days, as before.
 */
async function loadMonth({ user, from, monthEnd, start, end }) {
  const hasDays = start <= end;
  const [attendanceRows, reports, requests, hoursByProject, calendar] = await Promise.all([
    hasDays ? attendance.listForUserRange(user.id, start, end) : [],
    hasDays ? repo.listByUserRange(user.id, start, end) : [],
    repo.listEditRequestsByUser(user.id, { from, to: monthEnd, limit: 100 }),
    listMinutesByProject({ from, to: monthEnd, userId: user.id }),
    hasDays
      ? attendance.loadCalendar({
          from: start,
          to: end,
          userIds: [user.id],
          leaveDetail: true,
          withWfh: false,
        })
      : null,
  ]);
  const person = user.tracksAttendance === false ? { ...user, tracksAttendance: true } : user;
  return {
    attendanceRows: attendanceRows ?? [],
    reports,
    requests,
    hoursByProject,
    entries: await loadEntriesFor(reports.map((report) => report.id)),
    dayOf: (date) => calendar.dayFor(person, date),
  };
}

/**
 * Everything My log shows for one month: the four numbers, one row per working day up to today
 * (newest first; also any other day with a check-in or a report, and the company holidays on a
 * working weekday), hours by project, the person's edit requests for the month and the
 * attendance counts. CONTRACT 25: each day carries `holiday` ({ name } | null) and `leave` ({
 * part, paid, leaveType } | null, the person's own); `kpis.workingDays` counts the working days
 * so far while employed, leave included; `attendance.notCheckedIn` is dayCounts' absent (halves
 * allowed) and late is the effective late.
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
  const loaded = await loadMonth({ user, from, monthEnd, start, end });
  const { reports, requests, entries, dayOf } = loaded;
  const attendanceByDay = new Map(loaded.attendanceRows.map((row) => [row.workDate, row]));
  const reportByDay = new Map(reports.map((report) => [report.workDate, report]));
  const pendingByDay = new Map(
    requests.filter((r) => r.status === 'pending').map((r) => [r.workDate, r]),
  );
  const items = (start <= end ? eachDay(start, end) : [])
    .map((date) => ({ date, personDay: dayOf(date), row: attendanceByDay.get(date) ?? null }))
    .filter(
      ({ date, personDay, row }) =>
        personDay.isWorkingDay || row || reportByDay.has(date) || holidayOf(personDay),
    )
    .reverse();
  const tracks = user.tracksAttendance !== false;
  const ctx = { current, at, tracks };
  const days = items.map(({ date, personDay, row }) => {
    const report = reportByDay.get(date) ?? null;
    return buildDay({
      day: date,
      personDay,
      today,
      attendanceRow: row,
      report,
      entries: report ? (entries.get(report.id) ?? []) : [],
      pending: pendingByDay.get(date) ?? null,
      ctx,
    });
  });
  return {
    month: selected,
    today,
    prevMonth: addMonths(selected, -1),
    nextMonth: selected < thisMonth ? addMonths(selected, 1) : null,
    lockText: lockRuleText(current.reportLock),
    timezone: tz,
    ...summarize({ items, days, today, reports, tracks }),
    days,
    hoursByProject: loaded.hoursByProject,
    editRequests: requests.slice(0, 5).map(editRequestView),
    requestableDays: days.filter((day) => day.canRequestEdit).map((day) => day.date),
  };
}
