// checkin-reminders: every minute on working days (not on a company holiday) while
// checkin_reminder_minutes is above 0 (CONTRACT 25, item 5). Reminds people who haven't checked
// in once their own late mark plus that many minutes has passed, at most an hour late and before
// their day ends. Once a day per person (the reminder rows and auto_key), so there is no run key.
import { logger } from '@/lib/logger';
import { attendance } from '@/modules/attendance';
import { companyNow } from '../clock';

export const checkinRemindersJob = {
  name: 'checkin-reminders',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, workingDay } = await companyNow();
    if (!workingDay || !(settings.checkinReminderMinutes > 0)) return null;
    const result = await attendance.sendCheckinReminders(date);
    if (result.reminded > 0) logger.info({ job: 'checkin-reminders', ...result }, 'job done');
    return result;
  },
};
