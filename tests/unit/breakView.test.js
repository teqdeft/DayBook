// How a break reads in HR's break list (CONTRACT 25, item 2): labels, notes, one row's view, the
// "to" words of the messages and the list's description line.
import { describe, expect, it } from 'vitest';
import { localToUtc } from '@/lib/time';
import {
  breakLabel,
  breakListDescription,
  breakNote,
  clockWords,
  toBreakView,
} from '@/modules/attendance/breakView';

const TZ = 'Asia/Kolkata';
const at = (clock) => localToUtc('2026-11-19', clock, TZ).toDate();

describe('labels and notes', () => {
  it('says Break, Away, removed from timer, or On break now', () => {
    expect(breakLabel({ endedAt: at('13:45'), source: 'self' })).toBe('Break');
    expect(breakLabel({ endedAt: at('13:45'), source: 'away' })).toBe('Away, removed from timer');
    expect(breakLabel({ endedAt: null, source: 'self' })).toBe('On break now');
  });

  it('notes how it ended, or who changed it', () => {
    expect(breakNote({ endReason: 'checkout' })).toBe('Ended at check-out');
    expect(breakNote({ endReason: 'timer' })).toBe('Ended when a timer started');
    expect(breakNote({ endReason: 'midnight' })).toBe('Closed at midnight');
    expect(breakNote({ endReason: 'self' })).toBeNull();
    expect(breakNote({ endReason: 'away' })).toBeNull();
    expect(breakNote({ endReason: 'hr', changedById: 4 }, 'Neha Kapoor')).toBe(
      'Changed by Neha Kapoor',
    );
  });
});

describe('toBreakView', () => {
  const item = {
    id: 9,
    startedAt: at('13:10'),
    endedAt: at('13:45'),
    endReason: 'hr',
    source: 'away',
    changedById: 4,
  };

  it('gives clocks in company time, minutes, the label and note', () => {
    const view = toBreakView(item, { tz: TZ, at: at('15:00'), changedBy: { id: 4, name: 'Neha' } });
    expect(view).toEqual({
      id: 9,
      startedAt: at('13:10').toISOString(),
      endedAt: at('13:45').toISOString(),
      startClock: '13:10',
      endClock: '13:45',
      minutes: 35,
      open: false,
      source: 'away',
      endReason: 'hr',
      label: 'Away, removed from timer',
      note: 'Changed by Neha',
      changedBy: { id: 4, name: 'Neha' },
    });
  });

  it('counts an open break to now and reads a 1.09 row as the person’s own', () => {
    const open = { id: 2, startedAt: at('13:10'), endedAt: null, endReason: null };
    expect(toBreakView(open, { tz: TZ, at: at('13:35') })).toMatchObject({
      endClock: null,
      minutes: 25,
      open: true,
      source: 'self',
      label: 'On break now',
      note: null,
      changedBy: null,
    });
  });
});

describe('words', () => {
  it('writes two clocks with "to"', () => {
    expect(clockWords('14:00', '14:15')).toBe('2:00 to 2:15 PM');
    expect(clockWords('11:50', '12:10')).toBe('11:50 AM to 12:10 PM');
  });

  it('builds the description line', () => {
    const day = { dayLabel: 'Thu, 19 Nov', count: 3 };
    expect(
      breakListDescription({
        ...day,
        sinceClock: '1:10',
        breakMinutes: 65,
        overAllowanceMinutes: 5,
      }),
    ).toBe('Thu, 19 Nov · On break since 1:10 · Breaks 1h 5m · Over 5m');
    expect(breakListDescription({ ...day, breakMinutes: 45, overAllowanceMinutes: 0 })).toBe(
      'Thu, 19 Nov · Breaks 45m',
    );
    expect(
      breakListDescription({ ...day, count: 0, breakMinutes: 0, overAllowanceMinutes: 0 }),
    ).toBe('Thu, 19 Nov');
  });
});
