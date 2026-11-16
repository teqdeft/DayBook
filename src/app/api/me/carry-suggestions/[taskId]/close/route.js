// POST /api/me/carry-suggestions/:taskId/close (CONTRACT 24): "Done already" ({ reason: 'done' })
// or "Not needed" ({ reason: 'dropped' }) on one of the person's unfinished-task suggestions; with
// `undo: true` it opens the task again. → { taskId, closed, reason }. NOT_FOUND for a line that
// isn't the person's own or isn't open, TODO_UNAVAILABLE (503) before migration 017,
// RATE_LIMITED past 60 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { closeSuggestionSchema, taskIdParamsSchema } from '@/modules/reports/todoSchemas';

// Per person, not per IP: behind the office network everyone shares one address. Marking a few
// suggestions in a row is normal; this only stops a stuck page or script.
const PER_PERSON = { key: 'me-carry-suggestions', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/me/carry-suggestions/close';

function taskId(params) {
  const parsed = taskIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', {
      message: "We couldn't find that open task. Reload the page to see the latest.",
    });
  }
  return parsed.data.taskId;
}

export const POST = withRoute(
  { permission: 'report.self', body: closeSuggestionSchema },
  async ({ user, params, body, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return reports.closeSuggestion({
      user,
      taskId: taskId(params),
      reason: body.reason,
      undo: body.undo ?? false,
      ip,
    });
  },
);
