// One notification in the bell (CONTRACT 20): PATCH { read } marks it read or unread, DELETE
// removes it. Someone else's or a missing one is NOT_FOUND. Both answer the new unread count.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { notifications } from '@/modules/notifications';
import { markReadSchema, notificationIdSchema } from '@/modules/notifications/schemas';

function notificationId(params) {
  const parsed = notificationIdSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND');
  return parsed.data.id;
}

export const PATCH = withRoute(
  { permission: 'signed_in', body: markReadSchema },
  async ({ user, body, params }) => {
    const id = notificationId(params);
    const item = await notifications.markRead({ userId: user.id, id, read: body.read });
    return { item, unreadCount: await notifications.unreadCount(user.id) };
  },
);

export const DELETE = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  const id = notificationId(params);
  await notifications.remove({ userId: user.id, id });
  return { id, unreadCount: await notifications.unreadCount(user.id) };
});
