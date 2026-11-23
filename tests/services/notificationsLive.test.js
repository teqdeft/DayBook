// The live bell (CONTRACT 26): GET /api/notifications?after=<id> (only the person's rows above the
// cursor, newest first, `more` past 20, the unread count and the newest id; 120 a minute per
// person), the plain GET's latestId and userId, read-all with ids, and the type guard in
// notifications.notify.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { notifications } from '@/modules/notifications';
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
const { GET } = await import('@/app/api/notifications/route.js');
const { POST: READ_ALL } = await import('@/app/api/notifications/read-all/route.js');

const T0 = '2026-11-23T04:00:00Z';
const EXPIRES = new Date('2026-12-23T04:00:00Z');
const ROUTE = '/api/notifications';
let alice;
let bob;
let carol;

function signInAs(user) {
  jar.clear();
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  if (user) jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** GET /api/notifications with an optional query string ('after=5'). */
async function get(query = '') {
  const url = `http://localhost:3000${ROUTE}${query ? `?${query}` : ''}`;
  const response = await GET(new Request(url), { params: Promise.resolve({}) });
  return { status: response.status, ...(await response.json()) };
}

/** POST /api/notifications/read-all; `body` undefined sends no body at all. */
async function readAll(body) {
  const init = { method: 'POST', headers: { Origin: env.appOrigin } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const request = new Request(`http://localhost:3000${ROUTE}/read-all`, init);
  const response = await READ_ALL(request, { params: Promise.resolve({}) });
  return { status: response.status, ...(await response.json()) };
}

/** Adds one notification for a person and returns its id. */
async function add(user, title, type = 'report.reminder') {
  await notifications.notify({ userIds: [user.id], type, title, link: '/report' });
  const row = await db('notifications').where({ userId: user.id, title }).first('id');
  return row.id;
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Vishal Saini' });
  bob = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  carol = await createUser({ name: 'Carol Dsouza' });
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  await db('notifications').delete();
  signInAs(alice);
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/notifications?after=', () => {
  it("answers the person's rows above the cursor, newest first, at most 20 with more", async () => {
    const ids = [];
    for (let i = 1; i <= 25; i += 1) ids.push(await add(alice, `Reminder ${i}`));
    const bobsId = await add(bob, 'For Neha only');
    await notifications.markRead({ userId: alice.id, id: ids[24], read: true });

    const answer = await get('after=0');
    expect(answer.status).toBe(200);
    const { data } = answer;
    expect(Object.keys(data).sort()).toEqual([
      'items',
      'latestId',
      'more',
      'unreadCount',
      'userId',
    ]);
    expect(data.userId).toBe(alice.id);
    expect(data.items.map((item) => item.id)).toEqual(ids.slice(5).reverse());
    expect(data.more).toBe(true);
    expect(data.latestId).toBe(ids[24]);
    expect(data.unreadCount).toBe(24);
    expect(data.items[0]).toMatchObject({ title: 'Reminder 25', type: 'report.reminder' });
    expect(new Date(data.items[0].readAt).toISOString()).toBe('2026-11-23T04:00:00.000Z');
    expect(data.items[1].readAt).toBeNull();
    expect(Object.keys(data.items[0]).sort()).toEqual([
      'body',
      'createdAt',
      'id',
      'link',
      'readAt',
      'title',
      'type',
    ]);
    expect(data.items.some((item) => item.id === bobsId)).toBe(false);

    const recent = await get(`after=${ids[21]}`);
    expect(recent.data.items.map((item) => item.id)).toEqual([ids[24], ids[23], ids[22]]);
    expect(recent.data.more).toBe(false);
    expect(recent.data.latestId).toBe(ids[24]);
  });

  it('answers nothing above the newest id, with latestId kept at the cursor', async () => {
    const id = await add(alice, 'Only one');
    const answer = await get(`after=${id + 100}`);
    expect(answer.data).toEqual({
      userId: alice.id,
      items: [],
      more: false,
      unreadCount: 1,
      latestId: id + 100,
    });
    signInAs(carol);
    expect((await get('after=0')).data).toEqual({
      userId: carol.id,
      items: [],
      more: false,
      unreadCount: 0,
      latestId: 0,
    });
  });

  it("never shows someone else's rows, whatever the cursor", async () => {
    await add(bob, 'Neha one');
    await add(bob, 'Neha two');
    const answer = await get('after=0');
    expect(answer.data).toMatchObject({ userId: alice.id, items: [], unreadCount: 0, latestId: 0 });
  });

  it('refuses an after that is not a whole number from 0', async () => {
    for (const bad of ['-1', 'abc', '1.5', '9007199254740993']) {
      const answer = await get(`after=${bad}`);
      expect(answer.status, bad).toBe(400);
      expect(answer.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Use a notification id.',
        fields: { after: 'Use a notification id.' },
      });
    }
  });

  it('needs a signed-in person, in both forms', async () => {
    signInAs(null);
    for (const query of ['', 'after=0']) {
      const answer = await get(query);
      expect(answer.status).toBe(401);
      expect(answer.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('allows 120 live checks a minute per person, and the plain GET is not counted', async () => {
    for (let i = 0; i < 120; i += 1) expect((await get('after=0')).status).toBe(200);
    const stuck = await get('after=0');
    expect(stuck.status).toBe(429);
    expect(stuck.error.code).toBe('RATE_LIMITED');
    expect((await get('after=x')).status).toBe(429); // counted before it is read
    expect((await get()).status).toBe(200);
    signInAs(bob);
    expect((await get('after=0')).status).toBe(200);
    signInAs(alice);
    setNowForTests('2026-11-23T04:01:00Z');
    expect((await get('after=0')).status).toBe(200);
  });

  it('logs a successful check at debug and a refused one at info', async () => {
    const debug = vi.spyOn(logger, 'debug');
    const info = vi.spyOn(logger, 'info');
    const routeLines = (spy, status) =>
      spy.mock.calls.filter(([line]) => line?.route === ROUTE && line?.status === status);
    await get('after=0');
    expect(routeLines(debug, 200)).toHaveLength(1);
    expect(routeLines(info, 200)).toHaveLength(0);
    await get('after=abc');
    expect(routeLines(info, 400)).toHaveLength(1);
    expect(routeLines(debug, 400)).toHaveLength(0);
  });
});

describe('the plain GET /api/notifications', () => {
  it('gains latestId and userId; ?limit is still ignored', async () => {
    const first = await add(alice, 'First');
    const second = await add(alice, 'Second');
    await add(bob, 'Not Vishal');
    const answer = await get('limit=1');
    expect(answer.status).toBe(200);
    expect(Object.keys(answer.data).sort()).toEqual(['items', 'latestId', 'unreadCount', 'userId']);
    expect(answer.data.items.map((item) => item.id)).toEqual([second, first]);
    expect(answer.data).toMatchObject({ unreadCount: 2, latestId: second, userId: alice.id });
    expect(await notifications.latestId(alice.id)).toBe(second);
    expect(await notifications.latestId(carol.id)).toBe(0);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('with ids marks only those of the person that are unread and answers the fresh count', async () => {
    const one = await add(alice, 'One');
    const two = await add(alice, 'Two');
    const three = await add(alice, 'Three');
    const read = await add(alice, 'Read already');
    await notifications.markRead({ userId: alice.id, id: read, read: true });
    const bobs = await add(bob, 'Neha keeps this');

    setNowForTests('2026-11-23T04:05:00Z');
    const answer = await readAll({ ids: [one, two, two, read, bobs, 999999] });
    expect(answer).toEqual({ status: 200, data: { marked: 2, unreadCount: 1 } });
    const rows = await db('notifications').whereIn('id', [one, two, three, read, bobs]);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.readAt]));
    expect(byId[one]).toEqual(new Date('2026-11-23T04:05:00Z'));
    expect(byId[two]).toEqual(new Date('2026-11-23T04:05:00Z'));
    expect(byId[three]).toBeNull();
    expect(byId[read]).toEqual(new Date(T0));
    expect(byId[bobs]).toBeNull();
  });

  it('refuses an empty list, more than 50 and anything that is not ids', async () => {
    await add(alice, 'Stays unread');
    const many = Array.from({ length: 51 }, (_, i) => i + 1);
    for (const ids of [[], many, null, 'all', [0], [-1], [1.5], ['5'], [1, 'x']]) {
      const answer = await readAll({ ids });
      expect(answer.status, JSON.stringify(ids)).toBe(400);
      expect(answer.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Pick 1 to 50 notifications.',
        fields: { ids: 'Pick 1 to 50 notifications.' },
      });
    }
    expect(await notifications.unreadCount(alice.id)).toBe(1);
    const fifty = Array.from({ length: 50 }, (_, i) => i + 1);
    expect((await readAll({ ids: fifty })).status).toBe(200);
  });

  it('with {} or no body marks every unread one, as before', async () => {
    await add(alice, 'A');
    await add(alice, 'B');
    const bobs = await add(bob, 'Neha');
    expect(await readAll({})).toEqual({ status: 200, data: { marked: 2, unreadCount: 0 } });
    await add(alice, 'C');
    expect(await readAll()).toEqual({ status: 200, data: { marked: 1, unreadCount: 0 } });
    expect(await readAll({ other: true })).toEqual({
      status: 200,
      data: { marked: 0, unreadCount: 0 },
    });
    expect((await db('notifications').where({ id: bobs }).first()).readAt).toBeNull();
  });
});

describe('notify needs a classified type (CONTRACT 26)', () => {
  it('throws for an unclassified type under Vitest and writes a classified one', async () => {
    await expect(
      notifications.notify({ userIds: [alice.id], type: 'made.up', title: 'Nope' }),
    ).rejects.toThrow(
      'Notification type "made.up" has no alert level. Add it to ALERT_TYPES (CONTRACT 26).',
    );
    expect(await db('notifications').where({ title: 'Nope' }).first()).toBeUndefined();
    expect(
      await notifications.notify({ userIds: [alice.id], type: 'leave.marked', title: 'Leave' }),
    ).toBe(1);
  });

  it('in production writes the rows and warns once per type', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const input = { userIds: [alice.id, bob.id], type: 'made.up', title: 'Still written' };
      expect(await notifications.notify(input)).toBe(2);
      expect(await notifications.notify(input)).toBe(2);
    } finally {
      process.env.VITEST = vitest;
    }
    expect(await db('notifications').where({ type: 'made.up' })).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ type: 'made.up' }, 'notification type has no alert level');
  });
});
