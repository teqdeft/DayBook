// My log's number cards: every duration reads in hours and minutes (a company request), and the
// late average keeps the artboard's "14 minutes" until it reaches an hour. The person's day
// (CONTRACT 25): days present may hold a half, a holiday or a day of leave reads as such, and a
// half day of leave adds its line.
import { describe, expect, it } from 'vitest';
import { attendanceItems, dayRows, kpiCards, LOG_STATUS } from '@/app/(app)/log/logView';

function log(kpis) {
  return {
    month: '2026-09',
    today: '2026-09-30',
    kpis: {
      loggedMinutes: 0,
      loggedPercent: 0,
      daysPresent: 0,
      workingDays: 0,
      presentPercent: 0,
      lateDays: 0,
      lateAverageMinutes: 0,
      latePercent: 0,
      reportsSubmitted: 0,
      reportsExpected: 0,
      reportsPercent: 0,
      ...kpis,
    },
  };
}

const card = (cards, key) => cards.find((item) => item.key === key);

describe('kpiCards', () => {
  it('shows logged hours with their minutes', () => {
    expect(card(kpiCards(log({ loggedMinutes: 8550 })), 'hours').value).toBe('142h 30m');
    expect(card(kpiCards(log({ loggedMinutes: 8520 })), 'hours').value).toBe('142h');
  });

  it('shows the late average in minutes under an hour, then in hours and minutes', () => {
    const late = (minutes) =>
      card(kpiCards(log({ lateDays: 2, lateAverageMinutes: minutes })), 'late').sub;
    expect(late(14)).toBe('average 14 minutes');
    expect(late(1)).toBe('average 1 minute');
    expect(late(60)).toBe('average 1h');
    expect(late(97)).toBe('average 1h 37m');
    expect(card(kpiCards(log({ lateDays: 0 })), 'late').sub).toBe('on time every day');
  });
});

describe("the person's day (CONTRACT 25)", () => {
  it('writes days present with a half and over the working days so far', () => {
    const present = card(kpiCards(log({ daysPresent: 19.5, workingDays: 21 })), 'present');
    expect(present).toMatchObject({ value: '19.5', sub: 'of 21 working days' });
    expect(card(kpiCards(log({ daysPresent: 1, workingDays: 1 })), 'present').sub).toBe(
      'of 1 working day',
    );
  });

  it('reads Holiday and On leave, with their notes', () => {
    expect(LOG_STATUS.holiday).toEqual({ status: 'holiday', label: 'Holiday' });
    expect(LOG_STATUS.on_leave).toEqual({ status: 'on_leave', label: 'On leave' });
    const day = (extra) => ({
      date: '2026-09-28',
      isToday: false,
      attendance: null,
      presentMinutes: 0,
      report: null,
      holiday: null,
      leave: null,
      canRequestEdit: true,
      ...extra,
    });
    const rows = dayRows({
      timezone: 'Asia/Kolkata',
      today: '2026-09-30',
      days: [
        day({ status: 'holiday', holiday: { name: 'Diwali' } }),
        day({ status: 'on_leave', leave: { part: 'full', paid: true, leaveType: 'casual' } }),
        day({ status: 'not_checked_in', leave: { part: 'second_half' } }),
      ],
    });
    expect(rows.map((row) => [row.status, row.label, row.dayNote, row.note])).toEqual([
      ['holiday', 'Holiday', 'Diwali', 'Holiday: Diwali. Nobody was expected in.'],
      ['on_leave', 'On leave', null, 'You were on leave this day.'],
      [
        'not_checked_in',
        'Not checked in',
        'Second half on leave',
        "You didn't check in or write a report on this day.",
      ],
    ]);
    expect(rows[0].action).toEqual({ kind: 'request', label: 'Request an edit' });
  });

  it('lists On leave in the attendance card only when there was some', () => {
    const counts = (leave) => ({
      attendance: { office: 3, wfh: 1, late: 0, notCheckedIn: 0.5, leave },
    });
    expect(attendanceItems(counts(0)).map((item) => item.key)).toEqual([
      'office',
      'wfh',
      'late',
      'missing',
    ]);
    expect(attendanceItems(counts(1.5)).slice(-2)).toEqual([
      { key: 'missing', label: 'Not checked in', color: 'red', value: '0.5 days' },
      { key: 'leave', label: 'On leave', color: 'teal', value: '1.5 days' },
    ]);
  });
});
