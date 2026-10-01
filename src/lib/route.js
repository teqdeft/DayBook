// withRoute() wraps every API handler: loads the session, checks the permission, validates input
// with zod, runs the handler, and turns errors into the standard JSON error shape. It also checks
// the Origin header on changes, rate-limits where asked, and logs each request with its duration.
import crypto from 'node:crypto';
import { z } from 'zod';
import { clientIpFrom } from './clientIp.js';
import { env } from './env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { can } from './permissions.js';
import { getSessionUser, readSessionToken, setSessionCookie } from './session.js';
import { now } from './time.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LIST = Symbol('list');

/**
 * Marks a list result so the response carries paging: { data: [...], page: { limit, offset, total } }.
 */
export function listResult(rows, { limit, offset, total }) {
  return { [LIST]: true, rows, page: { limit, offset, total } };
}

/**
 * The client IP, or null when it isn't known. Behind a trusted proxy (TRUST_PROXY=true) it is the
 * right-most X-Forwarded-For entry, the one our own proxy added. Without one it is the socket
 * address Next.js puts there (src/proxy.js drops any X-Forwarded-For the client sent itself).
 * Server Components pass `{ headers: await headers() }`.
 * @param {{ headers: { get(name: string): string | null } }} request
 */
export function clientIp(request) {
  return clientIpFrom(request.headers, { trustProxy: env.TRUST_PROXY });
}

function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin === env.appOrigin) return;
  // In development the app is also opened as 127.0.0.1 or from another port; same-host is fine.
  if (!env.isProduction && origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host && new URL(origin).host === host) return;
  }
  throw new AppError('BAD_ORIGIN');
}

// ---------- rate limiting (in memory, per process; enough for sign-in routes) ----------
// One bucket per limit key, route and IP: the two Slack sign-in steps (start, callback) each allow
// `limit` requests, so one sign-in costs one attempt (guide 15.1: 10 attempts per minute per IP).
const MAX_BUCKETS = 10_000;
const buckets = globalThis.__daybookRateBuckets ?? new Map();
globalThis.__daybookRateBuckets = buckets;

/** Drops finished windows, and the oldest buckets if the map is still too big. */
function pruneBuckets(current) {
  for (const [id, bucket] of buckets) {
    if (bucket.resetAt <= current) buckets.delete(id);
  }
  for (const id of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(id);
  }
}

/**
 * Counts one request against `limit` per `windowMs` for this key, route and IP.
 * @param {{ key: string, limit: number, windowMs: number }} options
 * @param {string} route the request path
 * @param {string | null} ip
 * @throws RATE_LIMITED
 */
export function checkRateLimit({ key, limit, windowMs }, route, ip) {
  const id = `${key}:${route}:${ip ?? 'unknown'}`;
  const current = now().valueOf();
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= current) {
    if (!bucket && buckets.size >= MAX_BUCKETS) pruneBuckets(current);
    buckets.set(id, { count: 1, resetAt: current + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new AppError('RATE_LIMITED');
}

/** Tests only: forgets every rate-limit bucket. */
export function resetRateLimitsForTests() {
  buckets.clear();
}

/** zod issues -> { 'entries.0.hours': 'Hours must be above 0' } */
function fieldsFromZod(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}

function parseWith(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = fieldsFromZod(result.error);
    const first = Object.values(fields)[0];
    throw new AppError('VALIDATION_FAILED', { fields, message: first });
  }
  return result.data;
}

async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

function errorResponse(error, requestId) {
  const body = { error: { code: error.code, message: error.message } };
  if (error.fields) body.error.fields = error.fields;
  if (error.status >= 500) body.error.requestId = requestId;
  return Response.json(body, { status: error.status });
}

/**
 * @param {{
 *   permission: 'public' | 'signed_in' | string,
 *   body?: z.ZodType,
 *   query?: z.ZodType,
 *   status?: number,
 *   rateLimit?: { key: string, limit: number, windowMs: number },
 *   redirectOnError?: string,
 *   logLevel?: 'info' | 'debug',
 * }} options
 * @param {(ctx: { user: any, body: any, query: any, params: Record<string, string>, ip: string | null,
 *   request: Request, requestId: string }) => Promise<any>} handler
 */
export function withRoute(options, handler) {
  if (!options?.permission) throw new Error('withRoute needs a permission');
  return async function route(request, context) {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    const pathname = new URL(request.url).pathname;
    let user = null;
    let status = 200;
    try {
      const ip = clientIp(request);
      if (options.rateLimit) checkRateLimit(options.rateLimit, pathname, ip);
      if (MUTATING.has(request.method)) checkOrigin(request);

      if (options.permission !== 'public') {
        user = await getSessionUser();
        if (!user) throw new AppError('UNAUTHENTICATED');
        // A page render may have extended the session; re-issue the cookie to match (session.js).
        if (user.sessionCookieStale) {
          const token = await readSessionToken();
          if (token) await setSessionCookie(token, user.sessionExpiresAt);
        }
        if (options.permission !== 'signed_in' && !can(user, options.permission)) {
          throw new AppError('FORBIDDEN');
        }
      }

      const params = (await context?.params) ?? {};
      const searchParams = Object.fromEntries(new URL(request.url).searchParams);
      const query = options.query ? parseWith(options.query, searchParams) : searchParams;
      const body = options.body ? parseWith(options.body, await readJsonBody(request)) : undefined;

      const result = await handler({ user, body, query, params, ip, request, requestId });
      if (result instanceof Response) {
        status = result.status;
        return result;
      }
      status = options.status ?? 200;
      if (result && result[LIST]) {
        return Response.json({ data: result.rows, page: result.page }, { status });
      }
      return Response.json({ data: result ?? null }, { status });
    } catch (error) {
      if (error instanceof AppError) {
        status = error.status;
        if (status >= 500) logger.error({ err: error, requestId }, error.message);
        if (options.redirectOnError) {
          // Browser navigations (Slack sign-in) get a page with the message, not raw JSON.
          status = 302;
          const location = `${env.appOrigin}${options.redirectOnError}?error=${error.code}`;
          return new Response(null, { status, headers: { Location: location } });
        }
        return errorResponse(error, requestId);
      }
      if (error instanceof z.ZodError) {
        status = 400;
        return errorResponse(
          new AppError('VALIDATION_FAILED', { fields: fieldsFromZod(error) }),
          requestId,
        );
      }
      // Next.js uses thrown errors for redirect() and notFound(); let those through.
      if (error?.digest && String(error.digest).startsWith('NEXT_')) throw error;
      status = 500;
      logger.error({ err: error, requestId, route: pathname }, 'unexpected error');
      return errorResponse(new AppError('INTERNAL'), requestId);
    } finally {
      // Chatty routes (the once-a-minute screen-time heartbeat) log successes at debug; any
      // error still logs at info so problems stay visible.
      const level = options.logLevel === 'debug' && status < 400 ? 'debug' : 'info';
      logger[level]({
        requestId,
        userId: user?.id ?? null,
        method: request.method,
        route: pathname,
        status,
        durationMs: Math.round(performance.now() - started),
      });
    }
  };
}
