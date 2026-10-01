// POST /api/attendance-corrections/:id/approve — body { note? }.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { approveSchema, idParamSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.correct', body: approveSchema },
  async ({ user, body, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.approveCorrection({ actor: user, id: parsed.data.id, note: body.note, ip });
  },
);
