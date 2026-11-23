// hr-summary: checked every minute; on working days (not on a company holiday) at or after
// hr_summary_at and before office end (company time), while hr_morning_summary is on, HR (or the
// Admins when there is no HR) get the morning attendance summary (CONTRACT 25, item 1). Up to
// three runs that day, 10 minutes apart; each is safe to repeat (the once-a-day claim per
// recipient), so a recipient a failed run missed gets it from the next one. A summary that would
// arrive after office hours is not sent.
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runAttempts } from '../runOnce';

export const hrSummaryJob = {
  name: 'hr-summary',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (!settings.hrMorningSummary || !workingDay) return null;
    if (!isAtOrAfter(minutes, settings.hrSummaryAt) || isAtOrAfter(minutes, settings.officeEnd)) {
      return null;
    }
    return runAttempts('hr-summary', `hr_summary:${date}`, () =>
      attendance.sendHrMorningSummary(date),
    );
  },
};
