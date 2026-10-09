// POST /api/timers/entries { projectId, projectTaskId?, note?, startClock, endClock } — adds time
// by hand on today (201) and returns the state.
import { withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { timerEntryCreateSchema } from '@/modules/timers/schemas';

export const POST = withRoute(
  { permission: 'report.self', body: timerEntryCreateSchema, status: 201 },
  async ({ user, body, ip }) => timers.addEntry({ user, input: body, ip }),
);
