// The suggested check-out time and the self-fix limit (CONTRACT 25, items B and 7). Pure, no
// database.
import { describe, expect, it } from 'vitest';
import { personDay } from '@/modules/attendance/calendar';
import {
  isOverLimit,
  isSuggestedTime,
  selfFixLimit,
  suggestedCheckoutAt,
} from '@/modules/attendance/missingRules';

const TZ = 'Asia/Kolkata';
const SETTINGS = {
  timezone: TZ,
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  lateAfter: '09:30',
};
const PERSON = { id: 7, tracksAttendance: true };
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const at = (clock, date = FRI) => new Date(`${date}T${clock}+05:30`);
const LATER = at('10:00:00', '2026-11-19'); // "now": days after the work date
const ROW = { workDate: FRI, checkInAt: at('09:32:00') };

const seg = (state, source, from, to, date = FRI) => ({
  state,
  source,
  startedAt: at(from, date),
  endedAt: at(to, date),
});

function suggest(input) {
  return suggestedCheckoutAt({ row: ROW, tz: TZ, at: LATER, ...input });
}

function day(date, overrides = {}) {
  return personDay({ date, person: PERSON, settings: SETTINGS, ...overrides });
}

function limit({ date = FRI, suggestedAt = null, ...overrides } = {}) {
  const result = selfFixLimit({
    row: { workDate: date },
    day: day(date, overrides),
    suggestedAt,
    tz: TZ,
  });
  return { ...result, clock: result.limitAt ? clockOf(result.limitAt) : null };
}

const clockOf = (value) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(
    value,
  );

describe('suggestedCheckoutAt', () => {
  it('takes the last active screen time of any source, cut to the minute', () => {
    const segments = [
      seg('active', 'system', '09:35:00', '13:00:00'),
      seg('active', 'window', '14:00:00', '18:41:37'),
    ];
    expect(suggest({ segments })).toEqual(at('18:41:00'));
  });

  it('counts window-mode idle, but not system idle or locked', () => {
    const segments = [
      seg('active', 'system', '09:35:00', '17:00:00'),
      seg('idle', 'window', '17:00:00', '17:45:10'),
      seg('idle', 'system', '17:45:10', '19:30:00'),
      seg('locked', 'system', '19:30:00', '21:00:00'),
    ];
    expect(suggest({ segments })).toEqual(at('17:45:00'));
  });

  it("counts the timer's last finished run and break starts and ends", () => {
    expect(suggest({ timerAt: at('18:52:30') })).toEqual(at('18:52:00'));
    const breaks = [{ startedAt: at('13:00:00'), endedAt: at('13:40:59') }];
    expect(suggest({ breaks })).toEqual(at('13:40:00'));
  });

  it('is null with nothing after the check-in, or no sign at all', () => {
    expect(suggest({})).toBeNull();
    expect(suggest({ segments: [seg('active', 'system', '08:00:00', '09:31:00')] })).toBeNull();
    // 9:32:20 cut to 9:32 isn't after a 9:32 check-in.
    expect(suggest({ timerAt: at('09:32:20') })).toBeNull();
  });

  it('caps `at` at the end of the work date, and never goes past 23:59', () => {
    const late = [seg('active', 'system', '22:00:00', '23:59:50')];
    expect(suggest({ segments: late })).toEqual(at('23:59:00'));
    // Still working past midnight: the end of the work date, written as 23:59.
    const overnight = { ...seg('active', 'system', '22:00:00', '23:00:00'), endedAt: LATER };
    expect(suggest({ segments: [overnight] })).toEqual(at('23:59:00'));
    // Asked during the day itself: never after now.
    const now = at('15:10:45');
    const running = [{ ...seg('active', 'system', '09:35:00', '15:00:00'), endedAt: LATER }];
    expect(suggest({ segments: running, at: now })).toEqual(at('15:10:00'));
  });
});

describe('selfFixLimit', () => {
  it('is the own shift end, or the suggestion + 15 minutes when that is later', () => {
    expect(limit({ suggestedAt: at('18:41:00') })).toMatchObject({
      clock: '18:56',
      basis: 'suggestion',
    });
    expect(limit({ suggestedAt: at('13:05:00') })).toMatchObject({
      clock: '18:30',
      basis: 'shift_end',
    });
    const own = { ...PERSON, shiftStart: '10:00', shiftEnd: '19:00' };
    expect(limit({ person: own, suggestedAt: at('18:00:00') })).toMatchObject({
      clock: '19:00',
      basis: 'shift_end',
    });
  });

  it('uses the shift end on second-half leave, never the split', () => {
    const leave = { id: 3, part: 'second_half' };
    expect(day(FRI, { leave })).toMatchObject({ expected: 0.5, dayEnd: '14:00' });
    expect(limit({ leave })).toMatchObject({ clock: '18:30', basis: 'shift_end' });
    expect(limit({ leave, suggestedAt: at('13:30:00') })).toMatchObject({ clock: '18:30' });
  });

  it('is the shift end on a working day with no suggestion', () => {
    expect(limit()).toMatchObject({ clock: '18:30', basis: 'shift_end' });
  });

  it('never goes past 23:59 of the work date', () => {
    expect(limit({ suggestedAt: at('23:50:00') })).toMatchObject({ clock: '23:59' });
    expect(limit({ date: SAT, suggestedAt: at('23:50:00', SAT) })).toMatchObject({
      clock: '23:59',
    });
  });

  it('a Saturday, a holiday and full-day leave: the suggestion + 15 only, else no limit', () => {
    const holiday = { id: 1, name: 'Guru Nanak Jayanti' };
    const leave = { id: 4, part: 'full' };
    const cases = [
      { date: SAT, suggestedAt: at('13:00:00', SAT) },
      { holiday, suggestedAt: at('13:00:00') },
      { leave, suggestedAt: at('13:00:00') },
    ];
    for (const input of cases) {
      expect(limit(input)).toMatchObject({ clock: '13:15', basis: 'suggestion' });
      expect(limit({ ...input, suggestedAt: null })).toEqual({
        limitAt: null,
        basis: 'none',
        clock: null,
      });
    }
  });

  it('before joining there is no shift either', () => {
    const person = { ...PERSON, joinedOn: '2026-11-16' };
    expect(limit({ person, suggestedAt: null })).toMatchObject({ limitAt: null, basis: 'none' });
  });
});

describe('isOverLimit and isSuggestedTime', () => {
  it('a time after the limit, or any time without one, needs HR', () => {
    const limitAt = at('18:56:00');
    expect(isOverLimit(at('18:56:00'), limitAt)).toBe(false);
    expect(isOverLimit(at('18:57:00'), limitAt)).toBe(true);
    expect(isOverLimit(at('09:40:00'), null)).toBe(true);
  });

  it("compares HR's time with the suggestion to the minute", () => {
    expect(isSuggestedTime(at('18:41:00'), at('18:41:00'))).toBe(true);
    expect(isSuggestedTime(at('18:41:00'), at('18:42:00'))).toBe(false);
    expect(isSuggestedTime(null, at('18:41:00'))).toBe(false);
  });
});
