import { withRoute } from '@/lib/route';
import { notifications } from '@/modules/notifications';
import { readAllSchema } from '@/modules/notifications/schemas';

export const POST = withRoute(
  { permission: 'signed_in', body: readAllSchema },
  async ({ user }) => {
    const marked = await notifications.markAllRead(user.id);
    return { marked, unreadCount: 0 };
  },
);
