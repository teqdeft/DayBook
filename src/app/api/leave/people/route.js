// GET /api/leave/people (attendance.correct): what the Mark leave dialog needs when it opens from
// the "Leave and holidays" card → { today, people: [{ id, name, designation }] }: today's company
// date (both days start there) and the people the viewer may mark leave for (active, tracked,
// never the viewer, never an Admin for a non-Admin), by name. Counts as one of the 120 reads a
// minute (CONTRACT 25, item 9).
import { withRoute } from '@/lib/route';
import { workDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import { countRead } from '../../holidays/calendarRoute';

export const GET = withRoute({ permission: 'attendance.correct' }, async ({ user }) => {
  countRead(user);
  const [current, people] = await Promise.all([
    settings.getAll(),
    attendance.listLeavePeople({ viewer: user }),
  ]);
  return { today: workDate(current.timezone), people };
});
