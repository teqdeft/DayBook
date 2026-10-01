// push-notifications: every 10 seconds, push new bell notifications to people's computers
// (CONTRACT 14). No runOnce: each tick claims its own rows (FOR UPDATE + pushed_at), so two
// workers never send the same notification. Routine results log at debug; failures at warn.
import { logger } from '@/lib/logger';
import { push } from '@/modules/push';

export const pushNotificationsJob = {
  name: 'push-notifications',
  cron: '*/10 * * * * *',
  async tick() {
    const result = await push.sendPending();
    const busy = result.claimed > 0 || result.skipped > 0 || result.removed > 0;
    if (result.failed > 0) {
      logger.warn({ job: 'push-notifications', ...result }, 'some desktop pushes failed');
    } else if (busy) {
      logger.debug({ job: 'push-notifications', ...result }, 'desktop pushes processed');
    }
    return result;
  },
};
