// PATCH /api/attendance/:id — HR changes the check-in, check-out or place (reason required).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { idParamSchema, updateRowSchema } from '@/modules/attendance/schemas';

export const PATCH = withRoute(
  { permission: 'attendance.correct', body: updateRowSchema },
  async ({ user, body, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.updateRow({ actor: user, id: parsed.data.id, ...body, ip });
  },
);
