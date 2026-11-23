// The month's rules (CONTRACT 25, items 4, 8 and 10): one person's day of a period (MonthDay) and
// their month (MonthPerson), Needs a look and "4th". Pure: no database. summarizeRange (month.js)
// loads the period once and every reader (the month view, the month Excel, the person month,
// Needs a look, the late alert) counts with these, so they always agree.
// - Every count runs up to `through` (today at the latest), except workingDays and holidays,
//   which cover the whole period. Leave after `through` is leave.planned.
// - An open row from a day before today counts as a missing check-out (not fixed) with no present
//   or worked time, whether or not the midnight rule ran.
import { plural } from '@/lib/text';
import { dayCounts, effectiveLateMinutes, leaveFraction, presenceOf, whereOf } from './calendar';
import { dayMarks } from './marks';
import { breakMinutesWithin, presentMinutes } from './rules';

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "101st", "111th". */
export function ordinal(n) {
  const value = Math.trunc(Number(n) || 0);
  const tens = Math.abs(value) % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[Math.abs(value) % 10] ?? 'th';
  return `${value}${suffix}`;
}

/** An open row from a day before today: nobody knows when the person left. */
function isStaleOpen(row, date, today) {
  return Boolean(row) && row.checkoutStatus === 'open' && !row.checkOutAt && date < today;
}

function kindOf(day, date, through) {
  if (date > through) return 'future';
  if (day.isWorkingDay) return 'working';
  return day.holiday && day.weekday ? 'holiday' : 'day_off';
}

/** The Where of a day: the check-in's place, else why nobody checked in. */
function whereFor({ day, row, counts, date, today, at, tz }) {
  if (row) return whereOf(row);
  if (day.holiday && day.weekday) return 'holiday';
  if (!day.isWorkingDay || !day.employed) return 'day_off';
  if (date > today) return day.leave?.part === 'full' ? 'on_leave' : 'not_checked_in';
  if (date === today) return presenceOf({ day, row: null, at, tz });
  if (counts.absent > 0) return 'absent';
  return day.leave ? 'on_leave' : 'day_off'; // day_off: a leaver's last day, counted nowhere
}

function reportOf({ row, submitted, date, today, reportSelf, reportDue }) {
  if (!reportSelf) return null;
  if (submitted) return 'submitted';
  if (!row) return null;
  return date < today || reportDue ? 'not_submitted' : 'due';
}

function rowView(row) {
  const { id, checkInAt, checkOutAt, location, officeVerified, note, lateMinutes } = row;
  const { checkoutStatus, source } = row;
  return {
    id,
    checkInAt,
    checkOutAt,
    location,
    officeVerified,
    note,
    lateMinutes,
    checkoutStatus,
    source,
  };
}

function checkoutOf(row, { history, entered, stale }) {
  return {
    wasMissing: Boolean(row) && (history.missing || row.checkoutStatus === 'missing' || stale),
    auto: Boolean(row) && (history.auto || row.checkoutStatus === 'auto'),
    notFixed: Boolean(row) && (row.checkoutStatus === 'missing' || stale),
    enteredBy: entered
      ? { id: entered.id, name: entered.name, at: entered.at, self: entered.self }
      : null,
    pastLastSeen: Boolean(entered?.self && entered.pastLastSeen),
    suggestedAt: entered?.suggestedAt ?? null,
  };
}

/**
 * One person's day of a period (MonthDay).
 * @param {{ date: string, day: PersonDay, row?: object | null, breaks?: object[],
 *   history?: { missing: boolean, auto: boolean }, entered?: { id: number, name: string,
 *   at: Date, self: boolean, suggestedAt: Date | null, pastLastSeen: boolean } | null,
 *   submitted?: boolean, leaveNote?: string | null, ctx: { today: string, through: string,
 *   at: Date | import('dayjs').Dayjs, tz: string, settings: object, reportSelf: boolean,
 *   reportDue: boolean } }} input history = the row's mark_missing and auto_checkout audit rows;
 *   reportDue = today's report counts as missing (from reportReminderAt)
 * @returns {MonthDay & { counts: object }} counts = dayCounts(), for summarizePerson()
 */
export function classifyDay({
  date,
  day,
  row = null,
  breaks = [],
  history = { missing: false, auto: false },
  entered = null,
  submitted = false,
  leaveNote = null,
  ctx,
}) {
  const { today, through, at, tz, settings } = ctx;
  const stale = isStaleOpen(row, date, today);
  // A stale open row is counted as a missing check-out: no present, break or worked time.
  const timeRow = stale ? { ...row, checkoutStatus: 'missing' } : row;
  const present =
    row && timeRow.checkoutStatus !== 'missing' ? presentMinutes(timeRow, at, tz) : null;
  const breakMinutes = row ? breakMinutesWithin(breaks, timeRow, at, tz) : 0;
  const worked = present === null ? null : Math.max(0, present - breakMinutes);
  const allowance = settings.breakAllowanceMinutes ?? 0;
  const counts = dayCounts({ day, row, past: date < today });
  return {
    date,
    kind: kindOf(day, date, through),
    employed: day.employed,
    isToday: date === today,
    day,
    holiday: day.holiday ? { name: day.holiday.name } : null,
    leave: day.leave
      ? {
          part: day.leave.part,
          paid: day.leave.paid !== false,
          type: day.leave.leaveType ?? null,
          note: leaveNote ?? null,
        }
      : null,
    row: row ? rowView(row) : null,
    where: whereFor({ day, row, counts, date, today, at, tz }),
    present: counts.present,
    leaveDays: counts.leave,
    absent: counts.absent,
    lateMinutes: effectiveLateMinutes({ row, day }),
    presentMinutes: present,
    breakMinutes,
    workedMinutes: worked,
    overAllowanceMinutes: allowance > 0 ? Math.max(0, breakMinutes - allowance) : 0,
    marks: dayMarks({ row: timeRow, day, worked, settings }),
    checkout: checkoutOf(row, { history, entered, stale }),
    report: reportOf({ row, submitted, date, today, ...ctx }),
    conflict: counts.conflict,
    counts,
  };
}

/** A working day of the person while employed (a leaver's last day without a row isn't one). */
function isOwnWorkingDay(item) {
  const { day } = item;
  return day.isWorkingDay && day.employed && !(item.date === day.leftOn && !item.row);
}

/**
 * True for a day the month Excel's Days sheet and the person month list: up to `through`, every
 * working day while employed, every day with a check-in, every holiday on a working weekday.
 * Leave days are working days, so they are listed too.
 * @param {MonthDay} item
 * @param {string} through
 */
export function isListedDay(item, through) {
  if (item.date > through) return false;
  if (item.row) return true;
  return (
    isOwnWorkingDay(item) || Boolean(item.day.employed && item.day.holiday && item.day.weekday)
  );
}

/**
 * The reasons someone needs a look this month, count first ("5 late days", "4 short days" with
 * half days and short days together, "4 missing reports"); only those at or over the threshold.
 * @param {{ lateDays: number, halfDays: number, shortDays: number,
 *   reports: { missing: number } | null }} person
 * @param {number} threshold late_alert_days
 * @returns {Array<{ key: 'late' | 'short' | 'reports', count: number, label: string }>}
 */
export function needsLookReasons(person, threshold) {
  const reasons = [
    { key: 'late', count: person.lateDays ?? 0, one: 'late day' },
    { key: 'short', count: (person.halfDays ?? 0) + (person.shortDays ?? 0), one: 'short day' },
    { key: 'reports', count: person.reports?.missing ?? 0, one: 'missing report' },
  ];
  if (!(threshold > 0)) return [];
  return reasons
    .filter((reason) => reason.count >= threshold)
    .map(({ key, count, one }) => ({
      key,
      count,
      label: `${count} ${plural(count, one, `${one}s`)}`,
    }));
}

const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const count = (list, test) => list.filter(test).length;

/**
 * One person's month (MonthPerson) from their MonthDays of the whole period.
 * @param {{ person: { user: object, joinedOn: string | null, leftOn: string | null },
 *   days: Array<MonthDay & { counts: object }>, ctx: { through: string, threshold: number,
 *   reportSelf: boolean } }} input
 * @returns {MonthPerson} without `days`
 */
export function summarizePerson({ person, days, ctx }) {
  const soFar = days.filter((item) => item.date <= ctx.through);
  const later = days.filter((item) => item.date > ctx.through);
  const paid = sum(soFar, (item) => item.counts.leavePaid);
  const unpaid = sum(soFar, (item) => item.counts.leaveUnpaid);
  const submitted = count(soFar, (item) => item.row && item.report === 'submitted');
  const missingReports = count(soFar, (item) => item.report === 'not_submitted');
  const totals = {
    user: person.user,
    joinedOn: person.joinedOn ?? null,
    leftOn: person.leftOn ?? null,
    workingDays: count(days, isOwnWorkingDay),
    workingDaysSoFar: count(soFar, isOwnWorkingDay),
    holidays: count(days, ({ day }) => day.employed && day.holiday && day.weekday),
    presentDays: sum(soFar, (item) => item.counts.present),
    officeDays: sum(soFar, (item) => item.counts.office),
    wfhDays: sum(soFar, (item) => item.counts.wfh),
    daysOffWorked: sum(soFar, (item) => item.counts.dayOffWorked),
    leave: {
      paid,
      unpaid,
      total: paid + unpaid,
      planned: sum(later, (item) => (isOwnWorkingDay(item) ? leaveFraction(item.day) : 0)),
    },
    absentDays: sum(soFar, (item) => item.counts.absent),
    lateDays: count(soFar, (item) => item.lateMinutes > 0),
    lateMinutes: sum(soFar, (item) => item.lateMinutes),
    halfDays: count(soFar, (item) => item.marks.halfDay),
    shortDays: count(soFar, (item) => item.marks.shortDay),
    leftEarlyDays: count(soFar, (item) => item.marks.leftEarly),
    workedMinutes: sum(soFar, (item) => item.workedMinutes),
    breakMinutes: sum(soFar, (item) => item.breakMinutes),
    overAllowanceDays: count(soFar, (item) => item.overAllowanceMinutes > 0),
    missingCheckouts: count(soFar, (item) => item.checkout.wasMissing),
    missingNotFixed: count(soFar, (item) => item.checkout.notFixed),
    autoCheckouts: count(soFar, (item) => item.checkout.auto),
    selfEnteredCheckouts: count(soFar, (item) => item.checkout.enteredBy?.self),
    selfEnteredPastLastSeen: count(soFar, (item) => item.checkout.pastLastSeen),
    reports: ctx.reportSelf
      ? { expected: submitted + missingReports, submitted, missing: missingReports }
      : null,
  };
  return { ...totals, needsLook: needsLookReasons(totals, ctx.threshold) };
}

/**
 * The person month calendar's tone of a day: a check-in gives late, wfh or office; else a
 * holiday or leave (days to come too), "missing" (absent) for a past working day, future for
 * today and later, weekend (neutral) outside employment and on days off.
 * @param {MonthDay} item
 * @param {string} today
 * @returns {'office' | 'wfh' | 'late' | 'missing' | 'leave' | 'holiday' | 'future' | 'weekend'}
 */
export function toneOfDay(item, today) {
  const { day, row, date } = item;
  if (row && date <= today) {
    if (item.lateMinutes > 0) return 'late';
    return row.location === 'wfh' ? 'wfh' : 'office';
  }
  if (!day.employed) return 'weekend';
  if (day.holiday && day.weekday) return 'holiday';
  if (day.leave) return 'leave';
  if (date >= today) return 'future';
  return isOwnWorkingDay(item) ? 'missing' : 'weekend';
}
