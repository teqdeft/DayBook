// The Mark leave dialog's live line (CONTRACT 25, item 9, GET /api/leave/preview): how many
// working days the dates hold for the person, which days aren't counted and why, the days they
// already checked in, and leave that overlaps. It never writes. The person is checked first, in
// the write's order, with NOT_FOUND for someone the actor may not see, so HR can't read an Admin's
// check-in days, shift or leave through it.
import { eachDay } from '@/lib/time';
import { loadCalendar } from './calendarReads';
import * as writeRepo from './calendarWriteRepo';
import { HIDDEN_FROM_PREVIEW, checkLeaveDays, checkLeavePerson } from './leaveRules';
import { guard018Write, updateNeededError } from './migration018';

/**
 * @param {{ actor: { id: number, role: string }, userId: number, fromDate: string,
 *   toDate?: string | null, part?: 'full' | 'first_half' | 'second_half',
 *   excludeId?: number | null }} input excludeId = the entry being edited (only ever one of
 *   this person's: the overlap read is the person's own entries)
 * @returns {Promise<{ workingDays: number, split: string, offDays: Array<{ date: string,
 *   why: 'holiday' | 'not_working', name?: string }>, checkIns: string[],
 *   overlap: { fromDate: string, toDate: string, firstDay: string } | null }>} workingDays in
 *   halves for a half day; split = the person's half-day split 'HH:mm'; firstDay = the first day
 *   both share
 * @throws VALIDATION_FAILED (the days), NOT_FOUND (missing, inactive, or not shown to the actor),
 *   FORBIDDEN (their own), CONFLICT (not tracked), UPDATE_NEEDED (before 018)
 */
export async function previewLeave({ actor, userId, fromDate, toDate, part = 'full', excludeId }) {
  const days = checkLeaveDays({ fromDate, toDate, part });
  const person = await checkLeavePerson({ actor, userId, hidden: HIDDEN_FROM_PREVIEW });
  const range = { from: days.fromDate, to: days.toDate };
  const [calendar, clash, rows] = await guard018Write('calendar', () =>
    Promise.all([
      loadCalendar({ ...range, userIds: [person.id], withWfh: false }),
      writeRepo.findOverlappingLeave({ userId: person.id, ...days, excludeId }),
      writeRepo.listCheckInDays({ userIds: [person.id], ...range }),
    ]),
  );
  if (!calendar.available) throw updateNeededError();
  const offDays = [];
  let working = 0;
  for (const date of eachDay(range.from, range.to)) {
    const day = calendar.dayFor(person, date);
    if (day.isWorkingDay && day.employed) {
      working += 1;
    } else if (day.holiday && day.weekday) {
      offDays.push({ date, why: 'holiday', name: day.holiday.name });
    } else {
      offDays.push({ date, why: 'not_working' });
    }
  }
  return {
    workingDays: working * (days.part === 'full' ? 1 : 0.5),
    split: calendar.dayFor(person, days.fromDate).split,
    offDays,
    checkIns: rows.map((row) => row.workDate).sort(),
    overlap: clash
      ? {
          fromDate: clash.fromDate,
          toDate: clash.toDate,
          firstDay: clash.fromDate > days.fromDate ? clash.fromDate : days.fromDate,
        }
      : null,
  };
}
