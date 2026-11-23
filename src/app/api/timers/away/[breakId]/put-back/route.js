// POST /api/timers/away/:breakId/put-back (no body): Put back on Today (CONTRACT 25 A). The away
// break goes and the time goes back on the timer when it safely can; returns the state plus
// `answer: { restored, minutes, projectName }`. NOT_FOUND, CONFLICT (HR changed it), TIMERS_OFF,
// UPDATE_NEEDED (503, before migration 018); RATE_LIMITED past 60 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { routeBreakId } from '@/modules/timers/schemas';

const PER_PERSON = { key: 'timers-put-back', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/timers/away/put-back';

export const POST = withRoute({ permission: 'report.self' }, async ({ user, params }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  const breakId = routeBreakId(params);
  if (!breakId) throw new AppError('NOT_FOUND', { message: "We couldn't find that removed time." });
  return timers.putBackAway({ user, breakId });
});
