// POST /api/wfh-requests/:id/approve — HR or an Admin approves a pending request (no body).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { idParamSchema, wfhActionSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.correct', body: wfhActionSchema },
  async ({ user, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.approveWfh({ actor: user, id: parsed.data.id, ip });
  },
);
