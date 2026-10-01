// This browser's desktop-notification subscription (CONTRACT 14). POST saves it for the signed-in
// person (the bell's "Show on this computer"); DELETE removes it (turning it off, signing out).
import { withRoute } from '@/lib/route';
import { push } from '@/modules/push';
import { subscribeSchema, unsubscribeSchema } from '@/modules/push/schemas';

export const POST = withRoute(
  { permission: 'signed_in', body: subscribeSchema, status: 201 },
  async ({ user, body, request }) =>
    push.subscribe({ user, subscription: body, userAgent: request.headers.get('user-agent') }),
);

export const DELETE = withRoute(
  { permission: 'signed_in', body: unsubscribeSchema },
  async ({ user, body }) => push.unsubscribe({ user, endpoint: body.endpoint }),
);
