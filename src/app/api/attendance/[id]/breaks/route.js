// GET /api/attendance/:id/breaks: the break list of one attendance row (CONTRACT 25, item 2), for
// everyone who sees Attendance (PMs read only). NOT_FOUND for no row or an Admin's row for a
// non-Admin; RATE_LIMITED past 120 a minute for one person (the office shares one IP).
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { breakRouteIds } from '@/modules/attendance/breakSchemas';

const PER_PERSON = { key: 'attendance-breaks-read', limit: 120, windowMs: 60_000 };
const ROUTE = '/api/attendance/breaks';

export const GET = withRoute({ permission: 'attendance.view_all' }, async ({ user, params }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  const ids = breakRouteIds(params);
  if (!ids) throw new AppError('NOT_FOUND');
  return attendance.listBreaksForRow({ viewer: user, attendanceId: ids.attendanceId });
});
