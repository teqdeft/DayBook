// The bell: the latest 20 notifications and the unread count.
import { withRoute } from '@/lib/route';
import { notifications } from '@/modules/notifications';

export const GET = withRoute({ permission: 'signed_in' }, async ({ user }) => {
  const [items, unreadCount] = await Promise.all([
    notifications.listForUser(user.id, { limit: 20 }),
    notifications.unreadCount(user.id),
  ]);
  return { items, unreadCount };
});
