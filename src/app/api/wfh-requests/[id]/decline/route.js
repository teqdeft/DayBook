// POST /api/wfh-requests/:id/decline — body { reason } (2-300 characters, shown to the person).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { idParamSchema, wfhDeclineSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.correct', body: wfhDeclineSchema },
  async ({ user, body, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.declineWfh({ actor: user, id: parsed.data.id, reason: body.reason, ip });
  },
);
