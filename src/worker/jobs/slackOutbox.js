// slack-outbox: every 10 seconds, send due Slack messages (build guide section 11).
// No runOnce: each tick claims its own rows, and the outbox locks them so two workers never send
// the same message.
import { slack } from '@/modules/slack';

export const slackOutboxJob = {
  name: 'slack-outbox',
  cron: '*/10 * * * * *',
  tick: () => slack.processOutbox(),
};
