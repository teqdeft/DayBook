// PATCH /api/leave/:id (attendance.correct), body { fromDate?, toDate?, part?, paid?, leaveType?,
// note?, reason } → LeaveEntry. DELETE /api/leave/:id, body { reason } → { id }. The reason is
// required ("Add a reason."). NOT_FOUND "That leave no longer exists." (also an Admin's for a
// non-Admin), FORBIDDEN, CONFLICT, VALIDATION_FAILED, UPDATE_NEEDED (CONTRACT 25). Rate limits
// as GET /api/leave.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { leaveDeleteSchema, leaveUpdateSchema } from '@/modules/attendance/calendarSchemas';
import { countWrite, idFrom } from '../../holidays/calendarRoute';

const GONE = 'That leave no longer exists.';

export const PATCH = withRoute(
  { permission: 'attendance.correct', body: leaveUpdateSchema },
  async ({ user, body, params, ip }) => {
    countWrite(user);
    return attendance.updateLeave({ actor: user, id: idFrom(params, GONE), ...body, ip });
  },
);

export const DELETE = withRoute(
  { permission: 'attendance.correct', body: leaveDeleteSchema },
  async ({ user, body, params, ip }) => {
    countWrite(user);
    const id = idFrom(params, GONE);
    return attendance.deleteLeave({ actor: user, id, reason: body.reason, ip });
  },
);
