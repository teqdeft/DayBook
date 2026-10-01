import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { createUser, resetDatabase } from '../helpers/db.js';

let alice;
let bob;

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Alice Example' });
  bob = await createUser({ name: 'Bob Example' });
});

describe('notifications', () => {
  it('notify skips empty ids, drops duplicates and writes one row per person', async () => {
    setNowForTests('2026-09-30T04:00:00Z');
    expect(await notifications.notify({ userIds: [], type: 'test', title: 'Nobody' })).toBe(0);
    expect(
      await notifications.notify({ userIds: [null, undefined, 0], type: 'test', title: 'Nobody' }),
    ).toBe(0);

    const count = await notifications.notify({
      userIds: [alice.id, bob.id, alice.id, String(bob.id)],
      type: 'project.urgent',
      title: 'internal-tool is urgent',
      body: 'Client demo on Friday',
      link: '/today',
    });
    expect(count).toBe(2);
    const rows = await db('notifications').orderBy('id');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(rows[0]).toMatchObject({
      type: 'project.urgent',
      body: 'Client demo on Friday',
      link: '/today',
      readAt: null,
    });
  });

  it('notify runs inside the caller transaction', async () => {
    await expect(
      db.transaction(async (trx) => {
        await notifications.notify(
          { userIds: [alice.id], type: 'test', title: 'Rolled back' },
          trx,
        );
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await db('notifications').where({ title: 'Rolled back' }).first()).toBeUndefined();
  });

  it('cuts long text to the column sizes instead of failing', async () => {
    await notifications.notify({
      userIds: [bob.id],
      type: 'test',
      title: 'x'.repeat(250),
      body: 'y'.repeat(600),
    });
    const row = await db('notifications').where({ userId: bob.id, type: 'test' }).first();
    expect(row.title).toHaveLength(200);
    expect(row.body).toHaveLength(500);
  });

  it('listForUser returns the newest first, 20 by default', async () => {
    for (let i = 1; i <= 22; i += 1) {
      setNowForTests(`2026-09-30T05:${String(i).padStart(2, '0')}:00Z`);
      await notifications.notify({
        userIds: [alice.id],
        type: 'report.reminder',
        title: `Reminder ${i}`,
      });
    }
    const list = await notifications.listForUser(alice.id);
    expect(list).toHaveLength(20);
    expect(list[0].title).toBe('Reminder 22');
    expect(list[1].title).toBe('Reminder 21');
    expect(Object.keys(list[0]).sort()).toEqual([
      'body',
      'createdAt',
      'id',
      'link',
      'readAt',
      'title',
      'type',
    ]);
    expect(list[0].createdAt).toBeInstanceOf(Date);
    expect(await notifications.listForUser(alice.id, { limit: 5 })).toHaveLength(5);
    expect(await notifications.listForUser(bob.id)).toHaveLength(2);
  });

  it('counts unread and marks all as read for one person only', async () => {
    expect(await notifications.unreadCount(alice.id)).toBe(23);
    expect(await notifications.unreadCount(bob.id)).toBe(2);
    setNowForTests('2026-09-30T06:00:00Z');
    expect(await notifications.markAllRead(alice.id)).toBe(23);
    expect(await notifications.unreadCount(alice.id)).toBe(0);
    expect(await notifications.unreadCount(bob.id)).toBe(2);
    const [latest] = await notifications.listForUser(alice.id, { limit: 1 });
    expect(latest.readAt).toEqual(new Date('2026-09-30T06:00:00Z'));
    expect(await notifications.markAllRead(alice.id)).toBe(0);
  });

  it('deleteOldRead removes only read notifications read before the cutoff', async () => {
    const deleted = await notifications.deleteOldRead(new Date('2026-09-30T06:00:01Z'));
    expect(deleted).toBe(23);
    expect(await notifications.listForUser(alice.id)).toHaveLength(0);
    expect(await notifications.unreadCount(bob.id)).toBe(2);
    expect(await notifications.deleteOldRead(new Date('2030-01-01T00:00:00Z'))).toBe(0);
  });
});
