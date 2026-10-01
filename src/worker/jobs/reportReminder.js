// report-reminder: checked every minute; runs once per working day at report_reminder_at
// (company time). Notifies and DMs everyone checked in today without a submitted report.
import { reports } from '@/modules/reports';
import { companyNow, isAtOrAfter } from '../clock';
import { runOnce } from '../runOnce';

export const reportReminderJob = {
  name: 'report-reminder',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (!workingDay || !isAtOrAfter(minutes, settings.reportReminderAt)) return null;
    return runOnce('report-reminder', `report_reminder:${date}`, () =>
      reports.sendReportReminders(date),
    );
  },
};
