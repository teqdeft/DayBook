// POST /api/report-edit-requests/:id/approve (report.approve_edit): opens the report for 24 hours.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { approveEditRequestSchema, idParamsSchema } from '@/modules/reports/schemas';

export const POST = withRoute(
  { permission: 'report.approve_edit', body: approveEditRequestSchema },
  async ({ user, params, ip }) => {
    const parsed = idParamsSchema.safeParse(params);
    if (!parsed.success)
      throw new AppError('NOT_FOUND', { message: "We couldn't find that request." });
    return reports.approveEditRequest({ user, requestId: parsed.data.id, ip });
  },
);
