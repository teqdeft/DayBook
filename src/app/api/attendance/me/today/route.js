// GET /api/attendance/me/today — today's row plus whether this request comes from the office.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';

export const GET = withRoute({ permission: 'attendance.self' }, async ({ user, ip }) =>
  attendance.getMyToday({ user, ip }),
);
