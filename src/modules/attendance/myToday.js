// What Today adds in 1.10 (CONTRACT 25) to the person's own state (getMyToday): their day (with
// their own leave type and pay), the next own leave and the next holiday, and their missing
// check-outs for the pop-up. Never HR's leave note.
import { addDays } from '@/lib/time';
import { getDay, nextHoliday } from './calendarReads';
import * as checkouts from './checkoutExports';
import { getMyLeave } from './leaveReads';

const LOOK_AHEAD_DAYS = 14;
const NO_MISSING = { items: [], autoOpen: false };

/**
 * Today's day, upcoming leave and holiday, and missing check-outs for the signed-in person.
 * @param {{ user: object, workDate: string }} input workDate = today's company date
 * @returns {Promise<{ day: PersonDay, upcoming: { leave: object | null,
 *   holiday: { date: string, name: string } | null, todayLeave: object | null },
 *   missing: { items: object[], autoOpen: boolean } }>} upcoming.leave = the next own leave
 *   starting tomorrow to 14 days ahead and todayLeave = the entry covering today, both in the
 *   getMyLeave() shape (with markedBy, never the note); missing = listMyMissingCheckouts() for
 *   people who track attendance
 */
export async function myTodayExtras({ user, workDate }) {
  const tomorrow = addDays(workDate, 1);
  const [day, leave, holiday, missing] = await Promise.all([
    getDay({ person: user, date: workDate, withWfh: true, leaveDetail: true }),
    getMyLeave({ user, from: workDate, to: addDays(workDate, LOOK_AHEAD_DAYS) }),
    nextHoliday(tomorrow, { withinDays: LOOK_AHEAD_DAYS }),
    user.tracksAttendance ? checkouts.listMyMissingCheckouts({ user }) : NO_MISSING,
  ]);
  return {
    day,
    upcoming: {
      leave: leave.find((entry) => entry.fromDate >= tomorrow) ?? null,
      holiday,
      todayLeave: day.leave ? (leave.find((entry) => entry.fromDate <= workDate) ?? null) : null,
    },
    missing,
  };
}
