// GET /api/reports/:id/timers (owner): the report day's timers as the report page uses them
// (CONTRACT 15): { mode, required, summary }, or null when the report can't change, timers are
// off or the person can't use them. The page reads it before "Fill report from timers" and
// before a submit in required mode, so a running timer counts up to that moment.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { idParamsSchema } from '@/modules/reports/schemas';

export const GET = withRoute({ permission: 'report.self' }, async ({ user, params }) => {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
  }
  return reports.getTimersForReport({ user, reportId: parsed.data.id });
});
