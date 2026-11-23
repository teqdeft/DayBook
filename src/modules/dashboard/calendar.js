// The month attendance calendar on the Employee detailed view and HR's person month (CONTRACT 25,
// item 8): one row per week, one column per working weekday, each day tinted from that day's
// attendance row and the person's day (holidays and leave).
import { addDays, dayjs, formatMonth, isoWeekday, monthRange } from '@/lib/time';

const WEEKDAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

/** 'September' for a month of the current year, otherwise 'September 2025'. */
export function calendarTitle(month, today) {
  if (month.slice(0, 4) === today.slice(0, 4))
    return dayjs(`${month}-01`, 'YYYY-MM-DD').format('MMMM');
  return formatMonth(month);
}

/**
 * The tone a holiday or leave gives a day without a check-in (CONTRACT 25): 'holiday' for a
 * company holiday, 'leave' for leave HR marked (a half day too). Shown for days to come as well,
 * so planned leave is visible.
 */
function offTone(day) {
  if (!day) return null;
  if (day.holiday) return 'holiday';
  if (day.leave) return 'leave';
  return null;
}

/**
 * Tone of one day inside the month. A check-in gives late (effective late minutes above 0), WFH
 * or office. Without one: while the person is employed, a holiday or leave (`day`, the attendance
 * module's PersonDay) gives 'holiday' or 'leave', also for days to come; other future days are
 * upcoming; days before the person joined (or after they left), days they weren't expected and
 * untracked people's empty days are neutral; a past or current working day is "not checked in".
 * @param {{ date: string, row?: { lateMinutes: number, location: string } | null,
 *   profile: { joinedOn?: string | null, deactivatedOn?: string | null,
 *   tracksAttendance: boolean }, today: string, day?: object | null }} input without `day` the
 *   1.09 rules (weekdays only, no holidays or leave)
 * @returns {'office' | 'wfh' | 'late' | 'missing' | 'leave' | 'holiday' | 'future' | 'weekend'}
 */
export function dayTone({ date, row, profile, today, day = null }) {
  if (row && date <= today) {
    // Effective late: a day without a late mark (a holiday, full-day leave) is never late.
    const late = day && day.lateMark === null ? 0 : Number(row.lateMinutes);
    if (late > 0) return 'late';
    return row.location === 'wfh' ? 'wfh' : 'office';
  }
  const outside =
    (profile.joinedOn && date < profile.joinedOn) ||
    (profile.deactivatedOn && date > profile.deactivatedOn) ||
    day?.employed === false;
  const off = outside ? null : offTone(day);
  if (off) return off;
  if (date > today) return 'future';
  if (outside || (day && day.expected === 0)) return 'weekend';
  return profile.tracksAttendance ? 'missing' : 'weekend';
}

/** The weeks of the range: Monday to Sunday, the working weekdays as columns. */
function weeksOf({ from, to }, columns) {
  const weeks = [];
  for (
    let monday = addDays(from, 1 - isoWeekday(from));
    monday <= to;
    monday = addDays(monday, 7)
  ) {
    const cells = columns.map((weekday) => {
      const date = addDays(monday, weekday - 1);
      return { date, inRange: date >= from && date <= to };
    });
    if (cells.some((cell) => cell.inRange)) weeks.push(cells);
  }
  return weeks;
}

/**
 * The calendar's weeks and labels.
 * @param {{ month: string, attendance: Array<{ workDate: string }>, profile: object,
 *   ctx: { settings: { workingDays: number[] }, today: string },
 *   range?: { from: string, to: string }, toneOf?: (date: string, info: { row: object | null })
 *   => string | undefined, dayOf?: (date: string) => object | null }} input month 'YYYY-MM' (the
 *   title); range: the days shown (default the calendar month; HR's person month passes the
 *   payroll month, CONTRACT 25 item 8); toneOf: a day's tone, or undefined for dayTone's; dayOf:
 *   the person's day (PersonDay) for dayTone, so holidays and leave show
 * @returns {{ month: string, title: string, weekdays: string[], weeks: Array<Array<{ date?: string,
 *   day?: number, tone: string, isToday?: boolean }>> }}
 */
export function buildCalendar({ month, attendance, profile, ctx, range, toneOf, dayOf }) {
  const columns = [...ctx.settings.workingDays].sort((a, b) => a - b);
  const days = range ?? monthRange(month);
  const byDate = new Map(attendance.map((row) => [row.workDate, row]));
  const toneFor = (date) => {
    const row = byDate.get(date) ?? null;
    const picked = toneOf ? toneOf(date, { row }) : undefined;
    if (picked) return picked;
    return dayTone({ date, row, profile, today: ctx.today, day: dayOf ? dayOf(date) : null });
  };
  const weeks = weeksOf(days, columns).map((cells) =>
    cells.map(({ date, inRange }) => {
      const day = Number(date.slice(8, 10));
      const isToday = date === ctx.today;
      if (!inRange) {
        // Days after the range still to come show as upcoming (as on the canvas); today among
        // them keeps its outline, so the week never shows tomorrow but not today.
        return date >= ctx.today ? { date, day, tone: 'future', isToday } : { tone: 'empty' };
      }
      return { date, day, tone: toneFor(date), isToday };
    }),
  );
  return {
    month,
    title: `Attendance, ${calendarTitle(month, ctx.today)}`,
    weekdays: columns.map((weekday) => WEEKDAY_LABELS[weekday]),
    weeks,
  };
}
