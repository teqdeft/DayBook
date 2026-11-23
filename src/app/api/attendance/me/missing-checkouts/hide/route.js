// POST /api/attendance/me/missing-checkouts/hide (CONTRACT 25, item B): "Not now" on Today's
// missing check-out pop-up (also Escape and the close button). No body → { hiddenOn }: every
// listed row is hidden for today and comes back tomorrow. UPDATE_NEEDED before migration 018.
// RATE_LIMITED past 10 a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { hidePromptSchema } from '@/modules/attendance/missingSchemas';

const PER_PERSON = { key: 'attendance-missing-hide', limit: 10, windowMs: 60_000 };
const ROUTE = '/api/attendance/me/missing-checkouts/hide';

export const POST = withRoute(
  { permission: 'attendance.self', body: hidePromptSchema },
  async ({ user }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return attendance.hideMissingCheckoutPrompt({ user });
  },
);
