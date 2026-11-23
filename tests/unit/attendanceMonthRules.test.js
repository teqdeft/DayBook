// The month's pure rules (CONTRACT 25, items 4 and 10): classifyDay and summarizePerson count one
// person's payroll month the way every month reader does; needsLookReasons and ordinal.
import { describe, expect, it } from 'vitest';
import { eachDay } from '@/lib/time';
import { personDay } from '@/modules/attendance/calendar';
import {
  classifyDay,
  isListedDay,
  needsLookReasons,
  ordinal,
  summarizePerson,
  toneOfDay,
} from '@/modules/attendance/monthRules';

const SETTINGS = {
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  lateAfter: '09:30',
  timezone: 'Asia/Kolkata',
  breakAllowanceMinutes: 60,
  halfDayUnderMinutes: 270,
  shortDayUnderMinutes: 480,
  leftEarlyGraceMinutes: 15,
};
const TZ = SETTINGS.timezone;
const FROM = '2026-11-01'; // a Sunday
const TO = '2026-11-30';
const TODAY = '2026-11-19'; // a Thursday
const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);

const PERSON = { id: 7, role: 'employee', tracksAttendance: true, joinedOn: null, leftOn: null };

/** A finished office row from 9:30 to 18:30 (9 hours) unless changed. */
function row(date, extra = {}) {
  return {
    id: Number(date.slice(8)),
    userId: PERSON.id,
    workDate: date,
    checkInAt: at(date, '09:30'),
    checkOutAt: at(date, '18:30'),
    location: 'office',
    officeVerified: true,
    note: null,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    ...extra,
  };
}

/** Every MonthDay of the period and the person's MonthPerson. */
function month({
  person = PERSON,
  rows = {},
  leave = {},
  holidays = {},
  breaks = {},
  history = {},
  entered = {},
  submitted = [],
  nowClock = '12:00',
  reportSelf = true,
  reportDue = false,
  threshold = 4,
} = {}) {
  const ctx = {
    today: TODAY,
    through: TODAY,
    at: at(TODAY, nowClock),
    tz: TZ,
    settings: SETTINGS,
    reportSelf,
    reportDue,
  };
  const days = eachDay(FROM, TO).map((date) =>
    classifyDay({
      date,
      day: personDay({
        date,
        person,
        settings: SETTINGS,
        holiday: holidays[date] ?? null,
        leave: leave[date] ?? null,
        leaveDetail: true,
      }),
      row: rows[date] ?? null,
      breaks: breaks[date] ?? [],
      history: history[date],
      entered: entered[date] ?? null,
      submitted: submitted.includes(date),
      ctx,
    }),
  );
  const summary = summarizePerson({
    person: {
      user: { id: person.id, name: 'Vishal Saini' },
      joinedOn: person.joinedOn,
      leftOn: person.leftOn,
    },
    days,
    ctx: { through: TODAY, threshold, reportSelf },
  });
  return { days, summary };
}

const dayOf = (days, date) => days.find((item) => item.date === date);

describe('classifyDay and summarizePerson', () => {
  it('present + leave + absent = 1 on every past working day', () => {
    const { days, summary } = month({
      rows: { '2026-11-02': row('2026-11-02'), '2026-11-03': row('2026-11-03') },
      leave: {
        '2026-11-04': { id: 1, part: 'full', paid: true, leaveType: 'casual' },
        '2026-11-05': { id: 2, part: 'first_half', paid: false, leaveType: 'sick' },
        '2026-11-06': { id: 3, part: 'second_half', paid: true, leaveType: 'casual' },
      },
    });
    const past = days.filter((item) => item.date < TODAY && item.day.isWorkingDay);
    for (const item of past) expect(item.present + item.leaveDays + item.absent).toBe(1);
    expect(dayOf(days, '2026-11-05')).toMatchObject({
      leaveDays: 0.5,
      absent: 0.5,
      where: 'absent',
    });
    expect(dayOf(days, '2026-11-04').where).toBe('on_leave');
    expect(summary.leave).toEqual({ paid: 1.5, unpaid: 0.5, total: 2, planned: 0 });
    expect(summary.presentDays + summary.leave.total + summary.absentDays).toBe(
      summary.workingDaysSoFar - 1, // today: not checked in yet, never absent
    );
  });

  it('counts working days for the whole period and the rest up to today', () => {
    const { summary } = month({
      holidays: { '2026-11-24': { id: 9, name: 'Guru Nanak Jayanti' } },
    });
    expect(summary.workingDays).toBe(20); // 21 weekdays less the holiday
    expect(summary.workingDaysSoFar).toBe(14);
    expect(summary.holidays).toBe(1); // the whole period, the holiday is to come
    expect(summary.absentDays).toBe(13); // 13 past working days, today never absent
  });

  it('today is never absent', () => {
    const { days } = month();
    expect(dayOf(days, TODAY)).toMatchObject({ absent: 0, where: 'not_checked_in' });
  });

  it('puts leave after today in leave.planned, never in the total', () => {
    const { summary } = month({
      leave: {
        '2026-11-23': { id: 4, part: 'full', paid: true, leaveType: 'casual' },
        '2026-11-25': { id: 5, part: 'first_half', paid: true, leaveType: 'casual' },
      },
    });
    expect(summary.leave).toEqual({ paid: 0, unpaid: 0, total: 0, planned: 1.5 });
  });

  it('gives a mid-period joiner and leaver no absent outside their employment', () => {
    const joiner = month({ person: { ...PERSON, joinedOn: '2026-11-16' } }).summary;
    expect(joiner.workingDays).toBe(11); // 16 to 30 Nov
    expect(joiner.absentDays).toBe(3); // 16, 17, 18 Nov
    const leaver = month({
      person: { ...PERSON, leftOn: '2026-11-04' },
      rows: { '2026-11-02': row('2026-11-02'), '2026-11-03': row('2026-11-03') },
    });
    expect(leaver.summary.workingDays).toBe(2); // the last day without a row isn't one
    expect(leaver.summary.absentDays).toBe(0);
    expect(isListedDay(dayOf(leaver.days, '2026-11-05'), TODAY)).toBe(false);
  });

  it('splits present into office and WFH, and counts days off worked apart', () => {
    const { summary } = month({
      rows: {
        '2026-11-02': row('2026-11-02'),
        '2026-11-03': row('2026-11-03', { location: 'wfh', officeVerified: false }),
        '2026-11-04': row('2026-11-04', { officeVerified: false }),
        '2026-11-07': row('2026-11-07', { isWorkingDay: false }), // a Saturday
      },
    });
    expect(summary).toMatchObject({ presentDays: 3, officeDays: 2, wfhDays: 1, daysOffWorked: 1 });
    expect(summary.officeDays + summary.wfhDays).toBe(summary.presentDays);
  });

  it('counts days over the break allowance and every row in worked and breaks', () => {
    const lunch = (date, from, to) => ({ startedAt: at(date, from), endedAt: at(date, to) });
    const { summary } = month({
      rows: { '2026-11-02': row('2026-11-02'), '2026-11-07': row('2026-11-07') },
      breaks: {
        '2026-11-02': [lunch('2026-11-02', '13:00', '14:15')],
        '2026-11-07': [lunch('2026-11-07', '13:00', '13:30')],
      },
    });
    expect(summary.breakMinutes).toBe(105);
    expect(summary.workedMinutes).toBe(18 * 60 - 105);
    expect(summary.overAllowanceDays).toBe(1);
  });

  it('counts a missing check-out by its audit row (fixed) or its status (not fixed)', () => {
    const { summary } = month({
      rows: {
        '2026-11-02': row('2026-11-02', { checkoutStatus: 'corrected' }),
        '2026-11-03': row('2026-11-03', { checkOutAt: null, checkoutStatus: 'missing' }),
      },
      history: { '2026-11-02': { missing: true, auto: false } },
    });
    expect(summary.missingCheckouts).toBe(2);
    expect(summary.missingNotFixed).toBe(1);
    expect(summary.workedMinutes).toBe(9 * 60); // the missing day has none
  });

  it('counts an open row from yesterday as a missing check-out, not fixed, with no worked time', () => {
    const { days, summary } = month({
      rows: {
        '2026-11-18': row('2026-11-18', { checkOutAt: null, checkoutStatus: 'open' }),
        [TODAY]: row(TODAY, { checkOutAt: null, checkoutStatus: 'open' }),
      },
      breaks: { '2026-11-18': [{ startedAt: at('2026-11-18', '13:00'), endedAt: null }] },
    });
    const yesterday = dayOf(days, '2026-11-18');
    expect(yesterday).toMatchObject({ presentMinutes: null, workedMinutes: null, breakMinutes: 0 });
    expect(yesterday.checkout).toMatchObject({ wasMissing: true, notFixed: true });
    expect(yesterday.present).toBe(1);
    // Today's open row counts live (9:30 to 12:00).
    expect(dayOf(days, TODAY).presentMinutes).toBe(150);
    expect(summary).toMatchObject({ missingCheckouts: 1, missingNotFixed: 1, workedMinutes: 150 });
  });

  it('counts an auto check-out by its audit row after a correction', () => {
    const { summary } = month({
      rows: {
        '2026-11-02': row('2026-11-02', { checkoutStatus: 'corrected' }),
        '2026-11-03': row('2026-11-03', { checkoutStatus: 'auto' }),
      },
      history: { '2026-11-02': { missing: false, auto: true } },
    });
    expect(summary.autoCheckouts).toBe(2);
    expect(summary.missingCheckouts).toBe(0);
  });

  it("counts today's missing report only from the report reminder, none without report.self", () => {
    const rows = {
      '2026-11-17': row('2026-11-17'),
      '2026-11-18': row('2026-11-18'),
      [TODAY]: row(TODAY, { checkOutAt: null, checkoutStatus: 'open' }),
    };
    const before = month({ rows, submitted: ['2026-11-17'] });
    expect(before.summary.reports).toEqual({ expected: 2, submitted: 1, missing: 1 });
    expect(dayOf(before.days, TODAY).report).toBe('due');
    const after = month({ rows, submitted: ['2026-11-17'], reportDue: true });
    expect(after.summary.reports).toEqual({ expected: 3, submitted: 1, missing: 2 });
    expect(dayOf(after.days, TODAY).report).toBe('not_submitted');
    expect(month({ rows, reportSelf: false }).summary.reports).toBeNull();
  });

  it('counts check-outs the person entered themselves, and those past last seen', () => {
    const self = { id: PERSON.id, name: 'Vishal Saini', at: at('2026-11-03', '10:00'), self: true };
    const { days, summary } = month({
      rows: {
        '2026-11-02': row('2026-11-02', { checkoutStatus: 'corrected' }),
        '2026-11-03': row('2026-11-03', { checkoutStatus: 'corrected' }),
        '2026-11-04': row('2026-11-04', { checkoutStatus: 'corrected' }),
      },
      entered: {
        '2026-11-02': { ...self, suggestedAt: at('2026-11-02', '18:20'), pastLastSeen: false },
        '2026-11-03': { ...self, suggestedAt: at('2026-11-03', '13:05'), pastLastSeen: true },
        '2026-11-04': {
          id: 2,
          name: 'Neha Kapoor',
          at: null,
          self: false,
          suggestedAt: null,
          pastLastSeen: false,
        },
      },
    });
    expect(summary.selfEnteredCheckouts).toBe(2);
    expect(summary.selfEnteredPastLastSeen).toBe(1);
    expect(dayOf(days, '2026-11-04').checkout.enteredBy).toMatchObject({
      name: 'Neha Kapoor',
      self: false,
    });
  });

  it('gives the calendar tones of a month', () => {
    const { days } = month({
      rows: {
        '2026-11-02': row('2026-11-02', { lateMinutes: 22 }),
        '2026-11-03': row('2026-11-03', { location: 'wfh' }),
      },
      holidays: { '2026-11-09': { id: 1, name: 'Diwali' } },
      leave: { '2026-11-23': { id: 2, part: 'full', paid: true, leaveType: 'casual' } },
    });
    const tones = Object.fromEntries(days.map((item) => [item.date, toneOfDay(item, TODAY)]));
    expect(tones).toMatchObject({
      '2026-11-02': 'late',
      '2026-11-03': 'wfh',
      '2026-11-04': 'missing',
      '2026-11-09': 'holiday',
      [TODAY]: 'future',
      '2026-11-23': 'leave',
      '2026-11-01': 'weekend',
    });
  });
});

describe('needsLookReasons', () => {
  const person = { lateDays: 5, halfDays: 1, shortDays: 3, reports: { missing: 3 } };

  it('lists the reasons at or over the threshold, count first', () => {
    expect(needsLookReasons(person, 4)).toEqual([
      { key: 'late', count: 5, label: '5 late days' },
      { key: 'short', count: 4, label: '4 short days' },
    ]);
  });

  it('leaves out the reasons under it', () => {
    expect(needsLookReasons(person, 6)).toEqual([]);
    expect(needsLookReasons({ ...person, reports: null }, 3).map((r) => r.key)).toEqual([
      'late',
      'short',
    ]);
    expect(
      needsLookReasons({ lateDays: 1, halfDays: 0, shortDays: 0, reports: { missing: 1 } }, 1),
    ).toEqual([
      { key: 'late', count: 1, label: '1 late day' },
      { key: 'reports', count: 1, label: '1 missing report' },
    ]);
  });
});

describe('ordinal', () => {
  it('writes 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 101st, 111th', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });
});
