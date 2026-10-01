// slack-user-sync: every hour, look up slack_user_id by email for people who don't have one.
import { logger } from '@/lib/logger';
import { now } from '@/lib/time';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { runOnce } from '../runOnce';

export const slackUserSyncJob = {
  name: 'slack-user-sync',
  cron: '0 0 * * * *',
  async tick() {
    const current = await settings.getAll();
    if (!slack.isConfigured() || !current.slackEnabled) {
      logger.debug({ job: 'slack-user-sync' }, 'slack is not set up or turned off; sync skipped');
      return null;
    }
    // One run per UTC hour, even with two workers.
    const hour = now().format('YYYY-MM-DD[T]HH');
    return runOnce('slack-user-sync', `slack_user_sync:${hour}`, () => users.syncSlackUserIds());
  },
};
