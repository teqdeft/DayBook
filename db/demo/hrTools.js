// Daybook 1.10 (CONTRACT 25) in the demo, so each HR tool has something to show:
//
// - A company holiday, Guru Nanak Jayanti, on the third working day after the anchor ("Next
//   holiday" on Today and the Leave and holidays card), and leave: Farhan Qureshi was off sick on
//   the day the canvas has him not checked in (offset 2, with an HR note), and Karan Mehta has
//   casual leave over the holiday (three dates, two leave days, under "Coming up").
// - Missing check-outs on older days (offsets 3 to 7, so the KPI keeps "1 from yesterday" and gets
//   "6 to fix in all"); Neha reminded Arjun Nair about his at 10:05 today.
// - Vishal Saini entered his own missing check-out for offset 3 the next morning, at his shift end
//   but long after Daybook last saw him working (HR's "Check" tag), and Neha changed the place of
//   offset 8 with a reason (the person month's Changes).
// - Ankit Rana is late for the 4th time this payroll month today (Needs a look, "4th this month"),
//   and Aman Singh left early on offset 5: a short day.
//
// Their bell and audit rows are in hrRecords.js; the timer entries and breaks (away breaks and a
// forgotten break) in hrTimers.js.
import { addDays, isWorkingDay } from '@/lib/time';
import { payrollMonthOf, payrollPeriod } from '@/modules/attendance/payroll';
import { formatDayRange } from '@/modules/attendance/wording';
import { minutesOf } from './calendar.js';
import {
  REMINDED,
  SELF_ENTERED,
  auditRow,
  bell,
  hrEditRows,
  markedMissing,
  reminderRows,
  selfEnteredRows,
} from './hrRecords.js';

export const HOLIDAY = { name: 'Guru Nanak Jayanti', workingDaysAhead: 3 };
/** [person, working-day offset]: rows the midnight job marked missing, nobody fixed yet. */
export const MISSING_ROWS = [
  ['meena', 3],
  ['varun', 4],
  ['arjun', 5],
  ['kavya', 6],
  ['sneha', 7],
];
const LATE = { key: 'ankit', before: 3, clocks: ['09:52', '09:47', '10:04'] };
const SHORT_DAY = { key: 'aman', offset: 5, out: '15:40' };
const LEAVE = [
  { key: 'farhan', offset: 2, leaveType: 'sick', note: 'Fever. He called in at 9:00.' },
  { key: 'karan', aroundHoliday: true, leaveType: 'casual', note: null },
];

/** The working days after `date`, as many as asked (holidays aren't known here). */
function workingDaysAfter(date, count, workingDays) {
  const found = [];
  for (let day = addDays(date, 1); found.length < count; day = addDays(day, 1)) {
    if (isWorkingDay(day, workingDays)) found.push(day);
  }
  return found;
}

const planOf = (plans, key, offset) => plans.get(key).find((plan) => plan.offset === offset);

/**
 * Ankit: exactly three late days earlier this payroll month, so today's is the 4th. Extra ones
 * (the oldest) become on time; missing ones are the newest on-time days, this week's last.
 */
function planLateDays(plans, { from, lateAfter }) {
  const earlier = plans
    .get(LATE.key)
    .filter((plan) => plan.offset >= 1 && plan.date >= from && !plan.absent)
    .sort((a, b) => a.offset - b.offset);
  const late = earlier.filter((plan) => plan.lateMinutes > 0);
  for (const plan of late.slice(LATE.before)) {
    plan.in = '09:22';
    plan.lateMinutes = 0;
  }
  const wanted = LATE.before - Math.min(late.length, LATE.before);
  const thisWeek = (plan) => (plan.offset < 3 ? 1 : 0);
  const onTime = earlier
    .filter((plan) => plan.lateMinutes === 0)
    .sort((a, b) => thisWeek(a) - thisWeek(b) || a.offset - b.offset);
  onTime.slice(0, wanted).forEach((plan, i) => {
    plan.in = LATE.clocks[i];
    plan.lateMinutes = minutesOf(plan.in) - minutesOf(lateAfter);
  });
}

/**
 * Changes the day plans before they become rows: Ankit's late days, Aman's short day, the
 * missing check-outs and Vishal's self-entered one (which was missing first).
 * @param {Map<string, object[]>} plans
 * @param {{ anchor: string, lateAfter: string, payrollStartDay: number }} ctx
 */
export function planHrTools(plans, ctx) {
  const start = ctx.payrollStartDay;
  const { from } = payrollPeriod(payrollMonthOf(ctx.anchor, start), start);
  planLateDays(plans, { from, lateAfter: ctx.lateAfter });
  const short = planOf(plans, SHORT_DAY.key, SHORT_DAY.offset);
  if (short && !short.absent) short.out = SHORT_DAY.out;
  for (const [key, offset] of MISSING_ROWS) {
    const plan = planOf(plans, key, offset);
    if (!plan || plan.absent) throw new Error(`Demo data: ${key} is absent at offset ${offset}`);
    plan.out = null;
    plan.checkoutStatus = 'missing';
  }
  planOf(plans, SELF_ENTERED.key, SELF_ENTERED.offset).checkoutStatus = 'corrected';
}

/** The holiday and the two leave entries, each marked by Neha (audited, the person told). */
function calendarRows(ctx, out) {
  // Karan's leave runs from the day before the holiday to the day after it.
  const [, second, third, fourth] = workingDaysAfter(
    ctx.today,
    HOLIDAY.workingDaysAhead + 1,
    ctx.workingDays,
  );
  const neha = ctx.users.get('neha');
  const createdAt = ctx.when(6, '11:00');
  out.holidays.push({
    id: 1,
    holidayDate: third,
    name: HOLIDAY.name,
    createdBy: neha.id,
    updatedBy: neha.id,
    createdAt,
    updatedAt: createdAt,
  });
  LEAVE.forEach((leave, i) => {
    const person = ctx.users.get(leave.key);
    const fromDate = leave.aroundHoliday ? second : ctx.dateOf(leave.offset);
    const toDate = leave.aroundHoliday ? fourth : fromDate;
    const when = leave.aroundHoliday ? ctx.when(1, '16:40') : ctx.when(leave.offset, '10:20');
    const { leaveType, note } = leave;
    const entry = {
      userId: person.id,
      fromDate,
      toDate,
      part: 'full',
      paid: true,
      leaveType,
      note,
    };
    const marked = { createdBy: neha.id, updatedBy: neha.id, createdAt: when, updatedAt: when };
    out.leave.push({ id: i + 1, ...entry, ...marked });
    out.audit.push(
      auditRow({
        actor: neha.id,
        action: 'leave.create',
        entityType: 'leave',
        entityId: i + 1,
        after: entry,
        at: when,
      }),
    );
    const type = leave.leaveType === 'sick' ? 'Sick' : 'Casual';
    out.notifications.push(
      bell({
        userId: person.id,
        type: 'leave.marked',
        title: `${neha.name} marked leave for you: ${formatDayRange(fromDate, toDate)}`,
        body: `${type}, paid.`,
        link: toDate >= ctx.today ? '/today' : `/log?month=${fromDate.slice(0, 7)}`,
        at: when,
        read: !leave.aroundHoliday,
      }),
    );
  });
}

/**
 * The 1.10 rows: holidays, leave_entries, attendance_reminders, and the bell and audit rows that
 * go with them. Also sets Vishal's entered-by columns on his attendance row (before it is inserted).
 * @param {{ tz: string, today: string, workingDays: number[], users: Map<string, object>,
 *   index: { attendance: Map<string, object> }, when: (offset: number, clock: string) => Date,
 *   dateOf: (offset: number) => string }} ctx
 */
export function buildHrRows(ctx) {
  const out = { holidays: [], leave: [], reminders: [], notifications: [], audit: [] };
  calendarRows(ctx, out);
  for (const [key, offset] of MISSING_ROWS) {
    markedMissing(ctx.index.attendance.get(`${key}|${offset}`), ctx, out);
  }
  const [, remindedOffset] = MISSING_ROWS.find(([key]) => key === REMINDED.key);
  reminderRows(ctx, out, remindedOffset);
  selfEnteredRows(ctx, out);
  hrEditRows(ctx, out);
  return out;
}
