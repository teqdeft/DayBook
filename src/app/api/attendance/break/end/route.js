// POST /api/attendance/break/end — returns { break, breakMinutesToday, overAllowanceMinutes }
// (CONTRACT 15).
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { breakSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.self', body: breakSchema },
  async ({ user }) => attendance.endBreak({ user }),
);
