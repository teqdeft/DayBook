// Ask Daybook's attendance_summary tool (CONTRACT 20): per person, the numbers of the Attendance
// screen over a date range. Only people whose attendance the viewer sees (scope.js): never an
// Admin's for anyone but an Admin (CONTRACT 16), and for a PM only the people on their projects.
// The person's day (CONTRACT 25): holidays and leave are never days without a check-in, late is
// the effective late, and the leave type and pay never reach Gemini (no leaveDetail).
import {
  addDays,
  dayjs,
  eachDay,
  formatClock,
  formatDuration,
  formatTimeAmPm,
  toLocal,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { NOT_ALLOWED } from './handlers';
import * as repo from './repo';
import { capRows, optionalText, parseRange } from './schemas';
import { resolveName } from './scope';

/** One person over at most this many days also gets each day listed. */
const DAY_LIST_MAX = 31;
/** At most this many company holidays are listed. */
const HOLIDAYS_MAX = 50;

const OUT_STATUS = {
  open: 'Still checked in',
  missing: 'Missing check-out',
  auto: 'Auto check-out',
  // A person may enter their own missing check-out now (CONTRACT 25), so not "by HR".
  corrected: 'Corrected',
};
const ENTERED_BY_PERSON = 'Entered by the person';

/** Rows by the value of one field: Map(value → rows, in order). */
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]);
    if (list) list.push(row);
    else map.set(row[key], [row]);
  }
  return map;
}

/** '9:42 AM': the average local check-in clock of some rows. */
function averageClock(rows, tz) {
  if (rows.length === 0) return null;
  const minutes = rows.map((row) => {
    const local = toLocal(row.checkInAt, tz);
    return local.hour() * 60 + local.minute();
  });
  const average = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
  const clock = `${String(Math.floor(average / 60)).padStart(2, '0')}:${String(average % 60).padStart(2, '0')}`;
  return formatClock(clock);
}

/**
 * The days the person was expected without a check-in, in the range up to yesterday (today isn't
 * over): the sum of their day's `expected` (CONTRACT 25), so holidays, full-day leave and days
 * before joining count 0 and a half-day leave no-show 0.5.
 */
function daysWithoutCheckIn(person, rows, { from, to }, ctx) {
  const end = to < ctx.today ? to : addDays(ctx.today, -1);
  if (from > end) return 0;
  const present = new Set(rows.map((row) => row.workDate));
  return eachDay(from, end)
    .filter((day) => !present.has(day))
    .reduce((sum, day) => sum + ctx.calendar.dayFor(person, day).expected, 0);
}

/** Leave days in the range (a half day 0.5); a check-in on a full day of leave counts present. */
function leaveDaysOf(person, rows, { from, to }, ctx) {
  const byDate = new Map(rows.map((row) => [row.workDate, row]));
  return eachDay(from, to).reduce((sum, day) => {
    const counts = attendance.dayCounts({
      day: ctx.calendar.dayFor(person, day),
      row: byDate.get(day) ?? null,
      past: day < ctx.today,
    });
    return sum + counts.leave;
  }, 0);
}

/** The late minutes a row counts with: 0 on a day without a late mark (CONTRACT 25). */
function lateOf(row, person, ctx) {
  return attendance.effectiveLateMinutes({ row, day: ctx.calendar.dayFor(person, row.workDate) });
}

/** "Entered by the person" for a check-out they typed themselves, else the status words. */
function checkOutNoteOf(row, ctx) {
  if (ctx.entered?.get(row.id)?.self) return ENTERED_BY_PERSON;
  return OUT_STATUS[row.checkoutStatus] ?? null;
}

/** One day's line for a single person's short range. */
function dayLine(row, breaks, ctx) {
  const worked = attendance.workedMinutes(row, breaks, ctx.at, ctx.tz);
  const breakMinutes = attendance.breakMinutesWithin(breaks, row, ctx.at, ctx.tz);
  const note = checkOutNoteOf(row, ctx);
  const late = lateOf(row, ctx.person, ctx);
  return {
    date: row.workDate,
    where: row.location === 'wfh' ? 'Work from home' : 'Office',
    checkIn: formatTimeAmPm(row.checkInAt, ctx.tz),
    checkOut: row.checkOutAt ? formatTimeAmPm(row.checkOutAt, ctx.tz) : null,
    ...(note ? { checkOutNote: note } : {}),
    late: late > 0 ? formatDuration(late) : null,
    worked: formatDuration(worked),
    ...(breakMinutes > 0 ? { breaks: formatDuration(breakMinutes) } : {}),
  };
}

function summarize(person, rows, breaksByRow, range, ctx) {
  let worked = 0;
  let breakTotal = 0;
  for (const row of rows) {
    const breaks = breaksByRow.get(row.id) ?? [];
    worked += attendance.workedMinutes(row, breaks, ctx.at, ctx.tz);
    breakTotal += attendance.breakMinutesWithin(breaks, row, ctx.at, ctx.tz);
  }
  const lates = rows.map((row) => lateOf(row, person, ctx)).filter((minutes) => minutes > 0);
  const lateMinutes = lates.reduce((total, minutes) => total + minutes, 0);
  const count = (status) => rows.filter((row) => row.checkoutStatus === status).length;
  return {
    person: person.name,
    daysCheckedIn: rows.length,
    officeDays: rows.filter((row) => row.location !== 'wfh').length,
    workFromHomeDays: rows.filter((row) => row.location === 'wfh').length,
    lateDays: lates.length,
    lateTotal: formatDuration(lateMinutes),
    lateMinutes,
    worked: formatDuration(worked),
    workedMinutes: worked,
    breaks: formatDuration(breakTotal),
    averageCheckIn: averageClock(rows, ctx.tz),
    missingCheckOuts: count('missing'),
    autoCheckOuts: count('auto'),
    workingDaysWithoutCheckIn: daysWithoutCheckIn(person, rows, range, ctx),
    leaveDays: leaveDaysOf(person, rows, range, ctx),
  };
}

/**
 * The reads of one summary: attendance rows and breaks of the people, their calendar (holidays
 * and leave: never the type or pay) and, for one person's day list, who entered each check-out.
 */
async function loadRange({ range, userIds, single }) {
  const [rows, breaks, calendar] = await Promise.all([
    repo.listAttendance({ ...range, userIds }),
    repo.listBreaks({ ...range, userIds }),
    attendance.loadCalendar({ ...range, userIds, withWfh: false }),
  ]);
  const entered = single ? await attendance.checkoutEnteredFor(rows.map((row) => row.id)) : null;
  return { rows, breaks, calendar, entered };
}

/**
 * attendance_summary { from, to, personName? }.
 * @param {object} args Gemini's arguments
 * @param {{ scope: object, tz: string, today: string, at: import('dayjs').Dayjs,
 *   workingDays: number[] }} ctx at = now (open rows count up to it)
 * @returns {Promise<object>} { from, to, scope?, people, holidays: [{ date, name }] (at most
 *   50), days?, truncated?, note? }; each person adds leaveDays, and workingDaysWithoutCheckIn
 *   sums the days they were expected (CONTRACT 25)
 */
export async function attendanceSummary(args, ctx) {
  const { scope } = ctx;
  if (!scope.attendance) return NOT_ALLOWED;
  const range = parseRange(args);
  if (range.error) return range;
  let people = scope.attendancePeople;
  const name = optionalText(args?.personName);
  if (name) {
    const found = resolveName(scope.attendancePeople, name, 'person');
    if (found.error) return found;
    people = [found.item];
  }
  const userIds = people.map((person) => person.id);
  const length = dayjs.utc(range.to).diff(dayjs.utc(range.from), 'day') + 1;
  const single = people.length === 1 && length <= DAY_LIST_MAX;
  const { rows, breaks, calendar, entered } = await loadRange({ range, userIds, single });
  const rowsByUser = groupBy(rows, 'userId');
  const breaksByRow = groupBy(breaks, 'attendanceId');
  const counting = { ...ctx, calendar, entered };
  const summaries = people.map((person) =>
    summarize(person, rowsByUser.get(person.id) ?? [], breaksByRow, range, counting),
  );
  const { rows: shown, truncated } = capRows(summaries);
  const holidays = [...calendar.holidays]
    .map(([date, holiday]) => ({ date, name: holiday.name }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, HOLIDAYS_MAX);
  return {
    from: range.from,
    to: range.to,
    ...(scope.kind === 'pm' ? { scope: 'Only people on projects you manage.' } : {}),
    people: shown,
    holidays,
    ...(single
      ? {
          days: (rowsByUser.get(people[0].id) ?? []).map((row) =>
            dayLine(row, breaksByRow.get(row.id) ?? [], { ...counting, person: people[0] }),
          ),
        }
      : {}),
    ...(truncated ? { truncated } : {}),
    ...(people.length === 0 ? { note: 'There is nobody whose attendance you can see.' } : {}),
  };
}
