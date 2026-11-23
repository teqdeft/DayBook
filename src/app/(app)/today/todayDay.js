// Today's day words (CONTRACT 25, items 6 and 9), pure: the holiday or leave notice under the top
// bar, the This week bar labels and the "coming up" lines under the help links. The person sees
// their own leave type and pay and who marked it, never HR's note (getMyToday never has it).
import { formatClockShort, formatDayShort } from '@/lib/time';
import { LEAVE_TYPE_LABELS } from '@/modules/attendance/calendar';
import { formatDayRange } from '@/modules/attendance/wording';

/**
 * The This week bar label for a past or current day without hours: "Holiday" on a holiday,
 * "Leave" on full-day leave, else null.
 * @param {PersonDay} day
 * @returns {'Holiday' | 'Leave' | null}
 */
export function weekDayLabel(day) {
  if (day?.holiday && day.weekday) return 'Holiday';
  if (day?.leave?.part === 'full') return 'Leave';
  return null;
}

/** "Casual leave, paid. Marked by Neha Kapoor." (the type and pay are the person's own). */
function leaveLine(leave, markedBy) {
  if (!leave?.leaveType) return null;
  const type = LEAVE_TYPE_LABELS[leave.leaveType] ?? LEAVE_TYPE_LABELS.other;
  const pay = leave.paid === false ? 'unpaid' : 'paid';
  const who = markedBy ? ` Marked by ${markedBy}.` : '';
  return `${type} leave, ${pay}.${who}`;
}

/**
 * Today's notice (TodayDayNotice), or null on an ordinary day:
 * - a holiday: "Today is a holiday: Guru Nanak Jayanti. Check in only if you're working.";
 * - full-day leave: "You're on leave today. Check in only if you're working.";
 * - first half: "You're on leave for the first half of today, until 2:00.";
 * - second half: "You're on leave for the second half of today, from 2:00.";
 * leave with a muted second line "Casual leave, paid. Marked by Neha Kapoor."
 * @param {PersonDay | null} day getMyToday().day (with the person's own leave type and pay)
 * @param {{ todayLeave?: { markedBy?: { name: string | null } } | null } | null} upcoming
 * @returns {{ text: string, more: string | null } | null}
 */
export function dayNotice(day, upcoming) {
  if (!day) return null;
  if (day.holiday && day.weekday) {
    return {
      text: `Today is a holiday: ${day.holiday.name}. Check in only if you're working.`,
      more: null,
    };
  }
  const leave = day.leave;
  if (!leave) return null;
  const more = leaveLine(leave, upcoming?.todayLeave?.markedBy?.name ?? null);
  const split = formatClockShort(day.split);
  if (leave.part === 'first_half') {
    return { text: `You're on leave for the first half of today, until ${split}.`, more };
  }
  if (leave.part === 'second_half') {
    return { text: `You're on leave for the second half of today, from ${split}.`, more };
  }
  return { text: "You're on leave today. Check in only if you're working.", more };
}

/**
 * The muted lines under the help links: "Next holiday: Guru Nanak Jayanti, Tue, 24 Nov." (one
 * within 14 days) and "Leave coming up: Mon, 23 – Wed, 25 Nov." (the next own leave starting
 * tomorrow to 14 days ahead; ", first half" for a half day).
 * @param {{ upcoming: { leave: object | null, holiday: { date: string, name: string } | null } }}
 *   input
 * @returns {string[]}
 */
export function comingUpLines({ upcoming }) {
  const lines = [];
  if (upcoming?.holiday) {
    lines.push(`Next holiday: ${upcoming.holiday.name}, ${formatDayShort(upcoming.holiday.date)}.`);
  }
  const leave = upcoming?.leave;
  if (leave) {
    const part = leave.part === 'full' ? '' : `, ${leave.partLabel.toLowerCase()}`;
    lines.push(`Leave coming up: ${formatDayRange(leave.fromDate, leave.toDate)}${part}.`);
  }
  return lines;
}
