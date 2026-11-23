// PATCH /api/holidays/:id (attendance.correct), body { date?, name? } → the holiday; a move runs
// the day rules on the old and the new date. DELETE /api/holidays/:id → { id }. NOT_FOUND "That
// holiday no longer exists.", CONFLICT (the new date has one), VALIDATION_FAILED, UPDATE_NEEDED
// (CONTRACT 25). Rate limits as GET /api/holidays.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { holidayUpdateSchema } from '@/modules/attendance/calendarSchemas';
import { countWrite, idFrom } from '../calendarRoute';

const GONE = 'That holiday no longer exists.';

export const PATCH = withRoute(
  { permission: 'attendance.correct', body: holidayUpdateSchema },
  async ({ user, body, params, ip }) => {
    countWrite(user);
    const id = idFrom(params, GONE);
    return attendance.updateHoliday({ actor: user, id, date: body.date, name: body.name, ip });
  },
);

export const DELETE = withRoute(
  { permission: 'attendance.correct' },
  async ({ user, params, ip }) => {
    countWrite(user);
    return attendance.deleteHoliday({ actor: user, id: idFrom(params, GONE), ip });
  },
);
