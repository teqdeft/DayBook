// POST /api/attendance/:id/confirm-office — HR verifies an "Office, unverified" check-in.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { confirmOfficeSchema, idParamSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.correct', body: confirmOfficeSchema },
  async ({ user, body, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.confirmOffice({ actor: user, id: parsed.data.id, reason: body.reason, ip });
  },
);
