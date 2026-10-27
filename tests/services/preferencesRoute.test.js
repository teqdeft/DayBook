// GET and PATCH /api/me/preferences (CONTRACT 21, My settings): sign-in, the person's own row,
// validation answers that name the field, and the per-person rate limit (60 a minute).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { preferences } from '@/modules/preferences';
import { createUser, resetDatabase } from '../helpers/db.js';

// A cookie jar standing in for next/headers, and the session the auth module "finds".
const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { resetRateLimitsForTests } = await import('@/lib/route');
const { GET, PATCH } = await import('@/app/api/me/preferences/route.js');

const T0 = '2026-10-26T06:00:00Z'; // Monday 26 October, 11:30 in Kolkata
const EXPIRES = new Date('2026-11-26T04:00:00Z');
const DEFAULTS = preferences.PREFERENCE_DEFAULTS;
let alice;
let bob;

function signInAs(user) {
  jar.clear();
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  if (user) jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** Calls GET or PATCH; `body` is sent as JSON (a string is sent as it is). */
async function call(handler, method, body) {
  const init = { method, headers: { Origin: env.appOrigin } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const request = new Request('http://localhost:3000/api/me/preferences', init);
  const response = await handler(request, { params: Promise.resolve({}) });
  return { status: response.status, ...(await response.json()) };
}

/** What the person's row holds (null without one). */
async function storedRow(user) {
  const row = await db('userPreferences').where({ userId: user.id }).first();
  return row ? parseJson(row.prefs) : null;
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Alice Mehta' });
  bob = await createUser({ name: 'Bob Singh', role: 'pm', tracksAttendance: false });
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  await db('userPreferences').delete();
  signInAs(alice);
});

describe('GET and PATCH /api/me/preferences', () => {
  it('needs a signed-in person', async () => {
    signInAs(null);
    for (const [handler, method, body] of [
      [GET, 'GET'],
      [PATCH, 'PATCH', { theme: 'dark' }],
    ]) {
      const answer = await call(handler, method, body);
      expect(answer.status).toBe(401);
      expect(answer.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await db('userPreferences').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('reads and saves the signed-in person’s preferences', async () => {
    const before = await call(GET, 'GET');
    expect(before).toEqual({ status: 200, data: DEFAULTS });

    const saved = await call(PATCH, 'PATCH', { theme: 'dark', slackPreview: false });
    expect(saved).toEqual({
      status: 200,
      data: { ...DEFAULTS, theme: 'dark', slackPreview: false },
    });
    expect(await storedRow(alice)).toEqual({ theme: 'dark', slackPreview: false });
    expect(await storedRow(bob)).toBeNull();

    // A PM has no report, but may still save any key; it just has no effect.
    signInAs(bob);
    expect((await call(GET, 'GET')).data).toEqual(DEFAULTS);
    expect((await call(PATCH, 'PATCH', { carryOver: false })).data.carryOver).toBe(false);
    expect((await preferences.getFor(alice.id)).carryOver).toBe(true);
  });

  it('answers 400 with the field named', async () => {
    const unknown = await call(PATCH, 'PATCH', { theme: 'dark', fontSize: 14 });
    expect(unknown.status).toBe(400);
    expect(unknown.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '"fontSize" isn\'t one of your settings.',
      fields: { fontSize: '"fontSize" isn\'t one of your settings.' },
    });

    const wrong = await call(PATCH, 'PATCH', { submitButtons: 'all' });
    expect(wrong.status).toBe(400);
    expect(wrong.error.fields).toEqual({
      submitButtons: 'Submit buttons must be Both, Submit and check out, or Submit report.',
    });

    const empty = await call(PATCH, 'PATCH');
    expect(empty.status).toBe(400);
    expect(empty.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Choose a setting to change.',
    });

    const notJson = await call(PATCH, 'PATCH', '{theme');
    expect(notJson.status).toBe(400);
    expect(notJson.error.code).toBe('BAD_REQUEST');
    expect(await storedRow(alice)).toBeNull();
  });

  it('names an unknown key however it is called, and only the first one', async () => {
    const message = (key) => `"${key}" isn't one of your settings.`;
    const named = async (body) => {
      const answer = await call(PATCH, 'PATCH', body);
      expect(answer.status).toBe(400);
      expect(answer.error.code).toBe('VALIDATION_FAILED');
      return [answer.error.message, Object.entries(answer.error.fields)];
    };
    expect(await named({ toString: true })).toEqual([
      message('toString'),
      [['toString', message('toString')]],
    ]);
    expect(await named({ constructor: 'x', theme: 'dark' })).toEqual([
      message('constructor'),
      [['constructor', message('constructor')]],
    ]);
    expect(await named('{"__proto__":{"x":1},"theme":"dark"}')).toEqual([
      message('__proto__'),
      [['__proto__', message('__proto__')]],
    ]);
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 1]));
    expect(await named({ theme: 'dark', ...many })).toEqual([
      message('k0'),
      [['k0', message('k0')]],
    ]);
    expect(await storedRow(alice)).toBeNull();
  });

  it('refuses a body far bigger than My settings sends, before reading it', async () => {
    const huge = Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, 1]));
    const started = performance.now();
    const answer = await call(PATCH, 'PATCH', huge);
    expect(answer.status).toBe(413);
    expect(answer.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That request is too large.',
    });
    expect(performance.now() - started).toBeLessThan(500);
    // Every key at once, with room to spare, still fits.
    const everything = { ...DEFAULTS, theme: 'dark', submitButtons: 'checkout', carryOver: false };
    expect((await call(PATCH, 'PATCH', JSON.stringify(everything, null, 8))).status).toBe(200);
  });

  it('counts refused bodies against the rate limit too', async () => {
    for (let i = 0; i < 60; i += 1) {
      expect((await call(PATCH, 'PATCH', { nope: i })).status).toBe(400);
    }
    expect((await call(PATCH, 'PATCH', { nope: 1 })).status).toBe(429);
    expect((await call(PATCH, 'PATCH', 'x'.repeat(5000))).status).toBe(429);
    expect((await call(GET, 'GET')).status).toBe(429);
  });

  it('allows 60 requests a minute per person', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await call(GET, 'GET')).status).toBe(200);
      expect((await call(PATCH, 'PATCH', { bellRing: i % 2 === 0 })).status).toBe(200);
    }
    const stuck = await call(PATCH, 'PATCH', { theme: 'dark' });
    expect(stuck.status).toBe(429);
    expect(stuck.error.code).toBe('RATE_LIMITED');
    expect((await preferences.getFor(alice.id)).theme).toBe('system');

    // Someone else at the same address is fine; a minute later Alice is too.
    signInAs(bob);
    expect((await call(GET, 'GET')).status).toBe(200);
    signInAs(alice);
    setNowForTests('2026-10-26T06:01:00Z');
    expect((await call(PATCH, 'PATCH', { theme: 'dark' })).status).toBe(200);
  });
});
