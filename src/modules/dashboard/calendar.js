// The month attendance calendar on the Employee detailed view: one row per week, one column per
// working day, each day tinted from that day's attendance row.
import { addDays, dayjs, formatMonth, isoWeekday, monthRange } from '@/lib/time';

const WEEKDAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

/** 'September' for a month of the current year, otherwise 'September 2025'. */
export function calendarTitle(month, today) {
  if (month.slice(0, 4) === today.slice(0, 4))
    return dayjs(`${month}-01`, 'YYYY-MM-DD').format('MMMM');
  return formatMonth(month);
}

/**
 * Tone of one day inside the month: future days are upcoming; days before the person joined (or
 * after they left) and untracked people's empty days are neutral; otherwise late (late_minutes >
 * 0), WFH or office from the attendance row, and "not checked in" for a past or current working
 * day without one.
 */
export function dayTone({ date, row, profile, today }) {
  if (date > today) return 'future';
  if (row) {
    if (Number(row.lateMinutes) > 0) return 'late';
    return row.location === 'wfh' ? 'wfh' : 'office';
  }
  if (profile.joinedOn && date < profile.joinedOn) return 'weekend';
  if (profile.deactivatedOn && date > profile.deactivatedOn) return 'weekend';
  return profile.tracksAttendance ? 'missing' : 'weekend';
}

/**
 * @param {{ month: string, attendance: object[], profile: object, ctx: object }} input
 * @returns {{ month: string, title: string, weekdays: string[], weeks: object[][] }}
 */
export function buildCalendar({ month, attendance, profile, ctx }) {
  const columns = [...ctx.settings.workingDays].sort((a, b) => a - b);
  const { from, to } = monthRange(month);
  const byDate = new Map(attendance.map((row) => [row.workDate, row]));
  const first = addDays(from, 1 - isoWeekday(from));
  const weeks = [];
  for (let monday = first; monday <= to; monday = addDays(monday, 7)) {
    const cells = columns.map((weekday) => {
      const date = addDays(monday, weekday - 1);
      const inMonth = date >= from && date <= to;
      return { date, inMonth };
    });
    if (!cells.some((cell) => cell.inMonth)) continue;
    weeks.push(
      cells.map(({ date, inMonth }) => {
        const day = Number(date.slice(8, 10));
        const isToday = date === ctx.today;
        if (!inMonth) {
          // Days of the next month still to come show as upcoming (as on the canvas); today among
          // them keeps its outline, so the week never shows tomorrow but not today.
          return date >= ctx.today ? { date, day, tone: 'future', isToday } : { tone: 'empty' };
        }
        const tone = dayTone({ date, row: byDate.get(date), profile, today: ctx.today });
        return { date, day, tone, isToday };
      }),
    );
  }
  return {
    month,
    title: `Attendance, ${calendarTitle(month, ctx.today)}`,
    weekdays: columns.map((weekday) => WEEKDAY_LABELS[weekday]),
    weeks,
  };
}
