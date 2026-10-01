// mark-missing-checkouts: once a day at 00:05 company time. Sets yesterday's open check-ins to
// missing and notifies HR (the attendance service honours auto_mark_missing_checkout).
import { attendance } from '@/modules/attendance';
import { companyNow, isAtOrAfter } from '../clock';
import { runOnce } from '../runOnce';

const RUN_AT = '00:05';

export const markMissingCheckoutsJob = {
  name: 'mark-missing-checkouts',
  cron: '0 * * * * *',
  async tick() {
    const { date, minutes } = await companyNow();
    if (!isAtOrAfter(minutes, RUN_AT)) return null;
    return runOnce('mark-missing-checkouts', `mark_missing_checkouts:${date}`, () =>
      attendance.markMissingCheckouts(),
    );
  },
};
