// POST /api/attendance/check-in — body { location?, unverifiedOffice?, note? }.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { checkInSchema } from '@/modules/attendance/schemas';

export const POST = withRoute(
  { permission: 'attendance.self', body: checkInSchema, status: 201 },
  async ({ user, body, ip }) => attendance.checkIn({ user, ip, ...body }),
);
