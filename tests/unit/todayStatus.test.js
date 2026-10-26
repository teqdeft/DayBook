// Today's status words (CONTRACT 15, 17 and 19): the pill next to "Check out", including
// "Checked out automatically at 6:12" after an auto check-out, and the "Still working?" line
// under the top bar while someone is still checked in after office hours with auto check-out on.
import { afterEach, describe, expect, it } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { STILL_WORKING, statusPill, stillWorkingNote } from '@/app/(app)/today/todayStatus';

const TZ = 'Asia/Kolkata';
const DAY = '2026-10-26';
// A clock time on DAY in India (UTC+5:30), as a Date.
const at = (clock) => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${DAY}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d;
};

const OPEN = {
  workDate: DAY,
  checkInAt: at('09:32'),
  checkOutAt: null,
  checkoutStatus: 'open',
  location: 'office',
  officeVerified: true,
};
const SETTINGS = { autoCheckoutEnabled: true, officeEnd: '18:30', autoCheckoutAt: '20:00' };

afterEach(() => setNowForTests(null));

describe('statusPill', () => {
  it('says an auto check-out happened, with its time', () => {
    const row = { ...OPEN, checkOutAt: at('18:12'), checkoutStatus: 'auto' };
    expect(statusPill(row, TZ, null)).toEqual({
      tone: 'neutral',
      text: 'Checked out automatically at 6:12',
    });
  });

  it('keeps the other words: checked out, corrected, missing, break, WFH, unverified, office', () => {
    const out = { ...OPEN, checkOutAt: at('18:40'), checkoutStatus: 'checked_out' };
    expect(statusPill(out, TZ, null).text).toBe('Checked out at 6:40');
    expect(statusPill({ ...out, checkoutStatus: 'corrected' }, TZ, null).text).toBe(
      'Checked out at 6:40',
    );
    expect(statusPill({ ...OPEN, checkoutStatus: 'missing' }, TZ, null)).toEqual({
      tone: 'neutral',
      text: 'Checked out',
    });
    expect(statusPill(OPEN, TZ, { startedAt: at('13:10') })).toEqual({
      tone: 'marigold',
      text: 'On break since 1:10',
    });
    expect(statusPill({ ...OPEN, location: 'wfh' }, TZ, null)).toEqual({
      tone: 'violet',
      text: 'Working from home since 9:32',
    });
    expect(statusPill({ ...OPEN, officeVerified: false }, TZ, null)).toEqual({
      tone: 'marigold',
      text: 'In office since 9:32, unverified',
    });
    expect(statusPill(OPEN, TZ, null)).toEqual({ tone: 'green', text: 'In office since 9:32' });
    expect(statusPill(null, TZ, null)).toBeNull();
  });
});

describe('stillWorkingNote', () => {
  it('shows from office end on while the row is open and auto check-out is on', () => {
    expect(stillWorkingNote({ row: OPEN, settings: SETTINGS, tz: TZ, at: at('18:30') })).toBe(
      STILL_WORKING,
    );
    expect(stillWorkingNote({ row: OPEN, settings: SETTINGS, tz: TZ, at: at('21:15') })).toBe(
      "Still working? You'll stay checked in as long as you're active.",
    );
  });

  it('reads the current time when none is given', () => {
    setNowForTests(at('19:05').toISOString());
    expect(stillWorkingNote({ row: OPEN, settings: SETTINGS, tz: TZ })).toBe(STILL_WORKING);
    setNowForTests(at('18:29').toISOString());
    expect(stillWorkingNote({ row: OPEN, settings: SETTINGS, tz: TZ })).toBeNull();
  });

  it('stays away before office end, after check-out, without a row or with auto check-out off', () => {
    const late = at('19:00');
    expect(stillWorkingNote({ row: OPEN, settings: SETTINGS, tz: TZ, at: at('18:29') })).toBeNull();
    for (const row of [
      null,
      { ...OPEN, checkOutAt: at('18:45'), checkoutStatus: 'checked_out' },
      { ...OPEN, checkOutAt: at('18:12'), checkoutStatus: 'auto' },
      { ...OPEN, checkoutStatus: 'missing' },
    ]) {
      expect(stillWorkingNote({ row, settings: SETTINGS, tz: TZ, at: late })).toBeNull();
    }
    const off = { ...SETTINGS, autoCheckoutEnabled: false };
    expect(stillWorkingNote({ row: OPEN, settings: off, tz: TZ, at: late })).toBeNull();
  });

  it('follows the office end from Settings', () => {
    const settings = { ...SETTINGS, officeEnd: '17:00' };
    expect(stillWorkingNote({ row: OPEN, settings, tz: TZ, at: at('17:00') })).toBe(STILL_WORKING);
    expect(stillWorkingNote({ row: OPEN, settings, tz: TZ, at: at('16:59') })).toBeNull();
  });
});
