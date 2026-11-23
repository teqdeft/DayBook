// The month Excel (CONTRACT 25, item 4): a "Summary" sheet with one row per person and a "Days"
// sheet with one row per person per listed day up to today. Numbers stay numbers (halves as 0.5,
// hours with two decimals), clocks are 24-hour HH:mm. Never report text, screen time or an
// attendance IP. xlsxResponse builds the whole workbook in memory, so one file covers at most 200
// people and this process builds one month export at a time.
import { AppError } from '@/lib/errors';
import { xlsxResponse } from '@/lib/excel';
import { dayjs, toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { LEAVE_TYPE_LABELS, PART_LABELS } from './calendar';
import { peopleFor, summarizePeople } from './month';
import { resolvePayrollMonth } from './payroll';
import { showsAttendanceOf } from './rules';

const MAX_PEOPLE = 200;

// The day Excel's words (dayExport.js), kept here so the two exports never import each other.
const CHECKOUT_WORDS = {
  open: 'Open',
  checked_out: 'Checked out',
  missing: 'Missing',
  corrected: 'Corrected',
  auto: 'Auto',
};

const WHERE_WORDS = {
  office: 'Office',
  unverified: 'Office (unverified)',
  wfh: 'WFH',
  on_leave: 'On leave',
  absent: 'Absent',
  not_checked_in: 'Not checked in',
};

const REPORT_WORDS = { submitted: 'Submitted', not_submitted: 'Not submitted' };

const HOURS = '0.00';

const SUMMARY_COLUMNS = [
  ['Name', 'name', 24],
  ['Email', 'email', 28],
  ['Designation', 'designation', 22],
  ['Department', 'department', 16],
  ['Working days', 'workingDays', 13],
  ['Days present', 'presentDays', 13],
  ['Office days', 'officeDays', 12],
  ['WFH days', 'wfhDays', 10],
  ['Worked on days off', 'daysOffWorked', 18],
  ['Paid leave days', 'paidLeave', 15],
  ['Unpaid leave days', 'unpaidLeave', 17],
  ['Holidays', 'holidays', 10],
  ['Absent days', 'absentDays', 12],
  ['Late days', 'lateDays', 10],
  ['Late (minutes)', 'lateMinutes', 14],
  ['Half days', 'halfDays', 10],
  ['Short days', 'shortDays', 11],
  ['Left early (days)', 'leftEarlyDays', 16],
  ['Worked (hours)', 'workedHours', 15, HOURS],
  ['Breaks (hours)', 'breakHours', 15, HOURS],
  ['Days over break allowance', 'overAllowanceDays', 24],
  ['Missing check-outs', 'missingCheckouts', 18],
  ['Not fixed yet', 'missingNotFixed', 13],
  ['Auto check-outs', 'autoCheckouts', 15],
  ['Check-outs entered themselves', 'selfEntered', 28],
  ['Entered after last seen', 'selfPastLastSeen', 22],
  ['Reports submitted', 'reportsSubmitted', 18],
  ['Missing reports', 'reportsMissing', 15],
  ['Joined', 'joinedOn', 12],
  ['Left', 'leftOn', 12],
  ['Planned leave days', 'plannedLeave', 18],
];

const DAY_COLUMNS = [
  ['Name', 'name', 24],
  ['Email', 'email', 28],
  ['Date', 'date', 12],
  ['Day', 'weekday', 6],
  ['Day type', 'dayType', 22],
  ['Where', 'where', 18],
  ['Leave', 'leave', 12],
  ['Leave paid', 'leavePaid', 11],
  ['Leave type', 'leaveType', 11],
  ['Leave note', 'leaveNote', 30],
  ['Check-in', 'checkIn', 10],
  ['Check-out', 'checkOut', 10],
  ['Check-out status', 'checkoutStatus', 16],
  ['Check-out entered by', 'enteredBy', 22],
  ['Entered after last seen', 'pastLastSeen', 22],
  ['Late (minutes)', 'lateMinutes', 14],
  ['Present (hours)', 'presentHours', 15, HOURS],
  ['Breaks (minutes)', 'breakMinutes', 16],
  ['Worked (hours)', 'workedHours', 15, HOURS],
  ['Over allowance (minutes)', 'overAllowance', 22],
  ['Half day', 'halfDay', 9],
  ['Short day', 'shortDay', 10],
  ['Left early (minutes)', 'leftEarly', 18],
  ['Absent', 'absent', 8],
  ['Report', 'report', 14],
  ['Note', 'note', 40],
];

const columnsOf = (list) =>
  list.map(([header, key, width, numFmt]) => ({
    header,
    key,
    width,
    ...(numFmt ? { numFmt } : {}),
  }));

const hours = (minutes) =>
  minutes === null || minutes === undefined ? null : Math.round((minutes / 60) * 100) / 100;
const yes = (value) => (value ? 'Yes' : '');

function summaryRow(person) {
  const { user, leave, reports } = person;
  return {
    name: user.name,
    email: user.email ?? '',
    designation: user.designation ?? '',
    department: user.departmentName ?? '',
    workingDays: person.workingDays,
    presentDays: person.presentDays,
    officeDays: person.officeDays,
    wfhDays: person.wfhDays,
    daysOffWorked: person.daysOffWorked,
    paidLeave: leave.paid,
    unpaidLeave: leave.unpaid,
    holidays: person.holidays,
    absentDays: person.absentDays,
    lateDays: person.lateDays,
    lateMinutes: person.lateMinutes,
    halfDays: person.halfDays,
    shortDays: person.shortDays,
    leftEarlyDays: person.leftEarlyDays,
    workedHours: hours(person.workedMinutes),
    breakHours: hours(person.breakMinutes),
    overAllowanceDays: person.overAllowanceDays,
    missingCheckouts: person.missingCheckouts,
    missingNotFixed: person.missingNotFixed,
    autoCheckouts: person.autoCheckouts,
    selfEntered: person.selfEnteredCheckouts,
    selfPastLastSeen: person.selfEnteredPastLastSeen,
    reportsSubmitted: reports ? reports.submitted : null,
    reportsMissing: reports ? reports.missing : null,
    joinedOn: person.joinedOn ?? '',
    leftOn: person.leftOn ?? '',
    plannedLeave: leave.planned,
  };
}

/** "Working day", "Holiday: Diwali" or "Day off" (the day Excel's words). */
function dayType(day) {
  if (day.isWorkingDay) return 'Working day';
  return day.holiday && day.weekday ? `Holiday: ${day.holiday.name}` : 'Day off';
}

function dayRow(person, item, tz) {
  const { row, leave, marks, checkout } = item;
  const clock = (at) => (at ? toLocal(at, tz).format('HH:mm') : '');
  return {
    name: person.user.name,
    email: person.user.email ?? '',
    date: item.date,
    weekday: dayjs(item.date, 'YYYY-MM-DD').format('ddd'),
    dayType: dayType(item.day),
    where: WHERE_WORDS[item.where] ?? '',
    leave: leave ? (PART_LABELS[leave.part] ?? '') : '',
    leavePaid: leave ? (leave.paid ? 'Paid' : 'Unpaid') : '',
    leaveType: leave ? (LEAVE_TYPE_LABELS[leave.type] ?? '') : '',
    leaveNote: leave?.note ?? '',
    checkIn: clock(row?.checkInAt),
    checkOut: clock(row?.checkOutAt),
    checkoutStatus: row ? (CHECKOUT_WORDS[row.checkoutStatus] ?? '') : '',
    enteredBy: checkout.enteredBy?.name ?? '',
    pastLastSeen: yes(checkout.pastLastSeen),
    lateMinutes: row ? item.lateMinutes : null,
    presentHours: hours(item.presentMinutes),
    breakMinutes: row ? item.breakMinutes : null,
    workedHours: hours(item.workedMinutes),
    overAllowance: row ? item.overAllowanceMinutes : null,
    halfDay: yes(marks.halfDay),
    shortDay: yes(marks.shortDay),
    leftEarly: marks.leftEarly ? marks.leftEarlyMinutes : null,
    absent: item.absent,
    report: REPORT_WORDS[item.report] ?? '',
    note: row?.note ?? '',
  };
}

/** 'vishal-saini' for a file name. */
function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The people of the file: one person (userId), or everyone the viewer may see (at most 200). */
async function exportPeople({ viewer, userId, period }) {
  if (userId) {
    const person = await users.findById(userId);
    if (!person || !showsAttendanceOf(viewer, person)) {
      throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
    }
    return [person];
  }
  const people = await peopleFor({ from: period.from, to: period.to, viewer });
  if (people.length > MAX_PEOPLE) {
    const message = "Too many people for one file. Download one person's month instead.";
    throw new AppError('BAD_REQUEST', { message });
  }
  return people;
}

async function buildMonthExport({ viewer, month, userId }) {
  const current = await settings.getAll();
  const period = resolvePayrollMonth(month, current);
  const people = await exportPeople({ viewer, userId, period });
  const summary = await summarizePeople({
    people,
    from: period.from,
    to: period.to,
    viewer,
    withDays: true,
  });
  const name = period.rangeLabel ?? period.label;
  const tz = current.timezone;
  const one = userId && people[0] ? `-${slug(people[0].name)}` : '';
  return {
    filename: `attendance-${period.month}${one}.xlsx`,
    sheets: [
      {
        name: `Summary ${name}`,
        columns: columnsOf(SUMMARY_COLUMNS),
        rows: summary.people.map(summaryRow),
      },
      {
        name: `Days ${name}`,
        columns: columnsOf(DAY_COLUMNS),
        rows: summary.people.flatMap((person) =>
          person.days.map((item) => dayRow(person, item, tz)),
        ),
      },
    ],
  };
}

let building = false;

/** Runs `build` while no other month export builds in this process, else 429. */
async function oneAtATime(build) {
  if (building) {
    throw new AppError('RATE_LIMITED', {
      message: 'An export is being built. Try again in a minute.',
    });
  }
  building = true;
  try {
    return await build();
  } finally {
    building = false;
  }
}

/**
 * The month Excel's workbook (input for xlsxResponse): everyone the viewer may see, or one person.
 * @param {{ viewer: object, month?: string, userId?: number }} input month as for getMonth()
 * @returns {Promise<{ filename: string, sheets: object[] }>} attendance-2026-11.xlsx, one person
 *   attendance-2026-11-vishal-saini.xlsx
 * @throws NOT_FOUND (an unknown userId, or an Admin for a non-Admin), BAD_REQUEST (over 200
 *   people), RATE_LIMITED (429, another month export is being built in this process)
 */
export function exportMonth(input) {
  return oneAtATime(() => buildMonthExport(input));
}

/**
 * The month Excel as a download Response (GET /api/attendance/month/export): exportMonth() and
 * the workbook's build together hold this process's one export slot.
 * @param {{ viewer: object, month?: string, userId?: number }} input
 * @returns {Promise<Response>}
 * @throws as exportMonth()
 */
export function exportMonthResponse(input) {
  return oneAtATime(async () => xlsxResponse(await buildMonthExport(input)));
}
