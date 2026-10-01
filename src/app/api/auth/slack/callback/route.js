import { cookies, headers } from 'next/headers';
import { withRoute } from '@/lib/route';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { setSessionCookie } from '@/lib/session';
import { auth } from '@/modules/auth';
import { slackCallbackQuerySchema } from '@/modules/auth/schemas';
import { settings } from '@/modules/settings';

const STATE_COOKIE = 'daybook_oauth';

// A plain Response keeps its headers mutable, so cookies set with cookies() are added to it.
function redirectTo(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const GET = withRoute(
  {
    permission: 'public',
    query: slackCallbackQuerySchema,
    rateLimit: { key: 'signin', limit: 10, windowMs: 60_000 },
    redirectOnError: '/login',
  },
  async ({ query, ip }) => {
    const store = await cookies();
    const cookieValue = store.get(STATE_COOKIE)?.value;
    store.delete({ name: STATE_COOKIE, path: '/api/auth/slack' });
    try {
      if (query.error) throw new AppError('SIGNIN_STATE_MISMATCH');
      const { companyName } = await settings.getAll();
      const { userId } = await auth.finishSlackSignIn({
        code: query.code,
        state: query.state,
        cookieValue,
        companyName,
      });
      const userAgent = (await headers()).get('user-agent');
      const { token, expiresAt } = await auth.createSession({ userId, ip, userAgent });
      await setSessionCookie(token, expiresAt);
      return redirectTo(`${env.appOrigin}/`);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL';
      return redirectTo(`${env.appOrigin}/login?error=${code}`);
    }
  },
);
