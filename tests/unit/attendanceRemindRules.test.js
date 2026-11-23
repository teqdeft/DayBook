// When a remind applies, what it says, and the words of the HR summaries (CONTRACT 25, items 5
// and 1). Pure, no database.
import { describe, expect, it } from 'vitest';
import { personDay, presenceOf } from '@/modules/attendance/calendar';
import { eveningMessage, morningMessage } from '@/modules/attendance/hrSummaryText';
import { reminderMessage } from '@/modules/attendance/reminderMessages';
import { remindKindFor, remindSkipFor } from '@/modules/attendance/remindRules';

const TZ = 'Asia/Kolkata';
const SETTINGS = {
  timezone: TZ,
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  lateAfter: '09:35',
  breakAllowanceMinutes: 60,
};
const TODAY = '2026-11-19'; // Thursday
const YESTERDAY = '2026-11-18';
const PERSON = { id: 7, name: 'Priya Sharma', role: 'employee', tracksAttendance: true };
const at = (clock, date = TODAY) => new Date(`${date}T${clock}:00+05:30`);
const ORIGIN = 'https://daybook.example';

function dayOf(date, extra = {}) {
  return personDay({ date, person: PERSON, settings: SETTINGS, ...extra });
}

/** A listDay() item of today at `clock`, with an optional row and break state. */
function item({ clock, date = TODAY, row = null, onBreakSince = null, over = 0, ...dayExtra }) {
  const day = dayOf(date, dayExtra);
  return {
    user: { id: PERSON.id, name: PERSON.name },
    attendance: row,
    day,
    where: presenceOf({ day, row, at: at(clock, date), tz: TZ }),
    onBreakSince,
    overAllowanceMinutes: over,
    breakMinutes: 60 + over,
  };
}

const ctx = (clock, extra = {}) => ({
  now: at(clock),
  today: TODAY,
  date: TODAY,
  settings: SETTINGS,
  ...extra,
});
const OPEN = { id: 1, checkInAt: at('09:30'), checkOutAt: null, checkoutStatus: 'open' };

describe('remindKindFor: check_in', () => {
  it('asks only once the own late mark has passed, and not after the day end', () => {
    expect(remindKindFor(item({ clock: '09:34' }), ctx('09:34'))).toBeNull();
    expect(remindSkipFor('check_in', item({ clock: '09:34' }), ctx('09:34'))).toBe(
      "Priya Sharma isn't late yet.",
    );
    expect(remindKindFor(item({ clock: '09:35' }), ctx('09:35'))).toBe('check_in');
    expect(remindSkipFor('check_in', item({ clock: '18:30' }), ctx('18:30'))).toBe(
      "Priya Sharma's day has ended.",
    );
  });

  it('never on a holiday or full-day leave', () => {
    const holiday = { holiday: { id: 1, name: 'Guru Nanak Jayanti' } };
    expect(remindKindFor(item({ clock: '11:00', ...holiday }), ctx('11:00'))).toBeNull();
    expect(remindSkipFor('check_in', item({ clock: '11:00', ...holiday }), ctx('11:00'))).toBe(
      "Today isn't a working day.",
    );
    const leave = { leave: { id: 3, part: 'full' } };
    expect(remindKindFor(item({ clock: '11:00', ...leave }), ctx('11:00'))).toBeNull();
    expect(remindSkipFor('check_in', item({ clock: '11:00', ...leave }), ctx('11:00'))).toBe(
      'Priya Sharma is on leave today.',
    );
  });

  it('first-half leave: from the split plus the grace (2:05 PM)', () => {
    const leave = { leave: { id: 3, part: 'first_half' } };
    expect(remindKindFor(item({ clock: '13:00', ...leave }), ctx('13:00'))).toBeNull();
    expect(remindKindFor(item({ clock: '14:04', ...leave }), ctx('14:04'))).toBeNull();
    expect(remindKindFor(item({ clock: '14:05', ...leave }), ctx('14:05'))).toBe('check_in');
  });

  it('second-half leave: before the split, never after it', () => {
    const leave = { leave: { id: 3, part: 'second_half' } };
    expect(remindKindFor(item({ clock: '10:00', ...leave }), ctx('10:00'))).toBe('check_in');
    expect(remindKindFor(item({ clock: '13:59', ...leave }), ctx('13:59'))).toBe('check_in');
    expect(remindKindFor(item({ clock: '14:00', ...leave }), ctx('14:00'))).toBeNull();
  });
});

describe('remindKindFor: break and check_out', () => {
  it('break only on a break over the allowance, and never while the allowance is 0', () => {
    const onBreak = { row: OPEN, onBreakSince: at('13:10') };
    expect(remindKindFor(item({ clock: '14:30', ...onBreak, over: 20 }), ctx('14:30'))).toBe(
      'break',
    );
    expect(remindKindFor(item({ clock: '14:30', ...onBreak }), ctx('14:30'))).toBeNull();
    const none = { ...SETTINGS, breakAllowanceMinutes: 0 };
    const zero = ctx('14:30', { settings: none });
    expect(remindKindFor(item({ clock: '14:30', ...onBreak, over: 20 }), zero)).toBeNull();
    expect(remindSkipFor('break', item({ clock: '14:30', row: OPEN }), ctx('14:30'))).toBe(
      "Priya Sharma isn't over the break allowance now.",
    );
  });

  it('check_out for an open row after the day end, and the break wins over it', () => {
    expect(remindKindFor(item({ clock: '18:29', row: OPEN }), ctx('18:29'))).toBeNull();
    expect(remindSkipFor('check_out', item({ clock: '18:29', row: OPEN }), ctx('18:29'))).toBe(
      "Priya Sharma's day hasn't ended yet.",
    );
    expect(remindKindFor(item({ clock: '18:30', row: OPEN }), ctx('18:30'))).toBe('check_out');
    const onBreak = { row: OPEN, onBreakSince: at('18:00'), over: 5 };
    expect(remindKindFor(item({ clock: '18:40', ...onBreak }), ctx('18:40'))).toBe('break');
    const closed = { ...OPEN, checkOutAt: at('18:35'), checkoutStatus: 'checked_out' };
    expect(remindSkipFor('check_out', item({ clock: '18:40', row: closed }), ctx('18:40'))).toBe(
      'Priya Sharma has checked out.',
    );
  });

  it('only today offers the first three kinds', () => {
    const past = { ...ctx('18:40'), date: YESTERDAY };
    expect(remindKindFor(item({ clock: '18:40', date: YESTERDAY, row: OPEN }), past)).toBeNull();
  });
});

describe('remindKindFor: missing_checkout', () => {
  const MISSING = { id: 5, checkInAt: at('09:32', YESTERDAY), checkoutStatus: 'missing' };
  const missing = new Map([[7, [{ attendanceId: 5, workDate: YESTERDAY }]]]);
  const past = (todayDay) => ({
    ...ctx('10:00'),
    date: YESTERDAY,
    missing,
    todayDays: new Map([[7, todayDay]]),
  });
  const row = () => item({ clock: '10:00', date: YESTERDAY, row: MISSING });

  it("on an earlier date's missing row, while today is a working day", () => {
    expect(remindKindFor(row(), past(dayOf(TODAY)))).toBe('missing_checkout');
  });

  it('not with a pending check_out correction (the row is not in missingCheckoutsFor)', () => {
    const ctxPending = { ...past(dayOf(TODAY)), missing: new Map() };
    expect(remindKindFor(row(), ctxPending)).toBeNull();
    expect(remindSkipFor('missing_checkout', row(), ctxPending)).toBe(
      'Priya Sharma has no missing check-outs now.',
    );
  });

  it('not while today is full-day leave or not a working day', () => {
    const leave = dayOf(TODAY, { leave: { id: 3, part: 'full' } });
    expect(remindKindFor(row(), past(leave))).toBeNull();
    expect(remindSkipFor('missing_checkout', row(), past(leave))).toBe(
      'Priya Sharma is on leave today.',
    );
    const saturday = dayOf('2026-11-21');
    expect(remindKindFor(row(), past(saturday))).toBeNull();
    expect(remindSkipFor('missing_checkout', row(), past(saturday))).toBe(
      "Today isn't a working day.",
    );
  });
});

describe('reminderMessage', () => {
  const send = (kind, details = {}, sender = 'Neha Kapoor') =>
    reminderMessage({ kind, sender, details: { tz: TZ, ...details }, origin: ORIGIN });

  it('writes every row of the table', () => {
    expect(
      reminderMessage({ kind: 'check_in', details: { expectedStart: '09:30' }, origin: ORIGIN }),
    ).toEqual({
      type: 'attendance.checkin_reminder',
      title: "You haven't checked in yet",
      body: 'Your day started at 9:30 AM. Check in on Today when you start work.',
      link: '/today',
      slack: `You haven't checked in yet. Your day started at 9:30 AM. <${ORIGIN}/today|Check in on Today>`,
    });
    expect(send('check_in')).toMatchObject({
      type: 'attendance.remind_check_in',
      title: 'Neha Kapoor reminded you to check in',
      body: "You haven't checked in today. Check in on Today when you start work.",
      slack: `*Neha Kapoor* reminded you to check in. You haven't checked in today. <${ORIGIN}/today|Check in on Today>`,
    });
    const breakBody =
      "You've been on a break since 1:10 PM. Your breaks today are 1h 20m, over the 1h allowance.";
    expect(
      send('break', { onBreakSince: at('13:10'), breakMinutes: 80, allowanceMinutes: 60 }),
    ).toMatchObject({
      type: 'attendance.remind_break',
      title: 'Neha Kapoor reminded you about your break',
      body: breakBody,
      slack: `*Neha Kapoor* reminded you about your break. ${breakBody} <${ORIGIN}/today|End your break on Today>`,
    });
    expect(send('check_out')).toMatchObject({
      type: 'attendance.remind_check_out',
      title: 'Neha Kapoor reminded you to check out',
      body: "You're still checked in. Check out on Today if you're done for the day.",
      slack: `*Neha Kapoor* reminded you to check out. You're still checked in. <${ORIGIN}/today|Open Today>`,
    });
  });

  it('missing check-outs: one, two and three days, with the ?checkout=missing link', () => {
    const one = send('missing_checkout', { dates: ['2026-11-13'] });
    expect(one).toEqual({
      type: 'attendance.remind_missing_checkout',
      title: 'Neha Kapoor asked for your check-out time',
      body: "You didn't check out on Fri, 13 Nov. Add the time you left on Today.",
      link: '/today?checkout=missing',
      slack: `*Neha Kapoor* asked for your check-out time. You didn't check out on Fri, 13 Nov. <${ORIGIN}/today?checkout=missing|Add it on Today>`,
    });
    expect(send('missing_checkout', { dates: ['2026-11-16', '2026-11-13'] }).body).toBe(
      "You didn't check out on Fri, 13 Nov and Mon, 16 Nov. Add the times you left on Today.",
    );
    expect(
      send('missing_checkout', { dates: ['2026-11-16', '2026-11-12', '2026-11-13'] }).body,
    ).toBe(
      'You have 3 missing check-outs, the latest on Mon, 16 Nov. Add the times you left on Today.',
    );
  });

  it('escapes the sender in Slack, never in the bell', () => {
    const message = send('check_out', {}, '<Neha & co>');
    expect(message.title).toBe('<Neha & co> reminded you to check out');
    expect(message.slack.startsWith('*&lt;Neha &amp; co&gt;* reminded you to check out.')).toBe(
      true,
    );
  });
});

const NO_ONE = { notCheckedIn: [], late: [], onLeave: [], wfh: [] };
const MORNING = {
  date: TODAY,
  time: '10:00 AM',
  notCheckedIn: [
    { name: 'Priya Sharma', startsAt: null },
    { name: 'Karan Mehta', startsAt: null },
    { name: 'Rohit Verma', startsAt: '11:00' },
  ],
  late: [
    { name: 'Vishal Saini', minutes: 22 },
    { name: 'Ankit Rana', minutes: 8 },
  ],
  onLeave: [{ name: 'Meera Nair', part: 'first_half' }],
  wfh: ['Neha Kapoor', 'Sam Lee'],
  waiting: { corrections: 1, wfh: 2 },
  missing: { count: 1, names: ['Karan Mehta'], label: 'from yesterday' },
};

describe('morningMessage', () => {
  it('writes the exact Slack block, the counts and the filtered link', () => {
    const message = morningMessage(MORNING, { origin: ORIGIN });
    expect(message.slack).toBe(
      [
        '*Morning attendance, Thu, 19 Nov* (10:00 AM)',
        '*Not checked in (3):* Priya Sharma, Karan Mehta, Rohit Verma (starts 11:00)',
        '*Late (2):* Vishal Saini 22m, Ankit Rana 8m',
        '*On leave (1):* Meera Nair, first half',
        '*Working from home (2):* Neha Kapoor, Sam Lee',
        '*Waiting for you:* 1 correction request, 2 work from home requests',
        '*Missing check-outs from yesterday (1):* Karan Mehta',
        `<${ORIGIN}/attendance|Open Attendance>`,
      ].join('\n'),
    );
    expect(message.title).toBe('Morning attendance: 3 not checked in, 2 late');
    expect(message.body).toBe(
      '1 on leave · 2 WFH · 3 waiting for you · 1 missing check-out from yesterday',
    );
    expect(message.link).toBe('/attendance?filter=not_checked_in');
  });

  it('leaves empty lines out and says when everything is clear', () => {
    const late = morningMessage(
      {
        ...MORNING,
        ...NO_ONE,
        late: MORNING.late,
        waiting: { corrections: 0, wfh: 0 },
        missing: { count: 0, names: [], label: 'from yesterday' },
      },
      { origin: ORIGIN },
    );
    expect(late.title).toBe('Morning attendance: 2 late');
    expect(late.body).toBe('Nothing is waiting for you.');
    expect(late.link).toBe('/attendance');
    expect(late.slack.split('\n')).toHaveLength(3);
    const clear = morningMessage(
      {
        ...MORNING,
        ...NO_ONE,
        waiting: { corrections: 0, wfh: 0 },
        missing: { count: 0, names: [], label: 'from yesterday' },
      },
      { origin: ORIGIN },
    );
    expect(clear.title).toBe('Morning attendance: everyone has checked in');
    expect(clear.slack.split('\n')[1]).toBe(
      'Everyone has checked in and nothing is waiting for you.',
    );
  });

  it('shows 15 names a line, then "and 4 more", escaped, and keeps the bell short', () => {
    const many = Array.from({ length: 19 }, (_, index) => ({ name: `Person ${index + 1}` }));
    many[0] = { name: '<Neha & co>' };
    const message = morningMessage(
      { ...MORNING, notCheckedIn: many.map((entry) => ({ startsAt: null, ...entry })) },
      { origin: ORIGIN },
    );
    const line = message.slack.split('\n')[1];
    expect(line.startsWith('*Not checked in (19):* &lt;Neha &amp; co&gt;, Person 2,')).toBe(true);
    expect(line.endsWith('Person 15 and 4 more')).toBe(true);
    expect(message.title.length).toBeLessThan(200);
    expect(message.body.length).toBeLessThan(500);
  });
});

const EVENING = {
  date: TODAY,
  time: '7:00 PM',
  stillIn: [{ name: 'Priya Sharma', since: '9:32' }],
  onShift: 1,
  reportsNotIn: ['Karan Mehta', 'Sam Lee', 'Rohit Verma'],
  over: [
    { name: 'Karan Mehta', minutes: 25 },
    { name: 'Sam Lee', minutes: 10 },
  ],
  autos: {
    from: '2026-11-13',
    items: [{ name: 'Rohit Verma', time: '6:12 PM', workDate: '2026-11-13' }],
  },
};

describe('eveningMessage', () => {
  it('writes the lists, "1 still on their shift" and the count-first body', () => {
    const message = eveningMessage(EVENING, { origin: ORIGIN });
    expect(message.slack).toBe(
      [
        '*Evening attendance, Thu, 19 Nov* (7:00 PM)',
        '*Still checked in (1):* Priya Sharma (since 9:32) and 1 still on their shift',
        '*Reports not in (3):* Karan Mehta, Sam Lee, Rohit Verma',
        '*Over the break allowance (2):* Karan Mehta, over by 25m, Sam Lee, over by 10m',
        '*Auto check-outs since Fri, 13 Nov (1):* Rohit Verma at 6:12 PM on Fri, 13 Nov',
        `<${ORIGIN}/attendance|Open Attendance>`,
      ].join('\n'),
    );
    expect(message.title).toBe('Evening attendance: 1 still checked in');
    expect(message.body).toBe(
      '3 reports not in · 2 over the break allowance · 1 auto check-out since Fri, 13 Nov',
    );
    expect(message.link).toBe('/attendance');
  });

  it('only people on their shift, then nothing at all', () => {
    const empty = {
      ...EVENING,
      stillIn: [],
      reportsNotIn: [],
      over: [],
      autos: { from: '2026-11-13', items: [] },
    };
    const shift = eveningMessage(empty, { origin: ORIGIN });
    expect(shift.title).toBe('Evening attendance: 1 still on their shift');
    expect(shift.slack.split('\n')[1]).toBe('*Still checked in:* 1 still on their shift');
    expect(shift.body).toBe('Nothing else to look at.');
    const done = eveningMessage({ ...empty, onShift: 0 }, { origin: ORIGIN });
    expect(done.title).toBe('Evening attendance: everyone has checked out');
    expect(done.slack.split('\n')[1]).toBe('Everyone has checked out and every report is in.');
  });
});
