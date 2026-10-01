// "Report history" on the Employee detailed view: one row per working day in the range (plus any
// other day with a check-in or a report), newest first, with that day's tasks and edit history.
import {
  formatDayShort,
  formatDuration,
  formatHours,
  formatTime,
  formatTimeAmPm,
  isWorkingDay,
  minutesBetween,
  workDate,
} from '@/lib/time';
import { isoOrNull } from './shared';

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

/** Report entries (one row per task from the repo) as projects with their tasks. */
function entriesOf(rows = []) {
  const entries = new Map();
  for (const row of rows) {
    if (!entries.has(row.entryId)) {
      entries.set(row.entryId, {
        id: row.entryId,
        project: { name: row.projectName, color: row.color },
        minutes: Number(row.minutes),
        hours: formatHours(row.minutes),
        tasks: [],
      });
    }
    if (row.taskId) {
      entries.get(row.entryId).tasks.push({ id: row.taskId, title: row.title, status: row.status });
    }
  }
  return [...entries.values()];
}

const stamp = (at, tz) =>
  at ? `${formatDayShort(workDate(tz, at))}, ${formatTimeAmPm(at, tz)}` : '';

/** Edit requests still waiting or declined (approved ones show as the revision they led to). */
function requestsOf(rows = [], { profile, ctx }) {
  return rows.map((row) => {
    const declined = row.status === 'declined';
    return {
      id: row.id,
      status: row.status,
      label: declined ? 'Edit declined' : 'Edit requested',
      by: declined ? (row.handledByName ?? 'Someone') : profile.name,
      at: isoOrNull(declined ? row.handledAt : row.createdAt),
      when: stamp(declined ? row.handledAt : row.createdAt, ctx.tz),
      reason: row.reason ?? null,
      declineReason: declined ? (row.declineReason ?? null) : null,
    };
  });
}

function revisionsOf(rows = [], tz) {
  return rows.map((row) => ({
    revision: row.revision,
    label: row.revision > 1 ? 'Edited' : 'Submitted',
    by: row.editedByName ?? 'Someone',
    at: isoOrNull(row.createdAt),
    when: stamp(row.createdAt, tz),
    reason: row.reason ?? null,
    total: row.totalMinutes === null ? null : formatHours(row.totalMinutes),
  }));
}

/**
 * Report column: Submitted (or Edited once it was submitted more than once), Missing when the
 * person checked in without submitting, Draft for an unsubmitted report on a day without a
 * check-in, Not checked in otherwise.
 */
export function historyReportStatus(attendance, report) {
  if (report?.status === 'submitted') return report.revision > 1 ? 'edited' : 'submitted';
  if (attendance) return 'missing';
  if (report) return 'draft';
  return 'not_checked_in';
}

/** Present time (build guide 7.10): check-out (or now, for today) minus check-in. */
export function presentMinutesOf(attendance, { today, now }) {
  if (!attendance?.checkInAt) return null;
  if (attendance.checkOutAt) return minutesBetween(attendance.checkInAt, attendance.checkOutAt);
  return attendance.workDate === today ? minutesBetween(attendance.checkInAt, now) : null;
}

function whereOf(attendance) {
  if (!attendance) return null;
  if (attendance.location === 'wfh') return 'wfh';
  return attendance.officeVerified === false ? 'unverified' : 'office';
}

function historyRow({ date, attendance, report, entries, revisions, requests, ctx }) {
  const status = historyReportStatus(attendance, report);
  const submitted = status === 'submitted' || status === 'edited';
  const present = presentMinutesOf(attendance, ctx);
  const loggedText = attendance ? formatHours(0) : '—';
  return {
    date,
    dateLabel: formatDayShort(date),
    where: whereOf(attendance),
    in: attendance ? formatTime(attendance.checkInAt, ctx.tz) : '—',
    out: attendance?.checkOutAt ? formatTime(attendance.checkOutAt, ctx.tz) : '—',
    presentMinutes: present,
    present: present === null ? '—' : formatDuration(present),
    loggedMinutes: submitted ? Number(report.totalMinutes) : 0,
    logged: submitted ? formatHours(report.totalMinutes) : loggedText,
    projects: submitted ? entries.map((entry) => entry.project) : [],
    report: status,
    reportStatus: report?.status ?? null,
    entries,
    revisions,
    requests,
  };
}

/**
 * @param {{ days: string[], attendance: object[], reports: object[], entries: object[],
 *   revisions: object[], requests?: object[], profile: object, ctx: object }} input  `days`
 *   oldest first; `requests` are the person's pending or declined edit requests
 */
export function buildHistory(input) {
  const { days, attendance, reports, entries, revisions, requests = [], profile, ctx } = input;
  const attendanceByDate = new Map(attendance.map((row) => [row.workDate, row]));
  const reportByDate = new Map(reports.map((row) => [row.workDate, row]));
  const entriesByReport = groupBy(entries, 'reportId');
  const revisionsByReport = groupBy(revisions, 'reportId');
  const requestsByDate = groupBy(requests, 'workDate');
  const rows = [];
  for (const date of [...days].reverse()) {
    const row = attendanceByDate.get(date) ?? null;
    const report = reportByDate.get(date) ?? null;
    const expected =
      isWorkingDay(date, ctx.settings.workingDays) &&
      profile.tracksAttendance &&
      !(profile.joinedOn && date < profile.joinedOn) &&
      !(profile.deactivatedOn && date > profile.deactivatedOn);
    const dayRequests = requestsByDate.get(date) ?? [];
    if (!row && !report && !expected && dayRequests.length === 0) continue;
    rows.push(
      historyRow({
        date,
        attendance: row,
        report,
        entries: report ? entriesOf(entriesByReport.get(report.id)) : [],
        revisions: report ? revisionsOf(revisionsByReport.get(report.id), ctx.tz) : [],
        requests: requestsOf(dayRequests, { profile, ctx }),
        ctx,
      }),
    );
  }
  return rows;
}
