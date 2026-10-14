// POST /api/wfh-requests/:id/cancel — the person cancels their own request (pending, or approved
// and not started yet), or the rest of an approved one that has started. No body.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { idParamSchema, wfhActionSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.self', body: wfhActionSchema },
  async ({ user, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.cancelWfh({ user, id: parsed.data.id, ip });
  },
);
