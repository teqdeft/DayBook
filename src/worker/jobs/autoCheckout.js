// auto-checkout: checked every minute; runs once per date at auto_checkout_at (company time), only
// while auto check-out is on (CONTRACT 19). Checks out people still checked in who weren't seen
// working (screen time, timers, breaks) after office end and within the hour before; anyone
// working late is left alone, and nobody is checked out while screen time is off.
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runOnce } from '../runOnce';

export const autoCheckoutJob = {
  name: 'auto-checkout',
  cron: '0 * * * * *',
  async tick() {
    const { settings, date, minutes } = await companyNow();
    if (!settings.autoCheckoutEnabled || !isAtOrAfter(minutes, settings.autoCheckoutAt)) {
      return null;
    }
    return runOnce('auto-checkout', `auto_checkout:${date}`, () => attendance.autoCheckOut(date));
  },
};
