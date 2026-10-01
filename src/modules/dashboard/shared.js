// Helpers shared by the dashboard services: the request context (settings, today, now), date
// ranges, the section 7.10 day summary, and view-model pieces used on more than one screen.
import {
  clockToMinutes,
  dayjs,
  formatClockShort,
  formatDay,
  formatDayMonthShort,
  formatHours,
  formatTime,
  formatTimeAmPm,
  monthOf,
  monthRange,
  now,
  weekRange,
  workDate,
} from '@/lib/time';
import { plural } from '@/lib/text';
import { settings } from '@/modules/settings';

/** Settings, time zone, the current moment and today's company date for one request. */
export async function loadContext() {
  const all = await settings.getAll();
  const tz = all.timezone;
  const at = now();
  return { settings: all, tz, now: at, today: workDate(tz, at) };
}

/** 'Wednesday, 30 September, 6:52 PM' (the dashboards' top bar subtitle). */
export function nowSubtitle(ctx) {
  return `${formatDay(ctx.today)}, ${formatTimeAmPm(ctx.now, ctx.tz)}`;
}

/**
 * Week (Monday to today) or month (the 1st to today) ending today.
 * @param {'week'|'month'} key
 * @param {string} today
 */
export function periodFor(key, today) {
  if (key === 'month') return { key: 'month', from: monthRange(monthOf(today)).from, to: today };
  return { key: 'week', from: weekRange(today).from, to: today };
}

/** Percentage 0-100 with one decimal, 0 when there is nothing to divide by. */
export function percent(part, whole) {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 1000) / 10));
}

/** '1 person' / '26 people' */
export function people(count) {
  return `${count} ${plural(count, 'person', 'people')}`;
}

/**
 * The day's numbers exactly as build guide section 7.10 counts them, from the rows of
 * listTrackedPeopleDay (active people with tracks_attendance = 1 who had joined by that day):
 * checked in = rows with attendance; WFH = of those, location wfh; late = of those,
 * late_minutes > 0, averaged over late rows only; reports submitted = submitted reports among
 * the people who checked in.
 */
export function summarizeDay(rows) {
  const present = rows.filter((row) => row.attendanceId);
  const wfh = present.filter((row) => row.location === 'wfh').length;
  const late = present.filter((row) => Number(row.lateMinutes) > 0);
  const lateTotal = late.reduce((sum, row) => sum + Number(row.lateMinutes), 0);
  const submitted = present.filter((row) => row.reportStatus === 'submitted').length;
  return {
    tracked: rows.length,
    checkedIn: present.length,
    office: present.length - wfh,
    wfh,
    notCheckedIn: rows.length - present.length,
    late: {
      count: late.length,
      averageMinutes: late.length ? Math.round(lateTotal / late.length) : 0,
    },
    reports: { submitted, of: present.length, missing: present.length - submitted },
  };
}

/** The "Reports submitted" number card: '21' 'of 24, due 6:30'. */
export function reportsKpi(summary, ctx) {
  return {
    key: 'reports',
    label: 'Reports submitted',
    value: String(summary.reports.submitted),
    sub: `of ${summary.reports.of}, due ${formatClockShort(ctx.settings.reportReminderAt)}`,
    percent: percent(summary.reports.submitted, summary.reports.of),
    color: 'green',
  };
}

/** The "Checked in" / "In today" number card: '24' 'of 26 people'. */
export function checkedInKpi(summary, label) {
  return {
    key: 'checkedIn',
    label,
    value: String(summary.checkedIn),
    sub: `of ${people(summary.tracked)}`,
    percent: percent(summary.checkedIn, summary.tracked),
    color: 'primary',
  };
}

const MAX_BARS = 8;

/**
 * Hours-by-project rows as HBarList rows, largest first. More than eight projects show the top
 * seven and one "N more projects" row. Hours from a pending project request carry "(requested)".
 * Hours are logged in quarter hours, so they show exactly ('5.25h', never a rounded '5.3h').
 */
export function hoursBars(rows) {
  const shown = rows.length > MAX_BARS ? rows.slice(0, MAX_BARS - 1) : rows;
  const rest = rows.slice(shown.length);
  const bars = shown.map((row) => ({
    key: row.projectId ? `p${row.projectId}` : `r${row.requestId}`,
    label: row.projectId ? row.name : `${row.name} (requested)`,
    value: row.minutes,
    display: formatHours(row.minutes),
    color: row.projectId ? (row.color ?? 'blue') : 'muted',
  }));
  if (rest.length) {
    const minutes = rest.reduce((sum, row) => sum + row.minutes, 0);
    bars.push({
      key: 'more',
      label: `${rest.length} more projects`,
      value: minutes,
      display: formatHours(minutes),
      color: 'muted',
    });
  }
  return bars;
}

/** Total minutes of hours-by-project rows. */
export function totalMinutes(rows) {
  return rows.reduce((sum, row) => sum + row.minutes, 0);
}

/** '11:05' when marked today, otherwise '29 Sep'. */
function markedWhen(at, ctx) {
  if (!at) return null;
  return workDate(ctx.tz, at) === ctx.today
    ? formatTime(at, ctx.tz)
    : formatDayMonthShort(workDate(ctx.tz, at));
}

function onIt(count) {
  if (!count) return 'nobody on it yet';
  return `${people(count)} on it`;
}

/**
 * Urgent projects for the dashboards. `by: 'members'` gives 'Marked 11:05, 2 people on it'
 * (Team dashboard); `by: 'marker'` gives 'Marked 11:05 by [PM name]' (Company overview).
 */
export function urgentItems(rows, ctx, by = 'members') {
  return rows.map((row) => {
    const when = markedWhen(row.urgentMarkedAt, ctx);
    const marked = when ? `Marked ${when}` : 'Marked urgent';
    const memberCount = Number(row.memberCount ?? 0);
    const meta =
      by === 'marker'
        ? row.urgentMarkedByName
          ? `${marked} by ${row.urgentMarkedByName}`
          : marked
        : `${marked}, ${onIt(memberCount)}`;
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      note: row.urgentNote ?? '',
      markedAt: isoOrNull(row.urgentMarkedAt),
      markedByName: row.urgentMarkedByName ?? null,
      memberCount,
      meta,
    };
  });
}

/** Minutes of the working day from settings (office start to end), at least one hour. */
export function officeDayMinutes(all) {
  return Math.max(60, clockToMinutes(all.officeEnd) - clockToMinutes(all.officeStart));
}

/** A DATETIME value as an ISO string (serialisable for client components and the API). */
export function isoOrNull(value) {
  return value ? dayjs(value).toISOString() : null;
}
