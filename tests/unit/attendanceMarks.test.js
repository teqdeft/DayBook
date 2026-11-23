// Half day, short day and left early (CONTRACT 25, item 3). Pure, no database.
import { describe, expect, it } from 'vitest';
import { personDay } from '@/modules/attendance/calendar';
import { dayMarks } from '@/modules/attendance/marks';

const TZ = 'Asia/Kolkata';
const SETTINGS = {
  timezone: TZ,
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  lateAfter: '09:30',
  halfDayUnderMinutes: 270,
  shortDayUnderMinutes: 480,
  leftEarlyGraceMinutes: 15,
};
const PERSON = { id: 7, tracksAttendance: true };
const THU = '2026-11-19';
const at = (clock, date = THU) => new Date(`${date}T${clock}:00+05:30`);

function day(overrides = {}) {
  return personDay({ date: THU, person: PERSON, settings: SETTINGS, ...overrides });
}

function row(out, status = 'checked_out') {
  return { checkInAt: at('09:30'), checkOutAt: out ? at(out) : null, checkoutStatus: status };
}

function marks({ out = '18:30', worked, status, settings = SETTINGS, ...rest } = {}) {
  return dayMarks({ row: row(out, status), day: day(rest), worked, settings });
}

describe('dayMarks', () => {
  it('Half day under 270, Short day from 270 to 479, none at 480', () => {
    expect(marks({ worked: 269 })).toMatchObject({
      halfDay: true,
      shortDay: false,
      underMinutes: 270,
    });
    expect(marks({ worked: 270 })).toMatchObject({
      halfDay: false,
      shortDay: true,
      underMinutes: 480,
    });
    expect(marks({ worked: 479 })).toMatchObject({ halfDay: false, shortDay: true });
    expect(marks({ worked: 480 })).toMatchObject({
      halfDay: false,
      shortDay: false,
      underMinutes: null,
    });
  });

  it('0 turns each mark off', () => {
    const noHalf = { ...SETTINGS, halfDayUnderMinutes: 0 };
    expect(marks({ worked: 100, settings: noHalf })).toMatchObject({
      halfDay: false,
      shortDay: true,
    });
    const noShort = { ...SETTINGS, shortDayUnderMinutes: 0 };
    expect(marks({ worked: 300, settings: noShort })).toMatchObject({
      halfDay: false,
      shortDay: false,
    });
  });

  it('Left early more than the grace before the shift end', () => {
    expect(marks({ out: '18:14', worked: 500 })).toMatchObject({
      leftEarly: true,
      leftEarlyMinutes: 16,
    });
    expect(marks({ out: '18:15', worked: 500 })).toMatchObject({
      leftEarly: false,
      leftEarlyMinutes: 0,
    });
    const own = { id: 7, tracksAttendance: true, shiftStart: '10:00', shiftEnd: '19:00' };
    expect(marks({ out: '18:30', worked: 500, person: own })).toMatchObject({
      leftEarly: true,
      leftEarlyMinutes: 30,
    });
  });

  it('an auto check-out counts', () => {
    expect(marks({ out: '17:00', worked: 400, status: 'auto' })).toMatchObject({
      shortDay: true,
      leftEarly: true,
      leftEarlyMinutes: 90,
    });
  });

  it('none on an open row, a missing check-out, a weekend, a holiday or full leave without a check-in', () => {
    const none = { halfDay: false, shortDay: false, leftEarly: false };
    expect(
      dayMarks({ row: row(null, 'open'), day: day(), worked: 60, settings: SETTINGS }),
    ).toMatchObject(none);
    expect(
      dayMarks({ row: row(null, 'missing'), day: day(), worked: null, settings: SETTINGS }),
    ).toMatchObject(none);
    expect(marks({ worked: 60, date: '2026-11-21' })).toMatchObject(none);
    expect(marks({ worked: 60, holiday: { id: 1, name: 'Diwali' } })).toMatchObject(none);
    const full = day({ leave: { id: 1, part: 'full' } });
    expect(dayMarks({ row: null, day: full, worked: null, settings: SETTINGS })).toMatchObject(
      none,
    );
  });

  it('full leave with a 10:00 to 11:00 check-in is marked as a full day', () => {
    const full = day({ leave: { id: 1, part: 'full' } });
    const checkIn = {
      checkInAt: at('10:00'),
      checkOutAt: at('11:00'),
      checkoutStatus: 'checked_out',
    };
    expect(dayMarks({ row: checkIn, day: full, worked: 60, settings: SETTINGS })).toMatchObject({
      halfDay: true,
      shortDay: false,
      leftEarly: true,
      leftEarlyMinutes: 450,
    });
  });

  it('first-half leave: no Half day, Short day under 240, Left early against the shift end', () => {
    const first = { leave: { id: 1, part: 'first_half' } };
    expect(marks({ worked: 200, out: '18:30', ...first })).toMatchObject({
      halfDay: false,
      shortDay: true,
      underMinutes: 240,
      leftEarly: false,
    });
    expect(marks({ worked: 240, out: '18:00', ...first })).toMatchObject({
      shortDay: false,
      leftEarly: true,
      leftEarlyMinutes: 30,
    });
  });

  it('second-half leave: Left early against the split', () => {
    const second = { leave: { id: 1, part: 'second_half' } };
    expect(marks({ worked: 260, out: '14:00', ...second })).toMatchObject({ leftEarly: false });
    expect(marks({ worked: 230, out: '13:30', ...second })).toMatchObject({
      shortDay: true,
      leftEarly: true,
      leftEarlyMinutes: 30,
    });
  });

  it('a 10:00 to 4:00 shift scales the times to 180 and 320', () => {
    const person = { id: 7, tracksAttendance: true, shiftStart: '10:00', shiftEnd: '16:00' };
    expect(marks({ worked: 179, out: '16:00', person })).toMatchObject({
      halfDay: true,
      underMinutes: 180,
    });
    expect(marks({ worked: 180, out: '16:00', person })).toMatchObject({
      shortDay: true,
      underMinutes: 320,
    });
    expect(marks({ worked: 320, out: '16:00', person })).toMatchObject({
      halfDay: false,
      shortDay: false,
    });
  });
});
