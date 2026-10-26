// The notification center (CONTRACT 20): notifications.markRead / remove and
// PATCH / DELETE /api/notifications/[id] — only the person's own notifications, NOT_FOUND for
// anyone else's or a missing one, and the unread count in the answers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
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
const { PATCH, DELETE } = await import('@/app/api/notifications/[id]/route.js');

const EXPIRES = new Date('2026-10-26T04:00:00Z');
let alice;
let bob;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function call(handler, method, id, { body, origin = env.appOrigin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const request = new Request(`http://localhost:3000/api/notifications/${id}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve({ id: String(id) }) });
}

/** Creates one notification for a person and returns its id. */
async function add(user, title) {
  await notifications.notify({ userIds: [user.id], type: 'test', title, link: '/today' });
  const row = await db('notifications').where({ userId: user.id, title }).first('id');
  return row.id;
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Alice Example' });
  bob = await createUser({ name: 'Bob Example' });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  setNowForTests('2026-09-30T04:00:00Z');
});

afterAll(() => setNowForTests(null));

describe('notifications.markRead', () => {
  it('marks read, keeps the first read time, and marks unread again', async () => {
    const id = await add(alice, 'Report reminder');
    expect(await notifications.unreadCount(alice.id)).toBe(1);

    setNowForTests('2026-09-30T05:00:00Z');
    const read = await notifications.markRead({ userId: alice.id, id, read: true });
    expect(read).toMatchObject({ id, title: 'Report reminder', link: '/today' });
    expect(read.readAt).toEqual(new Date('2026-09-30T05:00:00Z'));
    expect(await notifications.unreadCount(alice.id)).toBe(0);

    setNowForTests('2026-09-30T06:00:00Z');
    const again = await notifications.markRead({ userId: alice.id, id, read: true });
    expect(again.readAt).toEqual(new Date('2026-09-30T05:00:00Z'));

    const unread = await notifications.markRead({ userId: alice.id, id, read: false });
    expect(unread.readAt).toBeNull();
    expect(await notifications.unreadCount(alice.id)).toBe(1);
    const [listed] = await notifications.listForUser(alice.id, { limit: 1 });
    expect(listed).toMatchObject({ id, readAt: null });
    expect(Object.keys(unread).sort()).toEqual(Object.keys(listed).sort());
  });

  it("answers NOT_FOUND for someone else's, a missing or a nonsense id", async () => {
    const id = await add(alice, 'Private to Alice');
    await expect(notifications.markRead({ userId: bob.id, id, read: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const bad of [999999, 0, -1, 'abc', null]) {
      await expect(
        notifications.markRead({ userId: alice.id, id: bad, read: true }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const row = await db('notifications').where({ id }).first();
    expect(row.readAt).toBeNull();
  });
});

describe('notifications.remove', () => {
  it("deletes the person's own notification, read or unread, and only that one", async () => {
    const keep = await add(alice, 'Keep me');
    const unread = await add(alice, 'Delete me unread');
    const read = await add(alice, 'Delete me read');
    await notifications.markRead({ userId: alice.id, id: read, read: true });
    const before = await notifications.unreadCount(alice.id);

    expect(await notifications.remove({ userId: alice.id, id: unread })).toEqual({ id: unread });
    expect(await notifications.remove({ userId: alice.id, id: read })).toEqual({ id: read });
    expect(await db('notifications').whereIn('id', [unread, read])).toHaveLength(0);
    expect(await db('notifications').where({ id: keep }).first()).toBeTruthy();
    expect(await notifications.unreadCount(alice.id)).toBe(before - 1);
  });

  it("answers NOT_FOUND for someone else's, an already deleted or a nonsense id", async () => {
    const id = await add(alice, 'Not Bob’s');
    await expect(notifications.remove({ userId: bob.id, id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db('notifications').where({ id }).first()).toBeTruthy();
    await notifications.remove({ userId: alice.id, id });
    await expect(notifications.remove({ userId: alice.id, id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(notifications.remove({ userId: alice.id, id: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('PATCH and DELETE /api/notifications/[id]', () => {
  it('needs a signed-in person and a same-site request', async () => {
    const id = await add(bob, 'Signed in only');
    const anonymous = await call(PATCH, 'PATCH', id, { body: { read: true } });
    expect(anonymous.status).toBe(401);

    signInAs(bob);
    const foreign = await call(DELETE, 'DELETE', id, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await db('notifications').where({ id }).first()).toBeTruthy();
  });

  it('marks read and unread and answers the row and the unread count', async () => {
    const id = await add(bob, 'Edit request approved');
    signInAs(bob);
    const unreadBefore = await notifications.unreadCount(bob.id);

    setNowForTests('2026-09-30T07:00:00Z');
    const read = await call(PATCH, 'PATCH', id, { body: { read: true } });
    expect(read.status).toBe(200);
    const { data } = await read.json();
    expect(data.item).toMatchObject({ id, title: 'Edit request approved' });
    expect(new Date(data.item.readAt).toISOString()).toBe('2026-09-30T07:00:00.000Z');
    expect(data.unreadCount).toBe(unreadBefore - 1);

    const unread = await call(PATCH, 'PATCH', id, { body: { read: false } });
    expect((await unread.json()).data).toMatchObject({
      item: { id, readAt: null },
      unreadCount: unreadBefore,
    });
  });

  it('refuses a body without a boolean read', async () => {
    const id = await add(bob, 'Needs a body');
    signInAs(bob);
    for (const body of [{}, { read: 'yes' }, { read: 1 }]) {
      const response = await call(PATCH, 'PATCH', id, { body });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it("answers NOT_FOUND for someone else's, a missing or a nonsense id", async () => {
    const id = await add(alice, 'Only Alice');
    signInAs(bob);
    for (const target of [id, 999999, 'abc', '0', '1.5']) {
      const patch = await call(PATCH, 'PATCH', target, { body: { read: true } });
      expect(patch.status).toBe(404);
      expect((await patch.json()).error.code).toBe('NOT_FOUND');
      const del = await call(DELETE, 'DELETE', target);
      expect(del.status).toBe(404);
    }
    const row = await db('notifications').where({ id }).first();
    expect(row.readAt).toBeNull();
  });

  it('deletes and answers the id and the unread count', async () => {
    const id = await add(bob, 'Swipe me away');
    signInAs(bob);
    const before = await notifications.unreadCount(bob.id);
    const response = await call(DELETE, 'DELETE', id);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ id, unreadCount: before - 1 });
    expect(await db('notifications').where({ id }).first()).toBeUndefined();
    expect((await call(DELETE, 'DELETE', id)).status).toBe(404);
  });
});
