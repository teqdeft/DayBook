// ai-hr-notes: checked every minute; from the week's last working day (company holidays skipped,
// CONTRACT 25) to the end of that ISO week, at or after ai_hr_notes_at (company time), while HR
// notes are available (Gemini key, AI on, feature on; CONTRACT 20). HR (or the Admins when there
// is no HR) get AI notes on the week's attendance. So a Friday holiday added on Friday morning
// still gets the notes that day. Up to three runs, 10 minutes apart, once a week (the ISO week
// run key); a run after the notes were written does nothing, so a Gemini hiccup doesn't lose
// the week's notes.
import { addDays } from '@/lib/time';
import { ai } from '@/modules/ai';
import { aiSummaries } from '@/modules/aiSummaries';
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runAttempts } from '../runOnce';

/**
 * Whether `date` is on or after the week's last working day. Without holidays the last weekday
 * decides with no query; before it, one read of the holidays left in the week tells whether they
 * cover every working weekday after `date`.
 * @param {string} date the company's today
 * @param {number[]} workingDays settings.workingDays
 */
export async function onOrAfterLastWorkingDay(date, workingDays) {
  const lastWeekday = aiSummaries.lastWorkingDayOfWeek(date, workingDays);
  if (!lastWeekday) return false;
  if (date >= lastWeekday) return true;
  const holidays = await attendance.listHolidaysBetween(addDays(date, 1), lastWeekday);
  const dates = new Set(holidays.map((holiday) => holiday.date));
  const last = aiSummaries.lastWorkingDayOfWeek(date, workingDays, dates);
  return last !== null && date >= last;
}

export const aiHrNotesJob = {
  name: 'ai-hr-notes',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes } = await companyNow();
    if (!isAtOrAfter(minutes, settings.aiHrNotesAt)) return null;
    if (!(await ai.isAvailable('hr_notes'))) return null;
    if (!(await onOrAfterLastWorkingDay(date, settings.workingDays))) return null;
    return runAttempts('ai-hr-notes', `ai_hr_notes:${aiSummaries.isoWeekKey(date)}`, () =>
      aiSummaries.sendHrNotes(date),
    );
  },
};
