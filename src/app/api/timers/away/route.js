// POST /api/timers/away { entryId, from, to, decision: 'keep' | 'remove' | 'left' }: answers the
// away question the state offered (CONTRACT 25 A) and returns the state plus `answer`. Left
// checks the person out, so the request's IP is passed on. RATE_LIMITED past 60 a minute for one
// person (the office shares one IP).
import { checkRateLimit, withRoute } from '@/lib/route';
import { timers } from '@/modules/timers';
import { timerAwaySchema } from '@/modules/timers/schemas';

const PER_PERSON = { key: 'timers-away', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/timers/away';

export const POST = withRoute(
  { permission: 'report.self', body: timerAwaySchema },
  async ({ user, body, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return timers.resolveAway({ user, ...body, ip });
  },
);
