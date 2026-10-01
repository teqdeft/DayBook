// POST /api/report-edit-requests/:id/decline (report.approve_edit): body { reason } (required).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { declineEditRequestSchema, idParamsSchema } from '@/modules/reports/schemas';

export const POST = withRoute(
  { permission: 'report.approve_edit', body: declineEditRequestSchema },
  async ({ user, params, body, ip }) => {
    const parsed = idParamsSchema.safeParse(params);
    if (!parsed.success)
      throw new AppError('NOT_FOUND', { message: "We couldn't find that request." });
    return reports.declineEditRequest({ user, requestId: parsed.data.id, reason: body.reason, ip });
  },
);
