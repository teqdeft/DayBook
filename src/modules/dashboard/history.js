// "Report history" on the Employee detailed view: one row per day the person was expected in the
// range, plus their holidays and leave days (CONTRACT 25) and any other day with a check-in or a
// report, newest first, with that day's tasks and edit history. Leave shows as "On leave" and
// its part of the day, never its type or pay (PMs see this page).
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
import { attendance as attendanceModule } from '@/modules/attendance';
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

const CLOSED_WORDS = { done: 'Marked done', dropped: 'Marked not needed' };

/**
 * "Marked done on Thu, 12 Nov" / "Marked not needed on Thu, 12 Nov" for a line the person closed
 * from the suggestions without bringing it into a later day (CONTRACT 24), else null.
 */
export function closedNoteOf(row, tz) {
  const words = CLOSED_WORDS[row.carryClosedReason];
  if (!words || !row.carryClosedAt) return null;
  return `${words} on ${formatDayShort(workDate(tz, row.carryClosedAt))}`;
}

/** Report entries (one row per task from the repo) as projects with their tasks. */
function entriesOf(rows = [], tz) {
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
      entries.get(row.entryId).tasks.push({
        id: row.taskId,
        title: row.title,
        status: row.status,
        closedNote: closedNoteOf(row, tz),
      });
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
 * check-in, 'off' (a dash) on a day they weren't expected (a holiday, full-day leave: CONTRACT
 * 25), Not checked in otherwise. Today before the report time (`dueToday`), a checked-in day
 * without a submitted report is still Due (Draft once one is started), as on the Team board.
 * @returns {'submitted'|'edited'|'missing'|'due'|'draft'|'off'|'not_checked_in'}
 */
export function historyReportStatus(attendance, report, dueToday = false, off = false) {
  if (report?.status === 'submitted') return report.revision > 1 ? 'edited' : 'submitted';
  if (attendance && dueToday) return report ? 'draft' : 'due';
  if (attendance) return 'missing';
  if (report) return 'draft';
  return off ? 'off' : 'not_checked_in';
}

/** Present time (build guide 7.10): check-out (or now, for today) minus check-in. */
export function presentMinutesOf(attendance, { today, now }) {
  if (!attendance?.checkInAt) return null;
  if (attendance.checkOutAt) return minutesBetween(attendance.checkInAt, attendance.checkOutAt);
  return attendance.workDate === today ? minutesBetween(attendance.checkInAt, now) : null;
}

/** The day's holiday when it falls on a working weekday while employed, else null. */
function holidayOf(day) {
  return day?.holiday && day.weekday && day.employed ? day.holiday : null;
}

/** The check-in's place: office, unverified (office without the office network) or wfh. */
function placeOf(attendance) {
  if (attendance.location === 'wfh') return 'wfh';
  return attendance.officeVerified === false ? 'unverified' : 'office';
}

/**
 * The Where cell (CONTRACT 25): the check-in's place; without one "On leave" or "Holiday"
 * (StatusCell on_leave, holiday). `whereNote` is the muted line under it: the half of a leave
 * day, the holiday's name, or "On leave" for someone who checked in on a leave day.
 */
function whereOf(attendance, day) {
  if (attendance) return { where: placeOf(attendance), whereNote: day?.leave ? day.label : null };
  if (day?.leave) {
    const half = day.leave.part !== 'full';
    return {
      where: 'on_leave',
      whereNote: half ? attendanceModule.PART_LABELS[day.leave.part] : null,
    };
  }
  const holiday = holidayOf(day);
  if (holiday) return { where: 'holiday', whereNote: holiday.name };
  return { where: null, whereNote: null };
}

function historyRow({ date, attendance, report, entries, revisions, requests, day, ctx }) {
  const dueToday = date === ctx.today && Boolean(ctx.due?.before);
  const status = historyReportStatus(attendance, report, dueToday, day?.expected === 0);
  const submitted = status === 'submitted' || status === 'edited';
  const present = presentMinutesOf(attendance, ctx);
  const loggedText = attendance ? formatHours(0) : '—';
  return {
    date,
    dateLabel: formatDayShort(date),
    ...whereOf(attendance, day),
    in: attendance ? formatTime(attendance.checkInAt, ctx.tz) : '—',
    out: attendance?.checkOutAt ? formatTime(attendance.checkOutAt, ctx.tz) : '—',
    // 'auto' counts like 'checked_out'; the page labels it "Auto check-out" (CONTRACT 19).
    checkoutStatus: attendance?.checkoutStatus ?? null,
    presentMinutes: present,
    present: present === null ? '—' : formatDuration(present),
    loggedMinutes: submitted ? Number(report.totalMinutes) : 0,
    logged: submitted ? formatHours(report.totalMinutes) : loggedText,
    // Projects with hours only: a planned project (0 minutes, CONTRACT 24) wasn't worked on.
    projects: submitted
      ? entries.filter((entry) => entry.minutes > 0).map((entry) => entry.project)
      : [],
    report: status,
    reportLabel: status === 'due' ? `Due ${ctx.due.label}` : null,
    reportStatus: report?.status ?? null,
    entries,
    revisions,
    requests,
  };
}

/** Whether the person was expected on a date: the person's day, else the 1.09 weekday rule. */
function expectedOn(date, day, { profile, ctx }) {
  if (day) return day.expected > 0;
  return (
    isWorkingDay(date, ctx.settings.workingDays) &&
    profile.tracksAttendance &&
    !(profile.joinedOn && date < profile.joinedOn) &&
    !(profile.deactivatedOn && date > profile.deactivatedOn)
  );
}

/**
 * @param {{ days: string[], attendance: object[], reports: object[], entries: object[],
 *   revisions: object[], requests?: object[], profile: object, ctx: object,
 *   dayOf?: (date: string) => object }} input  `days` oldest first; `requests` are the person's
 *   pending or declined edit requests; `dayOf` is the person's day (PersonDay, CONTRACT 25), so
 *   holidays and leave days show and aren't "Not checked in" (without it the weekday rule)
 */
export function buildHistory(input) {
  const { days, attendance, reports, entries, revisions, requests = [], profile, ctx } = input;
  const dayOf = input.dayOf ?? (() => null);
  const attendanceByDate = new Map(attendance.map((row) => [row.workDate, row]));
  const reportByDate = new Map(reports.map((row) => [row.workDate, row]));
  const entriesByReport = groupBy(entries, 'reportId');
  const revisionsByReport = groupBy(revisions, 'reportId');
  const requestsByDate = groupBy(requests, 'workDate');
  const rows = [];
  for (const date of [...days].reverse()) {
    const row = attendanceByDate.get(date) ?? null;
    const report = reportByDate.get(date) ?? null;
    const day = dayOf(date);
    const shown = expectedOn(date, day, { profile, ctx }) || day?.leave || holidayOf(day);
    const dayRequests = requestsByDate.get(date) ?? [];
    if (!row && !report && !shown && dayRequests.length === 0) continue;
    rows.push(
      historyRow({
        date,
        attendance: row,
        report,
        entries: report ? entriesOf(entriesByReport.get(report.id), ctx.tz) : [],
        revisions: report ? revisionsOf(revisionsByReport.get(report.id), ctx.tz) : [],
        requests: requestsOf(dayRequests, { profile, ctx }),
        day,
        ctx,
      }),
    );
  }
  return rows;
}
