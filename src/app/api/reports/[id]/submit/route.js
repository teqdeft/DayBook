// POST /api/reports/:id/submit (owner): validate, new revision, queue the Slack post. An optional
// `entries` body saves the latest changes in the same step.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { idParamsSchema, submitReportSchema } from '@/modules/reports/schemas';

export const POST = withRoute(
  { permission: 'report.self', body: submitReportSchema },
  async ({ user, params, body }) => {
    const parsed = idParamsSchema.safeParse(params);
    if (!parsed.success)
      throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
    return reports.submitReport({
      user,
      reportId: parsed.data.id,
      entries: body.entries,
      baseVersion: body.baseVersion,
    });
  },
);
