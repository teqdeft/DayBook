// GET /api/reports/:id (owner or team.view): one report with its tasks.
// PUT /api/reports/:id (owner): save entries and tasks (autosave). After the first submit a save
// is a new revision.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { idParamsSchema, saveReportSchema } from '@/modules/reports/schemas';

function reportId(params) {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success)
    throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
  return parsed.data.id;
}

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) =>
  reports.getReport({ user, reportId: reportId(params) }),
);

export const PUT = withRoute(
  { permission: 'report.self', body: saveReportSchema },
  async ({ user, params, body }) =>
    reports.saveReport({
      user,
      reportId: reportId(params),
      entries: body.entries,
      baseVersion: body.baseVersion,
    }),
);
