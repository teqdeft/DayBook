import { withRoute } from '@/lib/route';
import { clearSessionCookie, readSessionToken } from '@/lib/session';
import { auth } from '@/modules/auth';

export const POST = withRoute({ permission: 'signed_in' }, async () => {
  await auth.destroySession(await readSessionToken());
  await clearSessionCookie();
  return { signedOut: true };
});
