// Employee detailed view (artboard 06): profile and five numbers for a range, the month
// attendance calendar, hours by project, tasks to watch (stuck tasks) and the report history.
import { AppError } from '@/lib/errors';
import {
  addDays,
  eachDay,
  formatClock,
  formatClockShort,
  formatDateLong,
  formatDayMonthShort,
  formatHours,
  isWorkingDay,
  monthOf,
  monthRange,
  toLocal,
  weekRange,
  workDate,
  workingDaysBetween,
} from '@/lib/time';
import { initials, plural } from '@/lib/text';
import { buildCalendar, calendarTitle } from './calendar';
import { buildHistory } from './history';
import * as repo from './repo';
import { hoursBars, loadContext, totalMinutes } from './shared';

export const DETAIL_RANGES = ['week', 'month', 'custom'];
// Tasks in progress this many working days (after the first) are listed even before they are
// stuck, as on the canvas ("In progress 3 days" in grey).
const WATCH_AFTER_DAYS = 2;
// Only tasks whose latest version was reported in the last 30 days are considered.
const TASK_LOOKBACK_DAYS = 30;

const min = (a, b) => (a < b ? a : b);
const NBSP = String.fromCharCode(0xa0);
const keepTogether = (text) => text.replaceAll(' ', NBSP);
const max = (a, b) => (a > b ? a : b);

/**
 * The range the page shows. week = Monday to Sunday of this week, month = this calendar month,
 * custom = from..to. `end` is the last day with data (never after today).
 */
export function detailPeriod({ range = 'month', from, to } = {}, today) {
  let period;
  if (range === 'week') period = { key: 'week', ...weekRange(today), label: 'This week' };
  else if (range === 'custom' && from && to && from <= to) {
    // Each date stays on one line ('1 Sep' never breaks) when the label wraps.
    const label = `${keepTogether(formatDayMonthShort(from))} to ${keepTogether(formatDayMonthShort(to))}`;
    period = { key: 'custom', from, to, label };
  } else {
    const month = monthOf(today);
    period = { key: 'month', ...monthRange(month), label: calendarTitle(month, today) };
  }
  return { ...period, end: min(period.to, today) };
}

/**
 * Working days a task has been in progress, counting the day it was first reported (the canvas
 * shows "In progress 6 days" for a task first reported on Wed 23 and viewed on Wed 30).
 */
export function daysInProgress(firstReportedOn, today, workingDays) {
  if (!firstReportedOn || firstReportedOn > today) return 0;
  const first = isWorkingDay(firstReportedOn, workingDays) ? 1 : 0;
  return workingDaysBetween(firstReportedOn, today, workingDays) + first;
}

/**
 * Build guide 7.5: a task is stuck when it is still in progress and at least `stuckTaskDays`
 * working days have passed since first_reported_on (the first day itself not counted).
 */
export function isStuckTask(firstReportedOn, today, workingDays, stuckTaskDays) {
  if (!firstReportedOn || firstReportedOn > today) return false;
  return workingDaysBetween(firstReportedOn, today, workingDays) >= stuckTaskDays;
}

function tasksToWatch(rows, ctx) {
  const { workingDays, stuckTaskDays } = ctx.settings;
  const listFrom = Math.min(WATCH_AFTER_DAYS, stuckTaskDays);
  const items = rows
    .map((row) => {
      const passed = workingDaysBetween(row.firstReportedOn, ctx.today, workingDays);
      const days = daysInProgress(row.firstReportedOn, ctx.today, workingDays);
      return {
        id: row.id,
        title: row.title,
        project: { name: row.projectName, color: row.color },
        firstReportedOn: row.firstReportedOn,
        lastReportedOn: row.workDate,
        passed,
        days,
        stuck: isStuckTask(row.firstReportedOn, ctx.today, workingDays, stuckTaskDays),
        label: `In progress ${days} ${plural(days, 'day')}`,
      };
    })
    .filter((item) => item.passed >= listFrom)
    .sort((a, b) => b.days - a.days || a.id - b.id);
  return {
    stuckTaskDays,
    subtitle: `In progress for ${stuckTaskDays} ${plural(stuckTaskDays, 'day')} or more are flagged`,
    stuckCount: items.filter((item) => item.stuck).length,
    emptyText: `No task has been in progress for ${listFrom + 1} working days or more.`,
    items: items.map(({ passed: _passed, ...item }) => item),
  };
}

function localMinutes(at, tz) {
  const local = toLocal(at, tz);
  return local.hour() * 60 + local.minute();
}

function clockOf(minutes) {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** The five numbers of the profile card for the period (build guide 7.10). */
function periodStats({ attendance, reports, hoursRows, period, ctx }) {
  const inRange = attendance.filter((a) => a.workDate >= period.from && a.workDate <= period.end);
  const working = inRange.filter((a) => a.isWorkingDay);
  const average = working.length
    ? Math.round(
        working.reduce((sum, a) => sum + localMinutes(a.checkInAt, ctx.tz), 0) / working.length,
      )
    : null;
  const submittedDays = new Set(
    reports.filter((r) => r.status === 'submitted').map((r) => r.workDate),
  );
  const loggedMinutes = totalMinutes(hoursRows);
  const loggedLabel =
    period.key === 'week'
      ? 'Logged this week'
      : period.key === 'month'
        ? `Logged in ${period.label}`
        : `Logged ${period.label}`;
  return {
    loggedMinutes,
    logged: formatHours(loggedMinutes),
    loggedLabel,
    averageCheckInMinutes: average,
    averageCheckIn: average === null ? '—' : formatClockShort(clockOf(average)),
    lateDays: inRange.filter((a) => Number(a.lateMinutes) > 0).length,
    wfhDays: inRange.filter((a) => a.location === 'wfh').length,
    reportsSubmitted: inRange.filter((a) => submittedDays.has(a.workDate)).length,
    reportsExpected: inRange.length,
  };
}

/**
 * What the page says about someone who doesn't check in, or null for everyone who does. Project
 * managers never check in or write daily reports (company rule); anyone else has tracking off.
 */
function attendanceNoteOf(profile) {
  if (profile.tracksAttendance) return null;
  return {
    title: "Doesn't check in",
    body:
      profile.role === 'pm'
        ? "Project managers don't check in or write daily reports."
        : "Their attendance isn't tracked.",
  };
}

function profileOf(person, ctx) {
  const { officeStart, officeEnd } = ctx.settings;
  const start = person.shiftStart ?? officeStart;
  const end = person.shiftEnd ?? officeEnd;
  const tracked = Boolean(person.tracksAttendance);
  const subtitle = [
    person.designation,
    person.reportsToName ? `reports to ${person.reportsToName}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: person.id,
    name: person.name,
    initials: initials(person.name),
    email: person.email,
    designation: person.designation,
    departmentName: person.departmentName,
    reportsToName: person.reportsToName,
    role: person.role,
    status: person.status,
    avatarUrl: person.avatarUrl,
    tracksAttendance: tracked,
    joinedOn: person.joinedOn,
    deactivatedOn: person.deactivatedAt ? workDate(ctx.tz, person.deactivatedAt) : null,
    joined: person.joinedOn ? `Joined ${formatDateLong(person.joinedOn)}` : null,
    // A shift only matters to someone who checks in (it sets when they are late).
    shift: tracked ? `Shift ${formatClock(start)} to ${formatClock(end)}` : null,
    subtitle: person.status === 'deactivated' ? `${subtitle}, deactivated` : subtitle,
  };
}

/**
 * The Employee detailed view for one person.
 * @param {{ userId: number, range?: 'week'|'month'|'custom', from?: string, to?: string }} options
 *   custom needs from <= to (checked by the schema).
 * @returns {Promise<object>} { person, attendanceNote, period, stats, calendar, hours, tasks,
 *   history, historyEmptyText, exportHref }. `attendanceNote` ({ title, body }) is set only for
 *   someone who doesn't check in (a PM, or tracking turned off): the page shows it instead of the
 *   attendance numbers, and `calendar.empty` instead of a month without check-ins.
 * @throws NOT_FOUND when the person doesn't exist
 */
export async function getEmployeeDetail({ userId, range = 'month', from, to }) {
  const ctx = await loadContext();
  const person = await repo.findPerson(userId);
  if (!person) throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  const period = detailPeriod({ range, from, to }, ctx.today);
  const month = monthOf(period.end < period.from ? period.from : period.end);
  const monthDays = monthRange(month);
  const spanFrom = min(period.from, monthDays.from);
  const spanTo = max(period.to, monthDays.to);
  const historyTo = period.end >= period.from ? period.end : addDays(period.from, -1);

  const [attendance, reports, entries, revisions, requests, hoursRows, openTasks] =
    await Promise.all([
      repo.listAttendance(userId, spanFrom, spanTo),
      repo.listReports(userId, spanFrom, spanTo),
      repo.listReportEntries(userId, period.from, historyTo),
      repo.listRevisions(userId, period.from, historyTo),
      repo.listOpenEditRequests(userId, period.from, historyTo),
      repo.hoursByProject({ from: period.from, to: period.end, userId }),
      repo.listOpenTasks(userId, addDays(ctx.today, -TASK_LOOKBACK_DAYS)),
    ]);
  const profile = profileOf(person, ctx);
  const attendanceNote = attendanceNoteOf(profile);
  const total = totalMinutes(hoursRows);
  const hoursLabel = period.key === 'week' ? 'This week' : period.label;
  const days = historyTo >= period.from ? eachDay(period.from, historyTo) : [];
  // Someone who doesn't check in gets a note instead of an empty calendar; check-ins from before
  // tracking was turned off still show.
  const monthHasAttendance = attendance.some(
    (row) => row.workDate >= monthDays.from && row.workDate <= monthDays.to,
  );

  return {
    date: ctx.today,
    now: ctx.now.toISOString(),
    timezone: ctx.tz,
    person: profile,
    attendanceNote,
    period,
    stats: periodStats({ attendance, reports, hoursRows, period, ctx }),
    calendar: {
      ...buildCalendar({ month, attendance, profile, ctx }),
      empty:
        attendanceNote && !monthHasAttendance
          ? { title: 'No attendance to show', body: attendanceNote.body }
          : null,
    },
    hours: {
      subtitle: `${hoursLabel}, ${formatHours(total)} in total`,
      totalMinutes: total,
      bars: hoursBars(hoursRows),
      rows: hoursRows,
    },
    tasks: tasksToWatch(openTasks, ctx),
    history: buildHistory({
      days,
      attendance,
      reports,
      entries,
      revisions,
      requests,
      profile,
      ctx,
    }),
    historyEmptyText: attendanceNote
      ? 'No check-ins or reports in this range.'
      : 'No working days in this range yet.',
    exportHref: `/api/exports/hours?from=${period.from}&to=${period.end < period.from ? period.from : period.end}&userId=${person.id}`,
  };
}
