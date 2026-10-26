// ai-hr-notes: checked every minute; on the week's last working day at or after ai_hr_notes_at
// (company time), while HR notes are available (Gemini key, AI on, feature on; CONTRACT 20). HR
// (or the Admins when there is no HR) get AI notes on the week's attendance. Up to three runs that
// day, 10 minutes apart; a run after the notes were written does nothing, so a Gemini hiccup
// doesn't lose the week's notes.
import { ai } from '@/modules/ai';
import { aiSummaries } from '@/modules/aiSummaries';
import { companyNow, isAtOrAfter } from '../clock';
import { runAttempts } from '../runOnce';

export const aiHrNotesJob = {
  name: 'ai-hr-notes',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes } = await companyNow();
    if (date !== aiSummaries.lastWorkingDayOfWeek(date, settings.workingDays)) return null;
    if (!isAtOrAfter(minutes, settings.aiHrNotesAt)) return null;
    if (!(await ai.isAvailable('hr_notes'))) return null;
    return runAttempts('ai-hr-notes', `ai_hr_notes:${aiSummaries.isoWeekKey(date)}`, () =>
      aiSummaries.sendHrNotes(date),
    );
  },
};
