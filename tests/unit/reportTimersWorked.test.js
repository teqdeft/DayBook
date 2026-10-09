// The Daily report's attendance texts with breaks (CONTRACT 15): the top bar line under the
// logged total and the gap notice compare with worked time once breaks took time off.
import { describe, expect, it } from 'vitest';
import { gapText, presentLine } from '@/app/(app)/report/reportTotals';

const base = { tracksAttendance: true, isToday: true, gapWarningMinutes: 30 };

describe('presentLine', () => {
  it('keeps the checked-in text without breaks', () => {
    expect(presentLine({ ...base, presentMinutes: 538, workedMinutes: 538 })).toBe(
      'of 8h 58m checked in',
    );
    expect(presentLine({ ...base, presentMinutes: 538 })).toBe('of 8h 58m checked in');
  });

  it('says worked time once breaks made it shorter', () => {
    expect(presentLine({ ...base, presentMinutes: 525, workedMinutes: 465 })).toBe(
      'of 7h 45m worked',
    );
  });

  it('keeps the texts for no check-in and for people who do not check in', () => {
    expect(presentLine({ ...base, presentMinutes: null, workedMinutes: null })).toBe(
      'not checked in yet',
    );
    expect(presentLine({ ...base, isToday: false, presentMinutes: null })).toBe('not checked in');
    expect(presentLine({ ...base, tracksAttendance: false, presentMinutes: null })).toBeNull();
  });
});

describe('gapText', () => {
  it('compares with present time when there were no breaks', () => {
    const data = { ...base, presentMinutes: 390, workedMinutes: 390 };
    expect(gapText(data, 480, 'draft')).toBe(
      'You logged 8h but were checked in for only 6h 30m. Check your hours before you submit.',
    );
    expect(gapText({ ...data, presentMinutes: 600, workedMinutes: 600 }, 480, 'submitted')).toBe(
      'You logged 8h but were checked in for 10h. Check your hours before you update the report.',
    );
  });

  it('compares with worked time after breaks', () => {
    const data = { ...base, presentMinutes: 495, workedMinutes: 435 };
    expect(gapText(data, 480, 'draft')).toBe(
      'You logged 8h but worked 7h 15m. Check your hours before you submit.',
    );
  });

  it('stays quiet within the allowed gap of worked time, even when present time is further', () => {
    // 8h 30m present, 1h of breaks: 7h 30m worked against 7.5h logged.
    expect(gapText({ ...base, presentMinutes: 510, workedMinutes: 450 }, 450, 'draft')).toBeNull();
    // Without the breaks the same day would have warned against 8h 30m.
    expect(gapText({ ...base, presentMinutes: 510, workedMinutes: 510 }, 450, 'draft')).toBe(
      'You logged 7.5h but were checked in for 8h 30m. Check your hours before you submit.',
    );
  });

  it('says nothing without a check-in or logged hours', () => {
    expect(
      gapText({ ...base, presentMinutes: null, workedMinutes: null }, 480, 'draft'),
    ).toBeNull();
    expect(gapText({ ...base, presentMinutes: 300, workedMinutes: 200 }, 0, 'draft')).toBeNull();
  });
});
