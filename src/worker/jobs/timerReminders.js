// timer-reminders: every minute while the office is open (office_start to office_end, company
// time) on working days, only when timers are required. Reminds people who have no timer running
// (CONTRACT 15); notifications.hasRecent keeps it to one an hour, so there is no run key.
import { logger } from '@/lib/logger';
import { timers } from '@/modules/timers';
import { companyNow, isAtOrAfter } from '../clock';

export const timerRemindersJob = {
  name: 'timer-reminders',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (settings.timersMode !== 'required' || !workingDay) return null;
    if (!isAtOrAfter(minutes, settings.officeStart) || isAtOrAfter(minutes, settings.officeEnd)) {
      return null;
    }
    const result = await timers.sendReminders(date);
    if (result.reminded > 0) logger.info({ job: 'timer-reminders', ...result }, 'job done');
    return result;
  },
};
