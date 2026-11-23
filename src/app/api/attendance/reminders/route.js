// POST /api/attendance/reminders (CONTRACT 25, item 5): HR or an Admin reminds people about one
// kind. Body { kind: 'check_in' | 'break' | 'check_out' | 'missing_checkout', userIds (1 to 50) }
// → { sent: [{ userId, name, sentAt }], skipped: [{ userId, name, reason: 'too_soon' |
// 'not_needed' | 'not_allowed', message, nextAt? }] }, 200 even when nobody was sent one. At most
// one per person per kind in 30 minutes. UPDATE_NEEDED (503) before migration 018; RATE_LIMITED
// past 30 a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { reminderSchema } from '@/modules/attendance/missingSchemas';

const PER_PERSON = { key: 'attendance-reminders', limit: 30, windowMs: 60_000 };
const ROUTE = '/api/attendance/reminders';

export const POST = withRoute(
  { permission: 'attendance.correct', body: reminderSchema },
  async ({ user, body, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return attendance.remind({ actor: user, kind: body.kind, userIds: body.userIds, ip });
  },
);
