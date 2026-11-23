// hr-evening-summary: checked every minute; on working days (not on a company holiday) at or
// after office end + 30 minutes (23:59 at the latest, company time), while hr_evening_summary is
// on (off by default), HR (or the Admins when there is no HR) get the evening wrap-up (CONTRACT
// 25, item 1). Up to three runs that day, 10 minutes apart, each safe to repeat (the once-a-day
// claim per recipient).
import { attendance } from '@/modules/attendance';
import { companyNow } from '../clock';
import { runAttempts } from '../runOnce';

export const hrEveningSummaryJob = {
  name: 'hr-evening-summary',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (!settings.hrEveningSummary || !workingDay) return null;
    if (minutes < attendance.eveningSummaryMinutes(settings.officeEnd)) return null;
    return runAttempts('hr-evening-summary', `hr_evening_summary:${date}`, () =>
      attendance.sendHrEveningSummary(date),
    );
  },
};
