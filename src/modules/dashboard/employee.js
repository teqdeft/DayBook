// Employee detailed view (artboard 06): profile and five numbers for a range, the month
// attendance calendar, hours by project, tasks to watch (stuck tasks) and the report history.
// The person's day (CONTRACT 25) adds holidays and leave to the calendar and the history, and
// a holiday never makes a task older. PMs see this page, so leave never carries its type or pay.
import { AppError } from '@/lib/errors';
import {
  addDays,
  eachDay,
  formatClock,
  formatClockShort,
  formatDateLong,
  formatDayMonthShort,
  formatHours,
  monthOf,
  monthRange,
  toLocal,
  weekRange,
  workDate,
} from '@/lib/time';
import { initials } from '@/lib/text';
import { attendance as attendanceModule } from '@/modules/attendance';
import { buildCalendar, calendarTitle } from './calendar';
import { holidaysSince, tasksToWatch } from './employeeTasks';
import { buildHistory } from './history';
import * as repo from './repo';
import {
  hoursBars,
  loadContext,
  loadDashboardCalendar,
  reportDue,
  showsAdmins,
  totalMinutes,
} from './shared';
import { todoToday } from './todo';

export const DETAIL_RANGES = ['week', 'month', 'custom'];
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

function localMinutes(at, tz) {
  const local = toLocal(at, tz);
  return local.hour() * 60 + local.minute();
}

function clockOf(minutes) {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * The five numbers of the profile card for the period (build guide 7.10). Late days count the
 * effective late (CONTRACT 25: never on a holiday or a full day of leave).
 */
function periodStats({ attendance, reports, hoursRows, period, ctx, dayOf }) {
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
    lateDays: inRange.filter(
      (a) => attendanceModule.effectiveLateMinutes({ row: a, day: dayOf(a.workDate) }) > 0,
    ).length,
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
 * The page's reads for one person, in parallel (each one query; the calendar three), then the
 * holidays since the oldest open task's first report. `dayOf` is the person's day (holidays and
 * leave as { id, part } only: never the type or pay, PMs see this page).
 */
async function loadDetail({ person, period, monthDays, ctx }) {
  const userId = person.id;
  const spanFrom = min(period.from, monthDays.from);
  const spanTo = max(period.to, monthDays.to);
  const historyTo = period.end >= period.from ? period.end : addDays(period.from, -1);
  const [attendance, reports, entries, revisions, requests, hoursRows, openTasks, todo, calendar] =
    await Promise.all([
      repo.listAttendance(userId, spanFrom, spanTo),
      repo.listReports(userId, spanFrom, spanTo),
      repo.listReportEntries(userId, period.from, historyTo),
      repo.listRevisions(userId, period.from, historyTo),
      repo.listOpenEditRequests(userId, period.from, historyTo),
      repo.hoursByProject({ from: period.from, to: period.end, userId }),
      repo.listOpenTasks(userId, addDays(ctx.today, -TASK_LOOKBACK_DAYS)),
      todoToday(person, ctx),
      loadDashboardCalendar({ from: spanFrom, to: spanTo }),
    ]);
  return {
    attendance,
    reports,
    entries,
    revisions,
    requests,
    hoursRows,
    openTasks,
    todo,
    holidays: await holidaysSince(openTasks, ctx.today),
    days: historyTo >= period.from ? eachDay(period.from, historyTo) : [],
    dayOf: (date) => calendar.dayFor(person, date),
  };
}

/**
 * The Employee detailed view for one person.
 * @param {{ userId: number, viewer?: { role: string }, range?: 'week'|'month'|'custom',
 *   from?: string, to?: string }} options  custom needs from <= to (checked by the schema);
 *   viewer is the signed-in person (none = a system read, sees everyone)
 * @returns {Promise<object>} { person, attendanceNote, period, stats, calendar, hours, tasks,
 *   todoToday, history, historyEmptyText, exportHref }. `attendanceNote` ({ title, body }) is set
 *   only for someone who doesn't check in (a PM, or tracking turned off): the page shows it
 *   instead of the attendance numbers, and `calendar.empty` instead of a month without check-ins.
 *   `todoToday` is today's to-do (see todoToday(), null for someone who doesn't write reports);
 *   history tasks carry `closedNote` ("Marked done on Thu, 12 Nov" | null). CONTRACT 25: the
 *   calendar has the tones holiday and leave (also for days to come), history rows show holiday
 *   and leave days (where 'holiday' | 'on_leave' with `whereNote`, report 'off' on a day the
 *   person wasn't expected), and holidays don't age tasks; nothing carries the leave type or pay.
 * @throws NOT_FOUND when the person doesn't exist, or is an Admin and the viewer isn't (an
 *   Admin's attendance is shown to Admins only)
 */
export async function getEmployeeDetail({ userId, viewer, range = 'month', from, to }) {
  const loaded = await loadContext();
  const ctx = { ...loaded, due: reportDue(loaded) };
  const person = await repo.findPerson(userId);
  if (!person || (person.role === 'admin' && !showsAdmins(viewer))) {
    throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  }
  const period = detailPeriod({ range, from, to }, ctx.today);
  const month = monthOf(period.end < period.from ? period.from : period.end);
  const monthDays = monthRange(month);
  const data = await loadDetail({ person, period, monthDays, ctx });
  const { attendance, reports, hoursRows, dayOf } = data;
  const profile = profileOf(person, ctx);
  const attendanceNote = attendanceNoteOf(profile);
  const total = totalMinutes(hoursRows);
  const hoursLabel = period.key === 'week' ? 'This week' : period.label;
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
    stats: periodStats({ attendance, reports, hoursRows, period, ctx, dayOf }),
    calendar: {
      ...buildCalendar({ month, attendance, profile, ctx, dayOf }),
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
    tasks: tasksToWatch(data.openTasks, ctx, data.holidays),
    todoToday: data.todo,
    history: buildHistory({
      days: data.days,
      attendance,
      reports,
      entries: data.entries,
      revisions: data.revisions,
      requests: data.requests,
      profile,
      ctx,
      dayOf,
    }),
    historyEmptyText: attendanceNote
      ? 'No check-ins or reports in this range.'
      : 'No working days in this range yet.',
    exportHref: `/api/exports/hours?from=${period.from}&to=${period.end < period.from ? period.from : period.end}&userId=${person.id}`,
  };
}
