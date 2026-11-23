// GET /api/leave/preview?userId=&fromDate=&toDate=&part=&excludeId= (attendance.correct): the Mark
// leave dialog's live line → { workingDays, split, offDays, checkIns, overlap }; it never writes.
// NOT_FOUND (also a person the actor may not see), FORBIDDEN (their own), CONFLICT (not tracked),
// VALIDATION_FAILED, UPDATE_NEEDED (CONTRACT 25). Counts as one of the 120 reads a minute.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { leavePreviewQuerySchema } from '@/modules/attendance/calendarSchemas';
import { countRead } from '../../holidays/calendarRoute';

export const GET = withRoute(
  { permission: 'attendance.correct', query: leavePreviewQuerySchema },
  async ({ user, query }) => {
    countRead(user);
    return attendance.previewLeave({ actor: user, ...query });
  },
);
