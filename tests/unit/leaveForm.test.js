// The Mark leave dialog's model (CONTRACT 25, item 9): Last day follows First day until picked,
// halves disabled across days (and a half falls back to a full day), the part help with the
// split, the preview query, the preview's waiting, error and ready lines, and the API body. Also
// Today's holiday and leave notice words (todayDay.js) and the Check in subtitle.
import { describe, expect, it } from 'vitest';
import {
  ERROR_LINE,
  WAITING_LINE,
  dayRange,
  initialLeaveForm,
  isOneDay,
  leaveBody,
  leaveDaysLabel,
  partHelp,
  partItems,
  previewLines,
  previewQuery,
  withFromDate,
  withToDate,
} from '@/app/(app)/attendance/leaveForm';
import { dateLine } from '@/app/(app)/attendance/holidays/HolidayDialog';
import { checkInSubtitle } from '@/app/(app)/today/CheckInCard';
import { comingUpLines, dayNotice, weekDayLabel } from '@/app/(app)/today/todayDay';

const blank = initialLeaveForm({ userId: 12, date: '2026-11-19' });

describe('leave form dates', () => {
  it('starts both days at the given day, with a full, paid, casual day', () => {
    expect(blank).toEqual({
      userId: '12',
      fromDate: '2026-11-19',
      toDate: '2026-11-19',
      toTouched: false,
      part: 'full',
      pay: 'paid',
      leaveType: 'casual',
      note: '',
      reason: '',
    });
  });

  it('moves Last day with First day until it is picked, and never leaves it before', () => {
    expect(withFromDate(blank, '2026-11-23').toDate).toBe('2026-11-23');
    const picked = withToDate(blank, '2026-11-25');
    expect(picked).toMatchObject({ toDate: '2026-11-25', toTouched: true });
    expect(withFromDate(picked, '2026-11-24').toDate).toBe('2026-11-25');
    expect(withFromDate(picked, '2026-11-27').toDate).toBe('2026-11-27');
  });

  it('disables the halves while the days differ, and a half falls back to a full day', () => {
    expect(partItems(blank).map((item) => item.disabled)).toEqual([false, false, false]);
    const half = { ...blank, part: 'first_half' };
    const longer = withToDate(half, '2026-11-20');
    expect(longer.part).toBe('full');
    expect(isOneDay(longer)).toBe(false);
    expect(partItems(longer)).toEqual([
      { value: 'full', label: 'Full day', disabled: false },
      { value: 'first_half', label: 'First half', disabled: true },
      { value: 'second_half', label: 'Second half', disabled: true },
    ]);
    expect(partHelp(longer, '14:00')).toBe('Half days are for one day.');
    expect(partHelp(blank, '14:00')).toBe('First half: until 2:00. Second half: from 2:00.');
    expect(partHelp(blank, null)).toBeNull();
  });

  it('starts an edit from the entry', () => {
    const form = initialLeaveForm({
      entry: {
        id: 3,
        user: { id: 9 },
        fromDate: '2026-11-19',
        toDate: '2026-11-20',
        part: 'full',
        paid: false,
        leaveType: 'sick',
        note: null,
      },
    });
    expect(form).toMatchObject({ userId: '9', toTouched: true, pay: 'unpaid', note: '' });
  });
});

describe('leave preview', () => {
  it('asks only once the person and the first day are there', () => {
    expect(previewQuery({ ...blank, userId: '' })).toBeNull();
    expect(previewQuery({ ...blank, fromDate: '' })).toBeNull();
    expect(previewQuery({ ...blank, toDate: '2026-11-18' })).toBeNull();
    expect(previewQuery(blank, { excludeId: 7 })).toBe(
      'userId=12&fromDate=2026-11-19&toDate=2026-11-19&part=full&excludeId=7',
    );
  });

  it('says it is waiting, or that saving checks again after an error; Save stays enabled', () => {
    expect(previewLines({ status: 'waiting', form: blank })).toEqual({
      lines: [{ text: WAITING_LINE, tone: 'muted' }],
      blocked: false,
    });
    expect(WAITING_LINE).toBe('Counting working days…');
    expect(previewLines({ status: 'error', form: blank })).toEqual({
      lines: [{ text: "Couldn't check these dates. Saving checks them again.", tone: 'muted' }],
      blocked: false,
    });
    expect(ERROR_LINE).toBe("Couldn't check these dates. Saving checks them again.");
    expect(previewLines({ status: 'idle', form: blank }).lines).toEqual([]);
  });

  it('writes the working days and every note', () => {
    const form = { ...blank, fromDate: '2026-11-05', toDate: '2026-11-09' };
    const preview = {
      workingDays: 2,
      split: '14:00',
      offDays: [
        { date: '2026-11-07', why: 'not_working' },
        { date: '2026-11-08', why: 'not_working' },
        { date: '2026-11-09', why: 'holiday', name: 'Diwali' },
        { date: '2026-11-14', why: 'not_working' },
        { date: '2026-11-15', why: 'not_working' },
      ],
      checkIns: ['2026-11-05'],
      overlap: null,
    };
    const view = previewLines({ status: 'ready', preview, form, personName: 'Priya Sharma' });
    expect(view.blocked).toBe(false);
    expect(view.lines).toEqual([
      { text: '2 working days: Thu, 5 – Mon, 9 Nov.', tone: 'main' },
      { text: "Sat, 7 Nov isn't a working day and isn't counted.", tone: 'muted' },
      { text: "Sun, 8 Nov isn't a working day and isn't counted.", tone: 'muted' },
      { text: "Mon, 9 Nov is a holiday (Diwali) and isn't counted.", tone: 'muted' },
      { text: 'and 2 more days off', tone: 'muted' },
      { text: 'Priya checked in on Thu, 5 Nov. The check-in stays.', tone: 'warn' },
    ]);
    const one = previewLines({
      status: 'ready',
      preview: { workingDays: 1, offDays: [], checkIns: [], overlap: null },
      form: blank,
    });
    expect(one.lines).toEqual([{ text: '1 working day.', tone: 'main' }]);
    const half = previewLines({
      status: 'ready',
      preview: { workingDays: 0.5, offDays: [], checkIns: [], overlap: null },
      form: { ...blank, part: 'second_half' },
    });
    expect(half.lines[0].text).toBe('Half a working day.');
  });

  it('blocks Save on an overlap or no working days', () => {
    const overlap = previewLines({
      status: 'ready',
      preview: {
        workingDays: 1,
        offDays: [],
        checkIns: [],
        overlap: { fromDate: '2026-11-18', toDate: '2026-11-23', firstDay: '2026-11-19' },
      },
      form: blank,
      personName: 'Priya Sharma',
    });
    expect(overlap.blocked).toBe(true);
    expect(overlap.lines.at(-1)).toEqual({
      text: 'Priya already has leave on Thu, 19 Nov.',
      tone: 'bad',
    });
    const none = previewLines({
      status: 'ready',
      preview: { workingDays: 0, offDays: [], checkIns: [], overlap: null },
      form: blank,
    });
    expect(none).toEqual({
      lines: [{ text: 'No working days in these dates.', tone: 'bad' }],
      blocked: true,
    });
  });
});

describe('leave body and words', () => {
  it('sends the person only when marking, the reason only when editing; a blank note is null', () => {
    expect(leaveBody({ ...blank, note: '  ', pay: 'unpaid' })).toEqual({
      userId: 12,
      fromDate: '2026-11-19',
      toDate: '2026-11-19',
      part: 'full',
      paid: false,
      leaveType: 'casual',
      note: null,
    });
    expect(leaveBody({ ...blank, reason: 'Wrong day' }, { editing: true })).toEqual({
      fromDate: '2026-11-19',
      toDate: '2026-11-19',
      part: 'full',
      paid: true,
      leaveType: 'casual',
      note: null,
      reason: 'Wrong day',
    });
  });

  it('writes day ranges as the server does', () => {
    expect(dayRange('2026-11-23', '2026-11-25')).toBe('Mon, 23 – Wed, 25 Nov');
    expect(dayRange('2026-10-30', '2026-11-02')).toBe('Fri, 30 Oct – Mon, 2 Nov');
    expect(dayRange('2026-12-31', '2027-01-01')).toBe('Thu, 31 Dec 2026 – Fri, 1 Jan 2027');
    expect(
      leaveDaysLabel({ fromDate: '2026-11-20', toDate: '2026-11-20', part: 'second_half' }),
    ).toBe('Fri, 20 Nov, second half');
  });

  it("writes the holiday dialog's live line", () => {
    const today = '2026-11-19';
    expect(dateLine('2026-11-13', today)).toBe(
      'This day has passed. Late marks of anyone who checked in that day are removed, and Admins are told.',
    );
    expect(dateLine(today, today)).toBe(
      'This is today. Late marks of anyone who checked in today are removed, and Admins are told.',
    );
    expect(dateLine('2026-11-24', today)).toBeNull();
    expect(dateLine('', today)).toBeNull();
  });
});

describe("Today's day words", () => {
  const day = {
    date: '2026-11-19',
    weekday: true,
    holiday: null,
    split: '14:00',
    leave: null,
  };
  const upcoming = { todayLeave: { markedBy: { name: 'Neha Kapoor' } } };

  it('writes the holiday and leave notices, never with a note', () => {
    expect(dayNotice({ ...day, holiday: { id: 1, name: 'Guru Nanak Jayanti' } }, null)).toEqual({
      text: "Today is a holiday: Guru Nanak Jayanti. Check in only if you're working.",
      more: null,
    });
    const leave = { id: 2, part: 'full', leaveType: 'casual', paid: true };
    expect(dayNotice({ ...day, leave }, upcoming)).toEqual({
      text: "You're on leave today. Check in only if you're working.",
      more: 'Casual leave, paid. Marked by Neha Kapoor.',
    });
    expect(dayNotice({ ...day, leave: { ...leave, part: 'first_half' } }, upcoming).text).toBe(
      "You're on leave for the first half of today, until 2:00.",
    );
    expect(
      dayNotice(
        { ...day, leave: { ...leave, part: 'second_half', leaveType: 'sick', paid: false } },
        upcoming,
      ),
    ).toEqual({
      text: "You're on leave for the second half of today, from 2:00.",
      more: 'Sick leave, unpaid. Marked by Neha Kapoor.',
    });
    expect(dayNotice(day, upcoming)).toBeNull();
    // A holiday on a day the company doesn't work changes nothing.
    expect(dayNotice({ ...day, weekday: false, holiday: { name: 'X' } }, null)).toBeNull();
  });

  it('labels This week and writes the coming up lines', () => {
    expect(weekDayLabel({ ...day, holiday: { name: 'Diwali' } })).toBe('Holiday');
    expect(weekDayLabel({ ...day, leave: { part: 'full' } })).toBe('Leave');
    expect(weekDayLabel({ ...day, leave: { part: 'first_half' } })).toBeNull();
    expect(
      comingUpLines({
        upcoming: {
          holiday: { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
          leave: {
            fromDate: '2026-11-27',
            toDate: '2026-11-27',
            part: 'first_half',
            partLabel: 'First half',
          },
        },
      }),
    ).toEqual([
      'Next holiday: Guru Nanak Jayanti, Tue, 24 Nov.',
      'Leave coming up: Fri, 27 Nov, first half.',
    ]);
  });

  it('writes the Check in subtitle from the late mark of the day', () => {
    const officeHours = '9:30 to 6:30';
    expect(checkInSubtitle({ officeHours, lateAfter: '9:30', day: { lateMark: '09:30' } })).toBe(
      'Office hours 9:30 to 6:30. Late after 9:30.',
    );
    expect(checkInSubtitle({ officeHours, lateAfter: '2:00', day: { lateMark: '14:00' } })).toBe(
      'Office hours 9:30 to 6:30. Late after 2:00.',
    );
    expect(checkInSubtitle({ officeHours, lateAfter: '9:30', day: { lateMark: null } })).toBe(
      'Office hours 9:30 to 6:30. No late mark today.',
    );
    expect(checkInSubtitle({ officeHours, lateAfter: '9:30', day: null })).toBe(
      'Office hours 9:30 to 6:30. Late after 9:30.',
    );
  });
});
