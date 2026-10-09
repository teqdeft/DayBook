// GET /api/timers/current — the signed-in person's timer state (Today's Working on card and the
// sidebar chip).
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';

export const GET = withRoute({ permission: 'report.self' }, async ({ user }) =>
  timers.getState({ user }),
);
