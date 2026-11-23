// The month calendar (Employee detail, HR's person month): dayTone with the person's day
// (holidays and leave, CONTRACT 25) and buildCalendar with a range and toneOf.
import { describe, expect, it } from 'vitest';
import { buildCalendar, dayTone } from '@/modules/dashboard/calendar';

const profile = { joinedOn: '2024-03-04', deactivatedOn: null, tracksAttendance: true };
const today = '2026-11-19';
const ctx = { settings: { workingDays: [1, 2, 3, 4, 5] }, today };

/** A PersonDay as the attendance module answers it (only the fields the calendar reads). */
function personDay(overrides = {}) {
  return {
    holiday: null,
    leave: null,
    employed: true,
    expected: 1,
    lateMark: '09:30',
    ...overrides,
  };
}

const office = { workDate: '2026-11-17', lateMinutes: 0, location: 'office' };

describe('dayTone', () => {
  it('keeps the 1.09 tones without a day', () => {
    expect(dayTone({ date: '2026-11-20', row: null, profile, today })).toBe('future');
    expect(dayTone({ date: '2026-11-17', row: office, profile, today })).toBe('office');
    expect(
      dayTone({ date: '2026-11-17', row: { ...office, location: 'wfh' }, profile, today }),
    ).toBe('wfh');
    expect(
      dayTone({ date: '2026-11-17', row: { ...office, lateMinutes: 22 }, profile, today }),
    ).toBe('late');
    expect(dayTone({ date: '2026-11-17', row: null, profile, today })).toBe('missing');
    expect(dayTone({ date: today, row: null, profile, today })).toBe('missing');
    expect(dayTone({ date: '2024-03-01', row: null, profile, today })).toBe('weekend');
    expect(
      dayTone({
        date: '2026-11-17',
        row: null,
        profile: { ...profile, tracksAttendance: false },
        today,
      }),
    ).toBe('weekend');
    expect(
      dayTone({
        date: '2026-11-17',
        row: null,
        profile: { ...profile, deactivatedOn: '2026-11-10' },
        today,
      }),
    ).toBe('weekend');
  });

  it('answers holiday and leave for a day without a check-in, days to come too', () => {
    const holiday = personDay({
      holiday: { id: 1, name: 'Guru Nanak Jayanti' },
      expected: 0,
      lateMark: null,
    });
    const leave = personDay({ leave: { id: 4, part: 'full' }, expected: 0, lateMark: null });
    const half = personDay({ leave: { id: 5, part: 'first_half' }, expected: 0.5 });
    expect(dayTone({ date: '2026-11-16', row: null, profile, today, day: holiday })).toBe(
      'holiday',
    );
    expect(dayTone({ date: '2026-11-24', row: null, profile, today, day: holiday })).toBe(
      'holiday',
    );
    expect(dayTone({ date: '2026-11-16', row: null, profile, today, day: leave })).toBe('leave');
    expect(dayTone({ date: '2026-11-27', row: null, profile, today, day: leave })).toBe('leave');
    expect(dayTone({ date: '2026-11-16', row: null, profile, today, day: half })).toBe('leave');
    // A plain working day is unchanged.
    expect(dayTone({ date: '2026-11-16', row: null, profile, today, day: personDay() })).toBe(
      'missing',
    );
    expect(dayTone({ date: '2026-11-27', row: null, profile, today, day: personDay() })).toBe(
      'future',
    );
  });

  it('a check-in wins, and a day without a late mark is never late', () => {
    const holiday = personDay({ holiday: { id: 1, name: 'Diwali' }, expected: 0, lateMark: null });
    const late = { ...office, lateMinutes: 40 };
    expect(dayTone({ date: '2026-11-17', row: late, profile, today, day: holiday })).toBe('office');
    expect(dayTone({ date: '2026-11-17', row: late, profile, today, day: personDay() })).toBe(
      'late',
    );
    const leaveDay = personDay({ leave: { id: 4, part: 'full' }, expected: 0, lateMark: null });
    expect(
      dayTone({
        date: '2026-11-17',
        row: { ...office, location: 'wfh' },
        profile,
        today,
        day: leaveDay,
      }),
    ).toBe('wfh');
  });

  it('stays neutral outside employment and on days nobody expected them', () => {
    const holiday = personDay({ holiday: { id: 1, name: 'Diwali' }, expected: 0, lateMark: null });
    expect(dayTone({ date: '2024-03-01', row: null, profile, today, day: holiday })).toBe(
      'weekend',
    );
    expect(
      dayTone({
        date: '2026-11-16',
        row: null,
        profile,
        today,
        day: { ...holiday, employed: false },
      }),
    ).toBe('weekend');
    expect(
      dayTone({
        date: '2026-11-16',
        row: null,
        profile,
        today,
        day: personDay({ expected: 0, lateMark: null }),
      }),
    ).toBe('weekend');
  });
});

describe('buildCalendar', () => {
  it('draws the calendar month by default, as before', () => {
    const calendar = buildCalendar({ month: '2026-11', attendance: [office], profile, ctx });
    expect(calendar.title).toBe('Attendance, November');
    expect(calendar.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(calendar.weeks).toHaveLength(5);
    // 1 Nov 2026 is a Sunday: the first week is Mon 2 to Fri 6.
    expect(calendar.weeks[0][0]).toMatchObject({ date: '2026-11-02', day: 2, tone: 'missing' });
    expect(calendar.weeks[2][1]).toMatchObject({ date: '2026-11-17', tone: 'office' });
    expect(calendar.weeks[2][3]).toMatchObject({ date: today, isToday: true, tone: 'missing' });
    expect(calendar.weeks[4].map((cell) => cell.tone)).toEqual([
      'future',
      'future',
      'future',
      'future',
      'future',
    ]);
    // Monday 30 Nov, then December days still to come.
    expect(calendar.weeks[4][1]).toMatchObject({ date: '2026-12-01', tone: 'future' });
  });

  it('draws a payroll month with range: 26 Oct to 25 Nov', () => {
    const calendar = buildCalendar({
      month: '2026-11',
      attendance: [office],
      profile,
      ctx,
      range: { from: '2026-10-26', to: '2026-11-25' },
    });
    expect(calendar.weeks).toHaveLength(5);
    expect(calendar.weeks[0][0]).toMatchObject({ date: '2026-10-26', day: 26, tone: 'missing' });
    expect(calendar.weeks[0][4]).toMatchObject({ date: '2026-10-30', day: 30 });
    expect(calendar.weeks[4].map((cell) => [cell.date, cell.tone])).toEqual([
      ['2026-11-23', 'future'],
      ['2026-11-24', 'future'],
      ['2026-11-25', 'future'],
      ['2026-11-26', 'future'],
      ['2026-11-27', 'future'],
    ]);
    // A past range from a Wednesday to a Wednesday: the days around it are empty.
    const past = buildCalendar({
      month: '2026-09',
      attendance: [],
      profile,
      ctx,
      range: { from: '2026-09-02', to: '2026-10-07' },
    });
    expect(past.weeks).toHaveLength(6);
    expect(past.weeks[0].map((cell) => cell.tone)).toEqual([
      'empty',
      'empty',
      'missing',
      'missing',
      'missing',
    ]);
    expect(past.weeks[0][2]).toMatchObject({ date: '2026-09-02', day: 2 });
    expect(past.weeks.at(-1).map((cell) => cell.date ?? null)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      null,
      null,
    ]);
    // A week with no day in the range is left out (26 Sep 2026 is a Saturday).
    const weekendStart = buildCalendar({
      month: '2026-10',
      attendance: [],
      profile,
      ctx,
      range: { from: '2026-09-26', to: '2026-10-25' },
    });
    expect(weekendStart.weeks[0][0]).toMatchObject({ date: '2026-09-28', tone: 'missing' });
    expect(weekendStart.weeks.at(-1)[4]).toMatchObject({ date: '2026-10-23' });
  });

  it('takes a tone from toneOf, and dayTone with dayOf when toneOf has none', () => {
    const days = {
      '2026-11-16': personDay({ holiday: { id: 1, name: 'Diwali' }, expected: 0, lateMark: null }),
      '2026-11-24': personDay({ leave: { id: 3, part: 'full' }, expected: 0, lateMark: null }),
    };
    const seen = [];
    const calendar = buildCalendar({
      month: '2026-11',
      attendance: [office],
      profile,
      ctx,
      toneOf: (date, { row }) => {
        seen.push([date, row?.workDate ?? null]);
        return date === '2026-11-18' ? 'missing' : undefined;
      },
      dayOf: (date) => days[date] ?? personDay(),
    });
    const toneOn = (date) => calendar.weeks.flat().find((cell) => cell.date === date)?.tone ?? null;
    expect(toneOn('2026-11-16')).toBe('holiday');
    expect(toneOn('2026-11-17')).toBe('office');
    expect(toneOn('2026-11-18')).toBe('missing');
    expect(toneOn('2026-11-24')).toBe('leave');
    expect(toneOn('2026-11-25')).toBe('future');
    expect(seen).toContainEqual(['2026-11-17', '2026-11-17']);
    expect(seen).toContainEqual(['2026-11-16', null]);
    // Days outside the range never ask.
    expect(seen.some(([date]) => date < '2026-11-01' || date > '2026-11-30')).toBe(false);
  });
});
