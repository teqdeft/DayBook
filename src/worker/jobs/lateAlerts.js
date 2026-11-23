// late-alerts: checked every minute; on a working day (not a company holiday) at or after
// office_end (company time), HR hear about people who reached late_alert_days late days this
// payroll month (CONTRACT 25, item 10). Up to three runs that day, 10 minutes apart; each is safe
// to repeat (the attendance_alerts claim sends once per person and month). No upper time, so a
// worker that was down all evening still sends it that day. Migration 018 claims the deploy
// day's three keys.
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runAttempts } from '../runOnce';

export const lateAlertsJob = {
  name: 'late-alerts',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes, workingDay } = await companyNow();
    if (!workingDay) return null;
    if (!isAtOrAfter(minutes, settings.officeEnd)) return null;
    return runAttempts('late-alerts', `late_alerts:${date}`, () => attendance.sendLateAlerts(date));
  },
};
