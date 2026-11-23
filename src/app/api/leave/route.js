// GET /api/leave?month=&from=&to=&userId=&limit=&offset= (attendance.correct): leave entries
// touching a payroll month (or from..to), newest first, as a list of LeaveEntry; Admins' leave
// only for Admins (CONTRACT 25). POST /api/leave, body { userId, fromDate, toDate?, part, paid,
// leaveType, note? } → 201 LeaveEntry. CONFLICT (overlap, not tracked), FORBIDDEN (own leave, an
// Admin's for a non-Admin), NOT_FOUND, VALIDATION_FAILED, UPDATE_NEEDED. RATE_LIMITED past 120
// reads or 60 writes a minute for one person (holidays and leave together).
import { listResult, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { leaveCreateSchema, leaveListQuerySchema } from '@/modules/attendance/calendarSchemas';
import { countRead, countWrite } from '../holidays/calendarRoute';

export const GET = withRoute(
  { permission: 'attendance.correct', query: leaveListQuerySchema },
  async ({ user, query }) => {
    countRead(user);
    const { items, total } = await attendance.listLeave({ viewer: user, ...query });
    return listResult(items, { limit: query.limit, offset: query.offset, total });
  },
);

export const POST = withRoute(
  { permission: 'attendance.correct', body: leaveCreateSchema, status: 201 },
  async ({ user, body, ip }) => {
    countWrite(user);
    return attendance.createLeave({ actor: user, ...body, ip });
  },
);
