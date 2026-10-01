// GET /api/reports/:id/revisions (owner or team.view): the report's edit history.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { idParamsSchema } from '@/modules/reports/schemas';

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success)
    throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
  return reports.listRevisions({ user, reportId: parsed.data.id });
});
