// POST /api/timers/start { projectId, projectTaskId?, note? } — starts a timer (a running one on
// other work stops) and returns the state.
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { timerStartSchema } from '@/modules/timers/schemas';

export const POST = withRoute(
  { permission: 'report.self', body: timerStartSchema },
  async ({ user, body }) => timers.start({ user, ...body }),
);
