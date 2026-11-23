// POST /api/notifications/read-all (CONTRACT 20, 26). {} → marks every unread notification read
// (unreadCount 0). { ids: [1 to 50 ids] } → only those of the person's that are unread (a summary
// card's "Mark these as read"); the answer has the fresh unread count. Unknown fields are ignored.
import { withRoute } from '@/lib/route';
import { notifications } from '@/modules/notifications';
import { readAllSchema } from '@/modules/notifications/schemas';

export const POST = withRoute(
  { permission: 'signed_in', body: readAllSchema },
  async ({ user, body }) => {
    const ids = body?.ids;
    const marked = await notifications.markAllRead(user.id, { ids });
    if (ids === undefined) return { marked, unreadCount: 0 };
    return { marked, unreadCount: await notifications.unreadCount(user.id) };
  },
);
