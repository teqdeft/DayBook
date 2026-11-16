// POST /api/me/todo/lines/:id/timer (CONTRACT 24): Play on a to-do line. Starts a timer on its
// project with its priority task and the first 200 characters of its title as the note, and the
// line remembers that note → the new to-do plus `timerState` (what POST /api/timers/start
// answers). NOT_FOUND for anything but the person's own line in today's report; timers.start's
// refusals as they come (TIMERS_OFF, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, PROJECT_NOT_ACTIVE,
// CONFLICT), ALREADY_ON_BREAK, CONFLICT for a Done line; RATE_LIMITED past 60 to-do writes a
// minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { countWrite, lineIdOf } from '../../../todoRoute';

export const POST = withRoute({ permission: 'report.self' }, async ({ user, params }) => {
  countWrite(user);
  return reports.startTodoTimer({ user, id: lineIdOf(params) });
});
