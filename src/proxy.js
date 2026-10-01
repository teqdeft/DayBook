// Next.js 16 renamed middleware.js to proxy.js; the job is the same. It only checks that the session
// cookie exists and sends signed-out people to /login. It can't reach MySQL, so it never decides
// access: the (app) layout, requirePage() and withRoute() do that.
// It also runs for API routes (without redirecting them: they answer 401 themselves) so that,
// without a trusted proxy in front, a client-sent X-Forwarded-For never reaches clientIp().
import { NextResponse } from 'next/server';
import { headersWithoutClientForwardedFor } from '@/lib/clientIp';
import { env } from '@/lib/env';

const COOKIE_NAME = env.SESSION_COOKIE_NAME;
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/sw.js', '/offline'];

function passOn(request) {
  const headers = headersWithoutClientForwardedFor(request.headers, {
    trustProxy: env.TRUST_PROXY,
  });
  return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
}

export function proxy(request) {
  const { pathname, search } = request.nextUrl;
  if (
    pathname.startsWith('/api/') ||
    PUBLIC_PATHS.includes(pathname) ||
    request.cookies.has(COOKIE_NAME)
  ) {
    return passOn(request);
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ['/((?!_next/|icons/|favicon.ico|robots.txt).*)'],
};
