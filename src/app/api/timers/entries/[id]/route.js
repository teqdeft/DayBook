// PATCH /api/timers/entries/:id { projectId?, projectTaskId?, note?, startClock?, endClock? } and
// DELETE: change one of today's timer entries; both return the state.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { routeId, timerEntryUpdateSchema } from '@/modules/timers/schemas';

export const PATCH = withRoute(
  { permission: 'report.self', body: timerEntryUpdateSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return timers.updateEntry({ user, id, input: body, ip });
  },
);

export const DELETE = withRoute({ permission: 'report.self' }, async ({ user, params, ip }) => {
  const id = routeId(params);
  if (!id) throw new AppError('NOT_FOUND');
  return timers.removeEntry({ user, id, ip });
});
