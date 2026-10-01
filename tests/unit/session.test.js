import { beforeEach, describe, expect, it, vi } from 'vitest';

// A cookie jar standing in for next/headers, and a session the auth module "finds".
const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.set(name, { value: '', options: { expires: new Date(0) } }),
};
const resolveSession = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: (token) => resolveSession(token) } }));

const { decodeSessionCookie, encodeSessionCookie, getSessionUser, sessionCookieIsStale } =
  await import('@/lib/session');
const { withRoute } = await import('@/lib/route');
const { env } = await import('@/lib/env');

const COOKIE = env.SESSION_COOKIE_NAME;
const ISSUED = new Date('2026-10-01T04:00:00Z');
const EXTENDED = new Date('2026-10-26T04:00:00Z');

function sessionUser(expiresAt) {
  return { id: 2, role: 'employee', status: 'active', sessionExpiresAt: expiresAt };
}

beforeEach(() => {
  jar.clear();
  resolveSession.mockReset();
});

describe('session cookie value', () => {
  it('carries the token and the expiry it was issued with', () => {
    const value = encodeSessionCookie('abc_DEF-123', ISSUED);
    expect(value).toBe(`abc_DEF-123.${ISSUED.getTime() / 1000}`);
    expect(decodeSessionCookie(value)).toEqual({
      token: 'abc_DEF-123',
      issuedUntil: ISSUED.getTime() / 1000,
    });
  });

  it('reads cookies written before the expiry was recorded', () => {
    expect(decodeSessionCookie('abc_DEF-123')).toEqual({ token: 'abc_DEF-123', issuedUntil: null });
    expect(decodeSessionCookie('abc.junk')).toEqual({ token: 'abc', issuedUntil: null });
    expect(decodeSessionCookie(undefined)).toEqual({ token: null, issuedUntil: null });
  });

  it('is stale when the session row expires at another time than the cookie', () => {
    const issued = ISSUED.getTime() / 1000;
    expect(sessionCookieIsStale(issued, ISSUED)).toBe(false);
    // DATETIME rounding moves the row by up to a second; that is still in sync.
    expect(sessionCookieIsStale(issued, new Date(ISSUED.getTime() + 1000))).toBe(false);
    expect(sessionCookieIsStale(issued, EXTENDED)).toBe(true);
    expect(sessionCookieIsStale(null, ISSUED)).toBe(true);
  });
});

describe('re-issuing the cookie after a page render extended the session (guide 10)', () => {
  const handler = withRoute({ permission: 'signed_in' }, async ({ user }) => ({ id: user.id }));

  it('the page render notices that the cookie is out of date', async () => {
    jar.set(COOKIE, { value: encodeSessionCookie('tok', ISSUED) });
    // The render's resolveSession() moved the row 30 days on (fewer than 7 were left).
    resolveSession.mockResolvedValue(sessionUser(EXTENDED));
    const user = await getSessionUser();
    expect(resolveSession).toHaveBeenCalledWith('tok');
    expect(user.sessionCookieStale).toBe(true);
  });

  it('the next API call re-issues it with the extended expiry', async () => {
    jar.set(COOKIE, { value: encodeSessionCookie('tok', ISSUED) });
    // By now the row is already extended, so this request extends nothing itself.
    resolveSession.mockResolvedValue({ ...sessionUser(EXTENDED), sessionExtended: false });
    const response = await handler(new Request('http://localhost:3000/api/me'));
    expect(response.status).toBe(200);
    const cookie = jar.get(COOKIE);
    expect(cookie.value).toBe(encodeSessionCookie('tok', EXTENDED));
    expect(cookie.options.expires).toEqual(EXTENDED);
    expect(cookie.options.httpOnly).toBe(true);
  });

  it('leaves a current cookie alone', async () => {
    jar.set(COOKIE, { value: encodeSessionCookie('tok', EXTENDED) });
    resolveSession.mockResolvedValue(sessionUser(EXTENDED));
    await handler(new Request('http://localhost:3000/api/me'));
    expect(jar.get(COOKIE).options).toBeUndefined();
  });
});
