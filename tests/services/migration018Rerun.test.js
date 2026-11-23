// Migration 018 run again while the stopped run's statement still finishes on the server
// (CONTRACT 25, Data). The host stopping a migrate ("Aborted") doesn't stop its ALTER or CREATE:
// the server finishes it on its own. A rerun that checked hasColumn or hasTable before it
// committed sends the same statement, which waits for it and then fails with 1060 "Duplicate
// column name" (1050 "Table already exists" for a CREATE TABLE). 018 checks again, reads that as
// already there and goes on, so the owner's second run works.
import knex from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import * as migration018 from '../../db/migrations/018_hr_tools.js';
import { buildKnexConfig } from '../../knexfile.js';
import { resetDatabase } from '../helpers/db.js';
import {
  COLUMNS,
  columnsOf,
  FOREIGN_KEYS,
  foreignKeysOf,
  MIGRATION,
  NEW_TABLES,
  tablesOf,
} from './migration018Kit.js';

// Each step copies attendance and attendance_breaks once (ALGORITHM=COPY).
const MIGRATE_MS = 120_000;
const WAIT = { timeout: 20_000, interval: 50 };

let reader; // a long read of attendance, which holds the stopped run's ALTER back
let stopped; // the stopped run's connection: the server keeps running its statement

/** The ALTERs of `table` this database's sessions are running or waiting on. */
async function altersOf(table) {
  const [rows] = await db.raw(
    'SELECT ID FROM information_schema.PROCESSLIST WHERE DB = DATABASE() AND INFO LIKE ?',
    [`ALTER TABLE \`${table}\`%`],
  );
  return rows.length;
}

/** Every 018 table, column and foreign key is there. */
async function expectSchema() {
  expect(Object.keys(await tablesOf(NEW_TABLES)).sort()).toEqual([...NEW_TABLES].sort());
  for (const table of Object.keys(COLUMNS)) {
    expect(await columnsOf(table), table).toEqual(COLUMNS[table]);
  }
  for (const [table, keys] of Object.entries(FOREIGN_KEYS)) {
    expect(await foreignKeysOf(table), table).toMatchObject(keys);
  }
}

/**
 * `base` as a rerun sees it when it checked before the stopped run's statements committed: in
 * the schema step the first hasTable or hasColumn of each object answers false, later ones the
 * truth. The objects in `never` always answer false.
 */
function checkedTooEarly(base, { never = [] } = {}) {
  const asked = new Set();
  const early = (key, check) => {
    if (asked.has(key) && !never.includes(key)) return check();
    asked.add(key);
    return Promise.resolve(false);
  };
  const wrap = (trx) =>
    new Proxy(trx, {
      get(target, prop) {
        if (prop !== 'schema') return Reflect.get(target, prop);
        return {
          hasTable: (name) => early(name, () => target.schema.hasTable(name)),
          hasColumn: (table, column) =>
            early(`${table}.${column}`, () => target.schema.hasColumn(table, column)),
        };
      },
    });
  return new Proxy(base, {
    get(target, prop) {
      if (prop !== 'transaction') return Reflect.get(target, prop);
      return (run, ...rest) => target.transaction((trx) => run(wrap(trx)), ...rest);
    },
  });
}

beforeAll(async () => {
  reader = knex(buildKnexConfig());
  stopped = knex(buildKnexConfig());
  await resetDatabase();
}, MIGRATE_MS);

afterAll(async () => {
  await reader.destroy();
  await stopped.destroy();
  // Leave the test database migrated for the next file.
  await db.migrate.latest();
}, MIGRATE_MS);

describe('migration 018 run again after an Aborted run', { timeout: MIGRATE_MS }, () => {
  it("goes on when its ALTER meets the stopped run's ALTER still finishing (1060)", async () => {
    await db.migrate.down({ name: MIGRATION });
    const hold = await reader.transaction();
    await hold.raw('SELECT `id` FROM `attendance` LIMIT 1');
    // The stopped run's ALTER of attendance waits for that read; the server would finish it.
    const first = migration018.up(stopped);
    await vi.waitFor(async () => expect(await altersOf('attendance')).toBe(1), WAIT);
    // The rerun finds no column yet and sends the same ALTER, which waits behind it.
    const rerun = migration018.up(db);
    await vi.waitFor(async () => expect(await altersOf('attendance')).toBe(2), WAIT);
    await hold.commit();
    const [stoppedRun, rerunRun] = await Promise.allSettled([first, rerun]);
    expect(stoppedRun).toMatchObject({ status: 'fulfilled' });
    expect(rerunRun).toMatchObject({ status: 'fulfilled' });
    await expectSchema();
  });

  it('goes on when each table and column it checked is there by the time it runs (1050, 1060)', async () => {
    await migration018.down(db);
    await migration018.up(stopped);
    // Each CREATE TABLE fails with 1050 and each ALTER with 1060; the second check says done.
    await expect(migration018.up(checkedTooEarly(db))).resolves.toBeUndefined();
    await expectSchema();
  });

  it('still fails when the second check finds nothing', async () => {
    const run = migration018.up(checkedTooEarly(db, { never: ['attendance.checkout_entered_by'] }));
    await expect(run).rejects.toMatchObject({ errno: 1060 });
    await expectSchema();
  });
});
