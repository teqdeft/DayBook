// The Team board's rows (artboard 05): each person's group, Report cell, live status (CONTRACT
// 15), today's to-do (CONTRACT 24) and, for someone off today, the tag (CONTRACT 25: leave, a
// holiday or a day off; never the leave type or pay). Pure: team.js does the reads.
import { formatDuration, formatTime } from '@/lib/time';
import { initials } from '@/lib/text';
import { todoOf } from './todo';
import { isOff, isoOrNull } from './shared';

export const GROUPS = [
  { key: 'office', title: 'In office', tone: 'primary' },
  { key: 'wfh', title: 'Working from home', tone: 'violet' },
  { key: 'not_checked_in', title: 'Not checked in', tone: 'red' },
  // CONTRACT 25: leave, a holiday or a day off without a check-in (the tone of its bar segment).
  { key: 'off', title: 'Off today', tone: 'teal' },
];

/** The board group of a row with its presence (withPresence). */
function groupOf(row) {
  if (row.attendanceId) return row.location === 'wfh' ? 'wfh' : 'office';
  return isOff(row.presence) ? 'off' : 'not_checked_in';
}

/**
 * The tag of someone off today (CONTRACT 25): "On leave" or "On leave, first half" teal, "Holiday"
 * green, "Day off" neutral; never the leave type or pay. Null for everyone else.
 * @returns {{ label: string, tone: 'teal' | 'green' | 'neutral' } | null}
 */
export function offTagOf({ presence, day }) {
  if (presence === 'holiday') return { label: 'Holiday', tone: 'green' };
  if (presence === 'day_off') return { label: 'Day off', tone: 'neutral' };
  if (presence !== 'on_leave') return null;
  return {
    label: day?.leave?.part === 'first_half' ? 'On leave, first half' : 'On leave',
    tone: 'teal',
  };
}

/**
 * The Report column for someone with a row. Submitted when today's report is submitted; Not
 * checked in without a check-in, or 'off' (shown as a dash) for someone off today. For someone
 * who checked in without submitting: before today's report time (settings.reportReminderAt) it
 * is still Due, or Draft once they started one; from the report time on it is Missing (a draft
 * too, like the "Reports submitted" number).
 * @returns {'submitted'|'draft'|'due'|'missing'|'not_checked_in'|'off'}
 */
function boardReportStatus({ checkedIn, reportStatus, off }, due) {
  if (reportStatus === 'submitted') return 'submitted';
  if (!checkedIn) return off ? 'off' : 'not_checked_in';
  if (!due.before) return 'missing';
  return reportStatus === 'draft' ? 'draft' : 'due';
}

/**
 * One team board row. Logged is the submitted report's total. reportLabel is the Report cell's
 * words when they aren't the status's own ('Due 6:30 PM'). offTag is the Off today group's tag
 * (offTagOf) and lateMinutes the effective late (CONTRACT 25). onBreak, breakSince and workingOn
 * are the live status (CONTRACT 15). todo is today's to-do (CONTRACT 24, null without lines) and
 * noTodo says "No to-do yet": checked in, report not submitted, no lines. Projects are the
 * submitted report's projects with hours; before submit only the running timer's project shows
 * (workingOn), so planned projects never read as worked.
 */
export function boardRow(row, labels, ctx, live) {
  const checkedIn = Boolean(row.attendanceId);
  const submitted = row.reportStatus === 'submitted';
  const lateMinutes = Number(row.lateMinutes ?? 0);
  const group = groupOf(row);
  const report = boardReportStatus(
    { checkedIn, reportStatus: row.reportStatus, off: group === 'off' },
    ctx.due,
  );
  const todo = row.reportId ? todoFor(row, ctx, live) : null;
  return {
    id: row.id,
    name: row.name,
    initials: initials(row.name),
    designation: row.designation,
    role: row.role,
    avatarUrl: row.avatarUrl,
    href: `/team/${row.id}`,
    group,
    offTag: group === 'off' ? offTagOf(row) : null,
    checkInAt: isoOrNull(row.checkInAt),
    checkOutAt: isoOrNull(row.checkOutAt),
    checkIn: checkedIn ? formatTime(row.checkInAt, ctx.tz) : null,
    officeVerified: checkedIn ? Boolean(row.officeVerified) : null,
    lateMinutes,
    late: lateMinutes > 0 ? `Late ${formatDuration(lateMinutes)}` : null,
    loggedMinutes: submitted ? Number(row.totalMinutes ?? 0) : 0,
    logged: submitted ? formatDuration(row.totalMinutes) : checkedIn ? formatDuration(0) : '—',
    report,
    reportLabel: report === 'due' ? `Due ${ctx.due.label}` : null,
    projects: submitted ? (labels.get(row.reportId) ?? []) : [],
    todo,
    noTodo: checkedIn && !submitted && !todo,
    ...liveStatus(row.id, live),
  };
}

/** The person's to-do from today's report lines, with "Now" from their running timer. */
function todoFor(row, ctx, live) {
  return todoOf(live.lines.get(row.reportId) ?? [], {
    today: ctx.today,
    tz: ctx.tz,
    timer: live.timers.get(row.id) ?? null,
    posting: live.posting,
    postedAt: live.postedAt.get(row.reportId) ?? null,
  });
}

/** On break since when, and the running timer's project (CONTRACT 15). */
function liveStatus(userId, live) {
  const breakSince = live.breaks.get(userId) ?? null;
  const timer = live.timers.get(userId);
  return {
    onBreak: Boolean(breakSince),
    breakSince: isoOrNull(breakSince),
    workingOn: timer ? { name: timer.name, color: timer.color, note: timer.note ?? null } : null,
  };
}

export function matchesFilter(row, filter) {
  if (filter === 'missing') return row.report === 'missing';
  if (filter === 'late') return row.lateMinutes > 0;
  if (filter === 'no-todo') return row.noTodo;
  return true;
}

/** Project labels of each submitted report (one per project, in report order). */
export function labelsByReport(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.reportId) ?? [];
    if (!list.some((item) => item.name === row.name))
      list.push({ name: row.name, color: row.color });
    map.set(row.reportId, list);
  }
  return map;
}
