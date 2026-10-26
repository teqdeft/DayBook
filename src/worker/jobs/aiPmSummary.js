// ai-pm-summary: checked every minute; on working days at or after ai_pm_summary_at (company
// time), while the PM summary is available (Gemini key, AI on, feature on; CONTRACT 20). Each
// active PM whose projects had a submitted report today gets an AI summary in the bell and, with
// ai_summary_slack, as a Slack DM. Up to three runs a day, 10 minutes apart: each one writes only
// the PMs without a summary yet, so a Gemini hiccup or a run out of time doesn't lose anyone's.
// Switching AI on later the same day still runs it.
import { ai } from '@/modules/ai';
import { aiSummaries } from '@/modules/aiSummaries';
import { companyNow, isAtOrAfter } from '../clock';
import { runAttempts } from '../runOnce';

export const aiPmSummaryJob = {
  name: 'ai-pm-summary',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (!workingDay || !isAtOrAfter(minutes, settings.aiPmSummaryAt)) return null;
    if (!(await ai.isAvailable('pm_summary'))) return null;
    return runAttempts('ai-pm-summary', `ai_pm_summary:${date}`, () =>
      aiSummaries.sendPmSummaries(date),
    );
  },
};
