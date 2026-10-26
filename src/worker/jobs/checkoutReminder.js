// checkout-reminder: checked every minute; runs once per date at office_end (company time), only
// while auto check-out is on (CONTRACT 19). Tells everyone still checked in that they are, before
// auto-checkout checks for activity at auto_checkout_at. Not sent once that check time has passed
// (the worker was down all evening): the reminder would come after the check.
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runOnce } from '../runOnce';

export const checkoutReminderJob = {
  name: 'checkout-reminder',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes } = await companyNow();
    if (!settings.autoCheckoutEnabled || !isAtOrAfter(minutes, settings.officeEnd)) return null;
    if (isAtOrAfter(minutes, settings.autoCheckoutAt)) return null;
    return runOnce('checkout-reminder', `checkout_reminder:${date}`, () =>
      attendance.sendCheckoutReminders(date),
    );
  },
};
