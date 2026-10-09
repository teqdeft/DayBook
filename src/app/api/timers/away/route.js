// POST /api/timers/away { entryId, from, to, decision: 'keep' | 'remove' } — answers the away
// prompt the state offered and returns the state.
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { timerAwaySchema } from '@/modules/timers/schemas';

export const POST = withRoute(
  { permission: 'report.self', body: timerAwaySchema },
  async ({ user, body }) => timers.resolveAway({ user, ...body }),
);
