// Development and test only: sign in as any active user without Slack. Answers 404 in production.
import { headers } from 'next/headers';
import { withRoute } from '@/lib/route';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { setSessionCookie } from '@/lib/session';
import { auth } from '@/modules/auth';
import { devLoginSchema } from '@/modules/auth/schemas';

export const POST = withRoute(
  { permission: 'public', rateLimit: { key: 'dev-login', limit: 60, windowMs: 60_000 } },
  async ({ request, ip }) => {
    if (!env.devLoginEnabled && !env.isTest) throw new AppError('NOT_FOUND');
    const body = devLoginSchema.parse(await request.json().catch(() => ({})));
    const { userId } = await auth.devSignIn({ email: body.email });
    const userAgent = (await headers()).get('user-agent');
    const { token, expiresAt } = await auth.createSession({ userId, ip, userAgent });
    await setSessionCookie(token, expiresAt);
    return { userId };
  },
);
