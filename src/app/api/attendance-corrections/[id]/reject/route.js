// POST /api/attendance-corrections/:id/reject — body { note } (required).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { idParamSchema, rejectSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.correct', body: rejectSchema },
  async ({ user, body, params, ip }) => {
    const parsed = idParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return attendance.rejectCorrection({ actor: user, id: parsed.data.id, note: body.note, ip });
  },
);
