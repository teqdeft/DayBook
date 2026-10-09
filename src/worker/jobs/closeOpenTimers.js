// close-open-timers: once a day at 00:05 company time. Ends timers and breaks still running from an
// earlier day (CONTRACT 15): timers at the check-out or the last screen-time report, breaks at the
// check-out or their own start.
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { companyNow, isAtOrAfter } from '../clock';
import { runOnce } from '../runOnce';

const RUN_AT = '00:05';

export const closeOpenTimersJob = {
  name: 'close-open-timers',
  cron: '0 * * * * *',
  async tick() {
    const { date, minutes } = await companyNow();
    if (!isAtOrAfter(minutes, RUN_AT)) return null;
    return runOnce('close-open-timers', `close_open_timers:${date}`, async () => {
      const closedTimers = await timers.closeForgotten(date);
      const closedBreaks = await attendance.closeForgottenBreaks(date);
      return { timers: closedTimers.closed, breaks: closedBreaks.closed };
    });
  },
};
