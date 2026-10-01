// POST /api/attendance/check-out — returns { row, reportPending, gapMinutes, gapWarning, ... }.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { checkOutSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.self', body: checkOutSchema },
  async ({ user, ip }) => attendance.checkOut({ user, ip }),
);
