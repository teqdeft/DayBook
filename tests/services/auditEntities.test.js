// audit.listForEntities (CONTRACT 25): the audit trail of many entities in one read, newest first,
// the ids read 500 at a time on the entity_type, entity_id index; and audit.listForType: one
// type's rows written since a moment (the person month's deleted or moved leave).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { audit } from '@/modules/audit';
import { createUser, resetDatabase } from '../helpers/db.js';

let actor;

/** Counts the audit_logs selects run while `read` runs. */
async function countSelects(read) {
  let selects = 0;
  const listener = (query) => {
    if (/^select/i.test(query.sql) && query.sql.includes('audit_logs')) selects += 1;
  };
  db.on('query', listener);
  try {
    return { result: await read(), selects };
  } finally {
    db.off('query', listener);
  }
}

/** One audit row, written straight to the table so its time is exact. */
function row({ entityType = 'attendance', entityId, action, at, after = null }) {
  return {
    actorId: actor.id,
    action,
    entityType,
    entityId,
    before: null,
    after: after === null ? null : JSON.stringify(after),
    reason: null,
    ip: '203.0.113.7',
    createdAt: new Date(at),
    updatedAt: new Date(at),
  };
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-11-19T04:00:00Z');
  actor = await createUser({ name: 'Neha Kapoor', role: 'hr', email: 'neha@example.com' });
  await db('audit_logs').insert([
    row({ entityId: 11, action: 'attendance.edit', at: '2026-11-13T05:00:00Z', after: { a: 1 } }),
    row({ entityId: 12, action: 'attendance.mark_missing', at: '2026-11-14T18:35:00Z' }),
    row({ entityId: 11, action: 'attendance.correct', at: '2026-11-16T06:00:00Z' }),
    row({ entityId: 13, action: 'attendance.auto_checkout', at: '2026-11-16T06:00:00Z' }),
    row({ entityId: 99, action: 'attendance.edit', at: '2026-11-17T06:00:00Z' }),
    row({ entityType: 'leave', entityId: 11, action: 'leave.create', at: '2026-11-18T06:00:00Z' }),
  ]);
});

afterEach(() => setNowForTests('2026-11-19T04:00:00Z'));

describe('audit.listForEntities', () => {
  it('reads the rows of the given ids and type, newest first, before and after parsed', async () => {
    const rows = await audit.listForEntities({ entityType: 'attendance', entityIds: [11, 12, 13] });
    expect(rows.map((entry) => [entry.entityId, entry.action])).toEqual([
      // Two rows in the same second keep the later id first.
      [13, 'attendance.auto_checkout'],
      [11, 'attendance.correct'],
      [12, 'attendance.mark_missing'],
      [11, 'attendance.edit'],
    ]);
    expect(rows[3]).toEqual({
      id: expect.any(Number),
      actorId: actor.id,
      action: 'attendance.edit',
      entityType: 'attendance',
      entityId: 11,
      before: null,
      after: { a: 1 },
      reason: null,
      ip: '203.0.113.7',
      createdAt: new Date('2026-11-13T05:00:00Z'),
    });
    // Same ids, another type.
    const leave = await audit.listForEntities({ entityType: 'leave', entityIds: [11, 12] });
    expect(leave.map((entry) => entry.action)).toEqual(['leave.create']);
  });

  it('keeps only the actions asked for, and the newest `limit` overall', async () => {
    const missing = await audit.listForEntities({
      entityType: 'attendance',
      entityIds: [11, 12, 13],
      actions: ['attendance.mark_missing', 'attendance.auto_checkout'],
    });
    expect(missing.map((entry) => entry.entityId)).toEqual([13, 12]);
    const latest = await audit.listForEntities({
      entityType: 'attendance',
      entityIds: [11, 12, 13],
      limit: 2,
    });
    expect(latest.map((entry) => entry.action)).toEqual([
      'attendance.auto_checkout',
      'attendance.correct',
    ]);
  });

  it('answers [] without a query when there is nothing to read', async () => {
    const { result, selects } = await countSelects(async () => [
      await audit.listForEntities({ entityType: 'attendance', entityIds: [] }),
      await audit.listForEntities({ entityType: 'attendance', entityIds: ['x', -1, 0] }),
      await audit.listForEntities({ entityType: 'attendance', entityIds: [11], actions: [] }),
      await audit.listForEntities({ entityIds: [11] }),
    ]);
    expect(result).toEqual([[], [], [], []]);
    expect(selects).toBe(0);
  });

  it('reads the ids in chunks of 500 and merges them newest first', async () => {
    const base = Date.parse('2026-10-01T00:00:00Z');
    const rows = [];
    for (let index = 0; index < 1200; index += 1) {
      rows.push(
        row({
          entityId: 1000 + index,
          action: 'attendance.mark_missing',
          at: base + index * 60_000,
        }),
      );
    }
    for (let start = 0; start < rows.length; start += 400) {
      await db('audit_logs').insert(rows.slice(start, start + 400));
    }
    // Strings and repeats are cleaned up first.
    const ids = rows.map((entry) => String(entry.entityId));
    const { result, selects } = await countSelects(() =>
      audit.listForEntities({ entityType: 'attendance', entityIds: [...ids, ids[0]] }),
    );
    expect(selects).toBe(3);
    expect(result).toHaveLength(1200);
    expect(result[0].entityId).toBe(2199);
    expect(result[1199].entityId).toBe(1000);
    expect(result.every((entry, i) => i === 0 || entry.createdAt <= result[i - 1].createdAt)).toBe(
      true,
    );

    // The limit is over every chunk: the newest three overall (all in the last chunk).
    const { result: newest } = await countSelects(() =>
      audit.listForEntities({ entityType: 'attendance', entityIds: ids, limit: 3 }),
    );
    expect(newest.map((entry) => entry.entityId)).toEqual([2199, 2198, 2197]);
    const oldest = await audit.listForEntities({
      entityType: 'attendance',
      entityIds: [1002, 1000, 1001],
      limit: 2,
      actions: ['attendance.mark_missing'],
    });
    expect(oldest.map((entry) => entry.entityId)).toEqual([1002, 1001]);
  });
});

describe('audit.listForType', () => {
  it('reads one type written since a moment, newest first, the asked actions only', async () => {
    await db('audit_logs').insert([
      row({
        entityType: 'leave',
        entityId: 21,
        action: 'leave.delete',
        at: '2026-11-19T03:00:00Z',
        after: { userId: 5 },
      }),
      row({ entityType: 'leave', entityId: 22, action: 'leave.other', at: '2026-11-19T03:30:00Z' }),
      row({
        entityType: 'leave',
        entityId: 23,
        action: 'leave.create',
        at: '2025-01-01T00:00:00Z',
      }),
    ]);
    const since = new Date('2026-11-18T00:00:00Z');
    const rows = await audit.listForType({
      entityType: 'leave',
      since,
      actions: ['leave.create', 'leave.delete'],
    });
    expect(rows.map((entry) => [entry.entityId, entry.action])).toEqual([
      [21, 'leave.delete'],
      [11, 'leave.create'],
    ]);
    expect(rows[0]).toMatchObject({ entityType: 'leave', before: null, after: { userId: 5 } });
    const every = await audit.listForType({ entityType: 'leave', since: '2026-11-18T00:00:00Z' });
    expect(every.map((entry) => entry.entityId)).toEqual([22, 21, 11]);
  });

  it('answers [] without a query when there is nothing to read', async () => {
    const { result, selects } = await countSelects(async () => [
      await audit.listForType({ entityType: 'leave' }),
      await audit.listForType({ entityType: 'leave', since: 'not a date' }),
      await audit.listForType({ entityType: 'leave', since: new Date(), actions: [] }),
      await audit.listForType({ since: new Date() }),
    ]);
    expect(result).toEqual([[], [], [], []]);
    expect(selects).toBe(0);
  });
});
