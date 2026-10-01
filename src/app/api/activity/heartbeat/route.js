// POST /api/activity/heartbeat { state, source } — the Daybook app reports active, idle or
// screen locked (on every change and every minute). Sent with fetch keepalive, so it also arrives
// while the page is closing; withRoute checks its Origin header like any other change.
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { heartbeatSchema } from '@/modules/activity/schemas';

export const POST = withRoute(
  { permission: 'activity.self', body: heartbeatSchema, logLevel: 'debug' },
  async ({ user, body }) => activity.recordHeartbeat({ user, ...body }),
);
