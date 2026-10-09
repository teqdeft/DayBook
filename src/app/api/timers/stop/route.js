// POST /api/timers/stop — stops the running timer and returns the state.
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { emptyBodySchema } from '@/modules/timers/schemas';

export const POST = withRoute(
  { permission: 'report.self', body: emptyBodySchema },
  async ({ user }) => timers.stop({ user }),
);
