// Channels the bot can post in, for the "Post reports to" picker in Settings.
import { withRoute } from '@/lib/route';
import { slack } from '@/modules/slack';
import { channelsQuerySchema } from '@/modules/slack/schemas';

export const GET = withRoute(
  { permission: 'settings.manage', query: channelsQuerySchema },
  async () => slack.listChannels(),
);
