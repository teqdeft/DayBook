import { cookies } from 'next/headers';
import { withRoute } from '@/lib/route';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { auth } from '@/modules/auth';

const STATE_COOKIE = 'daybook_oauth';

// A plain Response keeps its headers mutable, so cookies set with cookies() are added to it.
function redirectTo(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const GET = withRoute(
  {
    permission: 'public',
    rateLimit: { key: 'signin', limit: 10, windowMs: 60_000 },
    redirectOnError: '/login',
  },
  async () => {
    try {
      const { url, cookieValue } = auth.startSlackSignIn();
      const store = await cookies();
      store.set(STATE_COOKIE, cookieValue, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'lax',
        path: '/api/auth/slack',
        maxAge: 10 * 60,
      });
      return redirectTo(url);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL';
      return redirectTo(`${env.appOrigin}/login?error=${code}`);
    }
  },
);
