// The bell (CONTRACT 20, 26). GET → the latest 20 notifications, the unread count, the newest id
// and the person's id. GET ?after=<id> → the live check: the person's notifications above that id
// (newest first, at most 20, `more` beyond), the unread count and the newest id seen; 120 a minute
// per person. Successes log at debug (every open tab checks every 30 to 60 s); errors at info.
import { validationError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { notifications } from '@/modules/notifications';
import { liveQuerySchema } from '@/modules/notifications/schemas';

const ROUTE = '/api/notifications';
// Per person, not per IP: the office shares one address. One browser checks about twice a minute;
// 120 still covers a browser whose tabs each check (no Web Locks) and the pushes in between.
const LIVE_PER_PERSON = { key: 'notifications-live', limit: 120, windowMs: 60_000 };
const LIVE_LIMIT = 20;

/** `after` as a whole number from 0, else VALIDATION_FAILED with fields.after. */
function readAfter(query) {
  const parsed = liveQuerySchema.safeParse(query);
  if (parsed.success) return parsed.data.after;
  const message = parsed.error.issues[0]?.message ?? 'Use a notification id.';
  throw validationError({ after: message }, message);
}

async function liveCheck(user, query) {
  checkRateLimit(LIVE_PER_PERSON, ROUTE, `user:${user.id}`);
  const after = readAfter(query);
  const [{ items, more }, unreadCount] = await Promise.all([
    notifications.listAfter(user.id, { after, limit: LIVE_LIMIT }),
    notifications.unreadCount(user.id),
  ]);
  const latestId = Math.max(after, items[0]?.id ?? 0);
  return { userId: user.id, items, more, unreadCount, latestId };
}

export const GET = withRoute(
  { permission: 'signed_in', logLevel: 'debug' },
  async ({ user, query }) => {
    if (Object.hasOwn(query, 'after')) return liveCheck(user, query);
    const [items, unreadCount, latestId] = await Promise.all([
      notifications.listForUser(user.id, { limit: 20 }),
      notifications.unreadCount(user.id),
      notifications.latestId(user.id),
    ]);
    return { items, unreadCount, latestId, userId: user.id };
  },
);
