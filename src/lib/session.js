// Cookie session helpers for pages and API routes. The cookie holds a random token; the database
// stores only its HMAC (see modules/auth). Never import this from the worker.
//
// The cookie also records the expiry it was issued with ("<token>.<epoch seconds>"). The session
// row is extended by whichever request comes first once fewer than 7 days are left (guide 10), and
// that is often a page render, which can't set cookies. Comparing the two tells the next request
// that can (any signed-in API call, see withRoute and SessionRefresh) to re-issue the cookie, so
// the browser never drops a session the database still keeps.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env.js';
import { can } from './permissions.js';
import { auth } from '@/modules/auth';

/** A recorded expiry within this many seconds of the session row counts as current. */
const EXPIRY_TOLERANCE_S = 60;

export function sessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

function epochSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

/** The cookie value for a session token issued until `expiresAt`. */
export function encodeSessionCookie(token, expiresAt) {
  return `${token}.${epochSeconds(expiresAt)}`;
}

/**
 * Splits a cookie value into the token and the expiry it was issued with (epoch seconds, or null
 * for a cookie written before the expiry was recorded). Tokens are base64url, so never contain '.'.
 * @param {string | null | undefined} value
 * @returns {{ token: string | null, issuedUntil: number | null }}
 */
export function decodeSessionCookie(value) {
  if (!value) return { token: null, issuedUntil: null };
  const dot = value.lastIndexOf('.');
  if (dot === -1) return { token: value, issuedUntil: null };
  const seconds = Number(value.slice(dot + 1));
  return {
    token: value.slice(0, dot) || null,
    issuedUntil: Number.isInteger(seconds) && seconds > 0 ? seconds : null,
  };
}

/**
 * True when the browser's cookie expires at a different time than the session row: the row was
 * extended where no cookie could be written, or the cookie predates the recorded expiry.
 * @param {number | null} issuedUntil from decodeSessionCookie
 * @param {Date | string | null | undefined} sessionExpiresAt the session row's expiry
 */
export function sessionCookieIsStale(issuedUntil, sessionExpiresAt) {
  if (!sessionExpiresAt) return false;
  if (issuedUntil === null || issuedUntil === undefined) return true;
  return Math.abs(issuedUntil - epochSeconds(sessionExpiresAt)) > EXPIRY_TOLERANCE_S;
}

async function readSessionCookie() {
  const store = await cookies();
  return decodeSessionCookie(store.get(env.SESSION_COOKIE_NAME)?.value);
}

/** Reads the session token from the request cookie. */
export async function readSessionToken() {
  return (await readSessionCookie()).token;
}

/**
 * The signed-in user, or null. Cached per request, so pages and layouts can call it freely.
 * `sessionCookieStale` is true when the cookie should be re-issued (see the note at the top).
 */
export const getSessionUser = cache(async () => {
  const { token, issuedUntil } = await readSessionCookie();
  if (!token) return null;
  const user = await auth.resolveSession(token);
  if (!user) return null;
  return { ...user, sessionCookieStale: sessionCookieIsStale(issuedUntil, user.sessionExpiresAt) };
});

/** Sets the session cookie. Route handlers only (cookies can't be set while rendering a page). */
export async function setSessionCookie(token, expiresAt) {
  const store = await cookies();
  store.set(
    env.SESSION_COOKIE_NAME,
    encodeSessionCookie(token, expiresAt),
    sessionCookieOptions(expiresAt),
  );
}

/** Removes the session cookie. Route handlers only. */
export async function clearSessionCookie() {
  const store = await cookies();
  store.delete({ name: env.SESSION_COOKIE_NAME, path: '/' });
}

/** For pages: the signed-in user, or a redirect to /login. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * For pages: call at the top with the page's permission key. Signed-out people go to /login;
 * people without the permission see the "no access" page.
 * @param {string | null} permission
 */
export async function requirePage(permission) {
  const user = await requireUser();
  if (permission && !can(user, permission)) redirect('/no-access');
  return user;
}
