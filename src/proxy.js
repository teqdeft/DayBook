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
  // Everything except Next.js internals, static files and the upload routes' children (CONTRACT
  // 27). While the proxy runs, Next clones every non-GET body and keeps a copy in memory up to
  // 10 MB, cutting it silently past that; an upload piece skips that copy. Those routes never use
  // the client IP (a client-sent X-Forwarded-For isn't stripped there), and withRoute checks the
  // session on every route anyway. Start (POST /api/uploads itself) still passes through here.
  // A constant, as Next reads it at build time.
  matcher: ['/((?!_next/|icons/|favicon.ico|robots.txt|api/uploads/).*)'],
};
