import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatHours,
  isWorkingDay,
  lateMinutesFor,
  locksAtFor,
  minutesToHours,
  workDate,
  workingDaysBetween,
  formatDay,
  formatDayShort,
} from '@/lib/time';

const TZ = 'Asia/Kolkata';

describe('time', () => {
  it('uses the company time zone for the work date', () => {
    // 20:00 UTC on 29 Sep is 01:30 IST on 30 Sep.
    expect(workDate(TZ, new Date('2026-09-29T20:00:00Z'))).toBe('2026-09-30');
  });

  it('counts late minutes after late_after on working days only', () => {
    const checkInAt = new Date('2026-09-30T04:38:00Z'); // 10:08 IST
    expect(
      lateMinutesFor({
        checkInAt,
        date: '2026-09-30',
        lateAfter: '09:30',
        tz: TZ,
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(38);
    expect(
      lateMinutesFor({
        checkInAt: new Date('2026-09-30T04:00:59Z'),
        date: '2026-09-30',
        lateAfter: '09:30',
        tz: TZ,
      }),
    ).toBe(0);
    // Saturday 3 Oct: not a working day.
    expect(
      lateMinutesFor({
        checkInAt: new Date('2026-10-03T05:00:00Z'),
        date: '2026-10-03',
        lateAfter: '09:30',
        tz: TZ,
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(0);
  });

  it('locks a report at 12:00 the next day in company time', () => {
    expect(locksAtFor('2026-09-30', 'next_day_12:00', TZ).toISOString()).toBe(
      '2026-10-01T06:30:00.000Z',
    );
  });

  it('knows working days', () => {
    expect(isWorkingDay('2026-09-30', [1, 2, 3, 4, 5])).toBe(true);
    expect(isWorkingDay('2026-10-04', [1, 2, 3, 4, 5])).toBe(false);
    expect(workingDaysBetween('2026-09-23', '2026-09-30', [1, 2, 3, 4, 5])).toBe(5);
  });

  it('formats hours and durations like the design', () => {
    expect(formatHours(480)).toBe('8h');
    expect(formatHours(510)).toBe('8.5h');
    expect(formatHours(338, 1)).toBe('5.6h');
    expect(minutesToHours(15)).toBe('0.25');
    expect(formatDuration(542)).toBe('9h 2m');
    expect(formatDuration(480)).toBe('8h');
    expect(formatDay('2026-09-30')).toBe('Wednesday, 30 September');
    expect(formatDayShort('2026-09-30')).toBe('Wed, 30 Sep');
  });
});
