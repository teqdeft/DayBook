// Ask Daybook's attendance_summary tool (CONTRACT 20): per person, the numbers of the Attendance
// screen over a date range. Only people whose attendance the viewer sees (scope.js): never an
// Admin's for anyone but an Admin (CONTRACT 16), and for a PM only the people on their projects.
import {
  addDays,
  dayjs,
  eachDay,
  formatClock,
  formatDuration,
  formatTimeAmPm,
  isWorkingDay,
  toLocal,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { NOT_ALLOWED } from './handlers';
import * as repo from './repo';
import { capRows, optionalText, parseRange } from './schemas';
import { resolveName } from './scope';

/** One person over at most this many days also gets each day listed. */
const DAY_LIST_MAX = 31;

const OUT_STATUS = {
  open: 'Still checked in',
  missing: 'Missing check-out',
  auto: 'Auto check-out',
  corrected: 'Corrected by HR',
};

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
 * Working days in the range, from the day the person joined, up to yesterday (today isn't over),
 * on which they have no attendance row.
 */
function daysWithoutCheckIn(person, rows, { from, to }, ctx) {
  const start = person.joinedOn && person.joinedOn > from ? person.joinedOn : from;
  const end = to < ctx.today ? to : addDays(ctx.today, -1);
  if (start > end) return 0;
  const present = new Set(rows.map((row) => row.workDate));
  return eachDay(start, end).filter(
    (day) => isWorkingDay(day, ctx.workingDays) && !present.has(day),
  ).length;
}

/** One day's line for a single person's short range. */
function dayLine(row, breaks, ctx) {
  const worked = attendance.workedMinutes(row, breaks, ctx.at, ctx.tz);
  const breakMinutes = attendance.breakMinutesWithin(breaks, row, ctx.at, ctx.tz);
  return {
    date: row.workDate,
    where: row.location === 'wfh' ? 'Work from home' : 'Office',
    checkIn: formatTimeAmPm(row.checkInAt, ctx.tz),
    checkOut: row.checkOutAt ? formatTimeAmPm(row.checkOutAt, ctx.tz) : null,
    ...(OUT_STATUS[row.checkoutStatus] ? { checkOutNote: OUT_STATUS[row.checkoutStatus] } : {}),
    late: row.lateMinutes > 0 ? formatDuration(row.lateMinutes) : null,
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
  const late = rows.filter((row) => row.lateMinutes > 0);
  const lateMinutes = late.reduce((total, row) => total + row.lateMinutes, 0);
  const count = (status) => rows.filter((row) => row.checkoutStatus === status).length;
  return {
    person: person.name,
    daysCheckedIn: rows.length,
    officeDays: rows.filter((row) => row.location !== 'wfh').length,
    workFromHomeDays: rows.filter((row) => row.location === 'wfh').length,
    lateDays: late.length,
    lateTotal: formatDuration(lateMinutes),
    lateMinutes,
    worked: formatDuration(worked),
    workedMinutes: worked,
    breaks: formatDuration(breakTotal),
    averageCheckIn: averageClock(rows, ctx.tz),
    missingCheckOuts: count('missing'),
    autoCheckOuts: count('auto'),
    workingDaysWithoutCheckIn: daysWithoutCheckIn(person, rows, range, ctx),
  };
}

/**
 * attendance_summary { from, to, personName? }.
 * @param {object} args Gemini's arguments
 * @param {{ scope: object, tz: string, today: string, at: import('dayjs').Dayjs,
 *   workingDays: number[] }} ctx at = now (open rows count up to it)
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
  const [rows, breaks] = await Promise.all([
    repo.listAttendance({ ...range, userIds }),
    repo.listBreaks({ ...range, userIds }),
  ]);
  const rowsByUser = groupBy(rows, 'userId');
  const breaksByRow = groupBy(breaks, 'attendanceId');
  const summaries = people.map((person) =>
    summarize(person, rowsByUser.get(person.id) ?? [], breaksByRow, range, ctx),
  );
  const { rows: shown, truncated } = capRows(summaries);
  const days = dayjs.utc(range.to).diff(dayjs.utc(range.from), 'day') + 1;
  const single = people.length === 1 && days <= DAY_LIST_MAX;
  return {
    from: range.from,
    to: range.to,
    ...(scope.kind === 'pm' ? { scope: 'Only people on projects you manage.' } : {}),
    people: shown,
    ...(single
      ? {
          days: (rowsByUser.get(people[0].id) ?? []).map((row) =>
            dayLine(row, breaksByRow.get(row.id) ?? [], ctx),
          ),
        }
      : {}),
    ...(truncated ? { truncated } : {}),
    ...(people.length === 0 ? { note: 'There is nobody whose attendance you can see.' } : {}),
  };
}
