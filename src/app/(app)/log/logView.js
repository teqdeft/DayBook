// Shapes a getMonthLog() result into the plain rows the My log page renders (artboard 03). Runs on
// the server; everything it returns is serialisable text and numbers for the client table.
import { plural } from '@/lib/text';
import {
  addDays,
  formatDayShort,
  formatDuration,
  formatHours,
  formatTime,
  toLocal,
  workDate,
} from '@/lib/time';

export const LOG_STATUS = {
  submitted: { status: 'submitted', label: 'Submitted' },
  locked: { status: 'locked', label: 'Locked' },
  edit_requested: { status: 'edit_requested', label: 'Edit requested' },
  draft: { status: 'draft', label: 'Draft' },
  not_started: { status: 'draft', label: 'Not started' },
  missing: { status: 'missing', label: 'Missing' },
  not_checked_in: { status: 'not_checked_in', label: 'Not checked in' },
};

/** '12:00 tomorrow', '18:30 today', '12:00 on Thu, 1 Oct' (24-hour, like the lock rule text). */
export function momentText(at, tz, today) {
  const day = workDate(tz, at);
  const time = toLocal(at, tz).format('HH:mm');
  if (day === today) return `${time} today`;
  if (day === addDays(today, 1)) return `${time} tomorrow`;
  return `${time} on ${formatDayShort(day)}`;
}

/** 'today at 9:48', 'yesterday at 2:10', 'on Fri, 25 Sep at 9:15' */
export function sentText(at, tz, today) {
  const day = workDate(tz, at);
  const time = formatTime(at, tz);
  if (day === today) return `today at ${time}`;
  if (day === addDays(today, -1)) return `yesterday at ${time}`;
  return `on ${formatDayShort(day)} at ${time}`;
}

function timesText(day, tz) {
  const row = day.attendance;
  if (!row) return null;
  const inAt = formatTime(row.checkInAt, tz);
  if (row.checkOutAt) return `${inAt} to ${formatTime(row.checkOutAt, tz)}`;
  if (row.checkoutStatus === 'open' && day.isToday) return `Since ${inAt}`;
  return `${inAt}, no check-out`;
}

function reportHref(date, today) {
  return date === today ? '/report' : `/report?date=${date}`;
}

/** The line under an opened day's tasks and what the person can do about it. */
function panelFooter(day, { tz, today }) {
  const href = reportHref(day.date, today);
  const request = day.canRequestEdit ? { kind: 'request', label: 'Request an edit' } : null;
  switch (day.status) {
    case 'submitted':
      return {
        note: `You can edit this report until ${momentText(day.editableUntil, tz, today)}.`,
        action: { kind: 'link', href, label: 'Edit report' },
      };
    case 'draft':
      return {
        note: `This report isn't submitted yet. Submit it by ${momentText(day.editableUntil, tz, today)}.`,
        action: { kind: 'link', href, label: 'Edit report' },
      };
    case 'not_started':
      return {
        note: `You haven't written this report yet. It locks at ${momentText(day.locksAt, tz, today)}.`,
        action: { kind: 'link', href, label: 'Write report' },
      };
    case 'edit_requested':
      return {
        note: `You asked to edit this report ${sentText(day.pendingRequest.createdAt, tz, today)}. You'll get a notification when it opens.`,
        action: null,
      };
    case 'locked':
      return {
        note: `This report locked at ${momentText(day.report.unlockedUntil ?? day.locksAt, tz, today)}.`,
        action: request,
      };
    case 'missing':
      return {
        note: day.report
          ? "This report wasn't submitted before it locked."
          : 'No report was written for this day.',
        action: request,
      };
    default:
      return {
        note: day.isToday
          ? "You haven't checked in today."
          : "You didn't check in or write a report on this day.",
        action: day.isToday ? { kind: 'link', href, label: 'Write report' } : request,
      };
  }
}

function taskRows(day) {
  const entries = day.report?.entries ?? [];
  return entries.flatMap((entry) => {
    const project = { name: entry.projectName, color: entry.projectColor };
    const hours = formatHours(entry.minutes);
    const tasks = entry.tasks.filter((task) => task.title.trim());
    if (tasks.length === 0) {
      return [{ key: `e${entry.id}`, project, hours, title: null, status: null }];
    }
    return tasks.map((task, index) => ({
      key: `t${task.id}`,
      project: index === 0 ? project : null,
      hours: index === 0 ? hours : null,
      title: task.title,
      status: task.status,
    }));
  });
}

/**
 * One table row per day.
 * @returns {Array<object>} rows for <DailyReports />
 */
export function dayRows(log) {
  const context = { tz: log.timezone, today: log.today };
  return log.days.map((day) => {
    const report = day.report;
    const logged = report && (report.totalMinutes > 0 || report.status === 'submitted');
    return {
      date: day.date,
      dateLabel: formatDayShort(day.date),
      isToday: day.isToday,
      wfh: day.attendance?.location === 'wfh',
      times: timesText(day, log.timezone),
      present: day.attendance ? formatDuration(day.presentMinutes) : null,
      logged: logged ? formatHours(report.totalMinutes) : null,
      projects: (report?.entries ?? []).map((entry) => ({
        key: entry.projectId ? `p${entry.projectId}` : `r${entry.projectRequestId}`,
        name: entry.projectName,
        color: entry.projectColor,
      })),
      ...(LOG_STATUS[day.status] ?? LOG_STATUS.missing),
      tasks: taskRows(day),
      ...panelFooter(day, context),
    };
  });
}

/** The four numbers at the top. */
export function kpiCards(log) {
  const k = log.kpis;
  const isThisMonth = log.month === log.today.slice(0, 7);
  return [
    {
      key: 'hours',
      label: 'Hours logged',
      // Whole hours, like the other number cards (a tabular '.' reads as a gap at this size).
      value: formatHours(k.loggedMinutes, 0),
      sub: isThisMonth ? 'this month' : 'that month',
      percent: k.loggedPercent,
      color: 'primary',
    },
    {
      key: 'present',
      label: 'Days present',
      value: String(k.daysPresent),
      sub: `of ${k.workingDays} working ${plural(k.workingDays, 'day')}`,
      percent: k.presentPercent,
      color: 'green',
    },
    {
      key: 'late',
      label: 'Late days',
      value: String(k.lateDays),
      sub: k.lateDays
        ? `average ${k.lateAverageMinutes} ${plural(k.lateAverageMinutes, 'minute')}`
        : 'on time every day',
      percent: k.latePercent,
      color: 'marigold',
    },
    {
      key: 'reports',
      label: 'Reports submitted',
      value: String(k.reportsSubmitted),
      sub: `of ${k.reportsExpected}${isThisMonth ? ' so far' : ''}`,
      percent: k.reportsPercent,
      color: 'green',
    },
  ];
}

const REQUEST_STATUS = {
  pending: { status: 'pending', verb: 'Sent' },
  approved: { status: 'approved', verb: 'Approved' },
  declined: { status: 'declined', verb: 'Declined' },
};

/** The person's edit requests for the month's days (right column). */
export function editRequestItems(log) {
  const { timezone: tz, today } = log;
  return log.editRequests.map((request) => {
    const meta = REQUEST_STATUS[request.status] ?? REQUEST_STATUS.pending;
    const at = request.status === 'pending' ? request.createdAt : request.handledAt;
    return {
      id: request.id,
      title: `Report for ${formatDayShort(request.workDate)}`,
      reason: request.reason,
      status: meta.status,
      when: `${meta.verb} ${sentText(at ?? request.createdAt, tz, today)}`,
      declineReason: request.status === 'declined' ? request.declineReason : null,
      handledBy: request.handledBy?.name ?? null,
    };
  });
}

/** Attendance counts with their legend colours. */
export function attendanceItems(log) {
  const days = (count) => `${count} ${plural(count, 'day')}`;
  return [
    { key: 'office', label: 'In office', color: 'primary', value: days(log.attendance.office) },
    { key: 'wfh', label: 'Working from home', color: 'violet', value: days(log.attendance.wfh) },
    { key: 'late', label: 'Late', color: 'marigold', value: days(log.attendance.late) },
    {
      key: 'missing',
      label: 'Not checked in',
      color: 'red',
      value: days(log.attendance.notCheckedIn),
    },
  ];
}
