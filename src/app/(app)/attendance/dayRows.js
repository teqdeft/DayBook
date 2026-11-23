// The Attendance day table's rows and the five number cards (artboard 09; CONTRACT 25: the
// person's day, the marks, "4th this month", who entered a check-out, on break). Server only
// (attendanceData.js calls it). Durations read as hours and minutes ("Late 1h 37m"), never a bare
// minute count past an hour. Rows the auto check-out closed carry `autoOut` (CONTRACT 19).
import {
  formatClock,
  formatDayShort,
  formatDuration,
  formatRelativeDay,
  formatTime,
  formatTimeAmPm,
  workDate as localDate,
} from '@/lib/time';
import { plural } from '@/lib/text';
import { LEAVE_TYPE_LABELS } from '@/modules/attendance/calendar';
import { actionFor } from './rowActions';

const LEAVE_LINES = { first_half: 'First half', second_half: 'Second half' };
const CHECKED_IN_LEAVE = {
  full: 'On leave',
  first_half: 'On leave, first half',
  second_half: 'On leave, second half',
};

const firstName = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] || name;

/**
 * The Present cell (CONTRACT 15): present time, or worked time (present less breaks) with a
 * "Breaks 45m" line and an "Over 15m" tag past the daily allowance once the person took breaks
 * ("Breaks 1h 2m", "Over 1h 15m" past an hour).
 */
export function presentOf(item) {
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

/** The Where cell's muted line and, for attendance.correct viewers, the leave's type and pay. */
function whereOf(item, { canCorrect }) {
  const { day, attendance: row } = item;
  const leave = day?.leave;
  let line = null;
  // "First half" under "On leave"; "On leave, first half" under a check-in, or under "Not
  // checked in" once the half on leave has passed (after the split, or before it on the second).
  if (leave && (row || item.where !== 'on_leave')) line = CHECKED_IN_LEAVE[leave.part];
  else if (leave) line = LEAVE_LINES[leave.part] ?? null;
  else if (!row && item.where === 'not_checked_in' && day?.wfhApproved) line = 'WFH approved';
  const title =
    canCorrect && leave?.leaveType
      ? `${LEAVE_TYPE_LABELS[leave.leaveType]} leave, ${leave.paid === false ? 'unpaid' : 'paid'}`
      : null;
  return { where: item.where, whereLine: line, whereTitle: title };
}

/** "Left 25m early" (the hidden minutes) with its title, or null. */
function earlyOf(item) {
  const marks = item.marks;
  if (!marks?.leftEarly) return null;
  const minutes = formatDuration(marks.leftEarlyMinutes);
  return {
    minutes,
    title: `Left ${minutes} before their shift ended at ${formatClock(item.day.dayEnd)}`,
  };
}

/** "By Priya" under the check-out, and HR's "Check" tag when it is past last seen. */
function enteredByOf(item, { tz, canCorrect }) {
  const entered = item.checkoutEnteredBy;
  if (!entered) return null;
  const name = firstName(entered.name);
  const day = entered.at ? formatDayShort(localDate(tz, entered.at)) : null;
  const out = item.attendance?.checkOutAt;
  let check = null;
  if (canCorrect && entered.self && entered.pastLastSeen && out) {
    const seen = entered.suggestedAt
      ? `Daybook last saw them working at ${formatTimeAmPm(entered.suggestedAt, tz)}.`
      : 'Daybook had no sign of work after the check-in.';
    check = { title: `${name} entered ${formatTimeAmPm(out, tz)}. ${seen}` };
  }
  return {
    name,
    title: day ? `${entered.name} entered this check-out on ${day}` : entered.name,
    check,
  };
}

/** The marigold "Half day" or "Short day" tag of the Present cell, or null. */
function markOf(item) {
  const marks = item.marks;
  if (!marks || (!marks.halfDay && !marks.shortDay)) return null;
  const worked = formatDuration(item.workedMinutes ?? 0);
  return {
    label: marks.halfDay ? 'Half day' : 'Short day',
    title: `Worked ${worked}, under ${formatDuration(marks.underMinutes ?? 0)}`,
  };
}

/** The Action column: RowAction, the row menu and the reminder line (HR and Admin only). */
function actionsOf(item, ctx) {
  if (!ctx.canCorrect || item.user.id === ctx.viewerId) return {};
  const remind = ctx.remind?.get(item.user.id) ?? null;
  const person = { id: item.user.id, name: item.user.name };
  return {
    action: actionFor(item, ctx),
    menu: {
      person,
      date: ctx.date,
      leave: item.day?.leave ?? null,
      remind: remind?.kind && !remind.nextAt ? { kind: remind.kind, user: person } : null,
      canMarkLeave: ctx.calendarAvailable,
    },
    reminder: remind?.reminded
      ? { reminded: remind.reminded, nextAt: remind.nextAt ?? null }
      : null,
  };
}

/**
 * One row of the Everyone table.
 * @param {object} item listDay() item
 * @param {{ date: string, today: string, dayLabel: string, tz: string, canCorrect: boolean,
 *   viewerId: number, month: string, lateCounts: object, remind: Map | null,
 *   calendarAvailable: boolean }} ctx
 */
export function tableRow(item, ctx) {
  const row = item.attendance;
  const lateCount = item.lateMinutes > 0 ? (ctx.lateCounts?.[item.user.id] ?? null) : null;
  return {
    id: item.user.id,
    user: item.user,
    personHref: ctx.canCorrect ? `/attendance/people/${item.user.id}?month=${ctx.month}` : null,
    ...whereOf(item, ctx),
    checkIn: row ? formatTime(row.checkInAt, ctx.tz) : null,
    late: item.lateMinutes > 0 ? `Late ${formatDuration(item.lateMinutes)}` : null,
    lateCount: lateCount
      ? { label: lateCount.label, title: lateCount.title, alert: Boolean(lateCount.alert) }
      : null,
    checkOut: row?.checkOutAt ? formatTime(row.checkOutAt, ctx.tz) : null,
    // Checked out by the auto check-out (no activity after office hours, CONTRACT 19).
    autoOut: Boolean(row?.checkOutAt) && row.checkoutStatus === 'auto',
    early: earlyOf(item),
    enteredBy: enteredByOf(item, ctx),
    missing: row?.checkoutStatus === 'missing',
    ...presentOf(item),
    onBreakSince: item.onBreakSince ? formatTime(item.onBreakSince, ctx.tz) : null,
    mark: markOf(item),
    // The Present cell opens the break list once the row has a break (CONTRACT 25, item 2).
    attendanceId: row && item.breakCount > 0 ? row.id : null,
    note: row?.note ?? null,
    // HR changes other people's rows; their own go through another HR person or an Admin.
    ...actionsOf(item, ctx),
  };
}

/** '/attendance?date=2026-09-29&filter=late' (today and "all" are left out). */
export function hrefFor({ date, today, filter }) {
  const params = new URLSearchParams();
  if (date && date !== today) params.set('date', date);
  if (filter && filter !== 'all') params.set('filter', filter);
  const query = params.toString();
  return query ? `/attendance?${query}` : '/attendance';
}

const PILL_LABELS = {
  all: 'All',
  late: 'Late',
  wfh: 'WFH',
  not_checked_in: 'Not checked in',
  on_leave: 'On leave',
  unverified: 'Unverified',
  on_break: 'On break',
};

/**
 * The Everyone card's filter pills. "On leave" and "On break" (today only) show when their count
 * is above 0 or they are the selected filter, so the pills fit beside the title at 1440 as
 * artboard 09's five do.
 * @param {{ summary: object, date: string, today: string, filter: string }} input
 */
export function pillsFor({ summary, date, today, filter }) {
  const counts = {
    all: summary.tracked,
    late: summary.late,
    wfh: summary.wfh,
    not_checked_in: summary.notCheckedIn,
    on_leave: summary.onLeave ?? 0,
    unverified: summary.unverified,
    on_break: summary.onBreak ?? 0,
  };
  const shown = (value) => {
    if (value === 'on_break' && date !== today) return false;
    if (value === 'on_leave' || value === 'on_break') return counts[value] > 0 || filter === value;
    return true;
  };
  return Object.keys(PILL_LABELS)
    .filter(shown)
    .map((value) => ({
      value,
      label: `${PILL_LABELS[value]} (${counts[value]})`,
      // The date switcher's links drop on_break; the pills keep the day.
      href: hrefFor({ date, today, filter: value }),
    }));
}

/** "average 26 minutes" (the artboard's words), "average 1h 37m" from an hour up. */
function averageLate(minutes) {
  return minutes < 60 ? `${minutes} ${plural(minutes, 'minute')}` : formatDuration(minutes);
}

/**
 * The five number cards. Present, In office, WFH and Late count over the people expected that
 * day (tracked less those off: leave, a holiday or a day off without a check-in), so HR's number
 * matches the Team board's. "Missing check-out" links to the full list, with "12 to fix in all"
 * when more are still to fix than it counts (CONTRACT 25, item 7).
 */
export function kpis(summary, date) {
  const total = summary.tracked || 0;
  const off = summary.off || 0;
  const expected = Math.max(0, total - off);
  const pct = (count) => (expected > 0 ? Math.min(100, (count / expected) * 100) : 0);
  const people = (count) => plural(count, 'person', 'people');
  // "1 from yesterday"; on a Monday "2 from Friday", or "3 since Friday" when the weekend had
  // missing check-outs too.
  const relative = formatRelativeDay(summary.missingFromDate, date) ?? 'Yesterday';
  const when = relative === 'Yesterday' || relative === 'Today' ? relative.toLowerCase() : relative;
  const toFix = summary.missingTotal ?? summary.missingCheckouts;
  return [
    {
      label: 'Present',
      value: summary.present,
      sub: off > 0 ? `of ${total} people, ${off} off` : `of ${total} people`,
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
      footer: toFix > summary.missingCheckouts ? `${toFix} to fix in all` : undefined,
      percent: total > 0 ? (summary.missingCheckouts / total) * 100 : 0,
      color: 'red',
      href: '/attendance/missing',
    },
  ];
}
