// Migration 020 (CONTRACT 28, "Data" and "Deploy before migrate") on a fresh test database: up,
// down, up; the table's columns, primary key, keys and the three foreign keys with their ON DELETE
// rules; a second up skips; a stopped up or down runs again; with rows in task_file_links (down
// drops only the links, every task and file stays); 019's down works once 020 is down, and not
// before. Then migration020.js: links read as none and link writes answer UPDATE_NEEDED before
// 020, one warning per area. .github/workflows/migration-check.yml runs this file on MySQL 8.4
// too, so it reads information_schema the way both servers answer and uses only DB_NAME.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { UPDATE_NEEDED_MESSAGE } from '@/modules/projectFiles/migration019';
import {
  guard020Read,
  guard020Write,
  isMissing020,
  linksReady,
  resetMigration020WarningsForTests,
} from '@/modules/projectFiles/migration020';
import * as migration019 from '../../db/migrations/019_project_files.js';
import * as migration020 from '../../db/migrations/020_task_file_links.js';
import { createUser, resetDatabase } from '../helpers/db.js';
import { tablesOf } from './migration018Kit.js';
import { checkedTooEarly } from './migration019Kit.js';
import {
  expectNoTable,
  expectSchema,
  linkRows,
  makeOwner,
  MIGRATION,
  PARENT_IN_USE,
  sqlDuring,
  TABLE,
} from './migration020Kit.js';

let owner;
let rows;

beforeAll(async () => {
  await resetDatabase();
  owner = await makeOwner(createUser);
  rows = linkRows(owner);
});

afterAll(async () => {
  // Leave the test database migrated for the next file, whatever a failed case left behind.
  await migration020.up(db);
  await db.migrate.latest();
});

describe('migration 020: the table, its keys and foreign keys', () => {
  it('creates task_file_links as InnoDB with utf8mb4_unicode_ci, every column and key', async () => {
    await expectSchema(expect);
  });

  it('down drops it and up makes it again (up, down, up on a fresh database)', async () => {
    await db.migrate.down({ name: MIGRATION });
    await expectNoTable(expect);
    await db.migrate.latest();
    await expectSchema(expect);
    const [, pending] = await db.migrate.list();
    expect(pending).toEqual([]);
  });

  it('a second up skips: the table is there, no CREATE is sent', async () => {
    const sql = await sqlDuring(() => migration020.up(db));
    expect(sql.some((text) => /create table/i.test(text))).toBe(false);
    await expectSchema(expect);
  });

  it('a rerun whose check answered before the stopped CREATE committed (1050) goes on', async () => {
    await migration020.up(checkedTooEarly(db));
    await expectSchema(expect);
  });

  it('a down run twice (a stopped one run again) is fine, and up again', async () => {
    await migration020.down(db);
    await migration020.down(db);
    await expectNoTable(expect);
    await migration020.up(db);
    await expectSchema(expect);
  });
});

describe('migration 020 with links', () => {
  let ids;

  beforeAll(async () => {
    ids = {
      login: await rows.addTask('Fix the login page'),
      payment: await rows.addTask('Payment settings page'),
      brief: await rows.addFile(1, { visibility: 'everyone' }),
      contract: await rows.addFile(2), // Only PM and Admins (the column default)
    };
    await rows.link(ids.login, ids.brief);
    await rows.link(ids.login, ids.contract);
    await rows.link(ids.payment, ids.brief);
  });

  it('writes created_at itself when the app leaves it out', async () => {
    const other = await rows.addTask('Stock sync with the warehouse');
    await db('taskFileLinks').insert({ taskId: other, fileId: ids.brief, createdBy: owner.pm.id });
    const row = await db('taskFileLinks').where({ taskId: other }).first();
    expect(row.createdAt).toBeInstanceOf(Date);
    await db('projectTasks').where({ id: other }).del();
  });

  it('links a file to a task once (the primary key)', async () => {
    await expect(rows.link(ids.login, ids.brief)).rejects.toMatchObject({ errno: 1062 });
    expect(await rows.links()).toHaveLength(3);
  });

  it('never links to a task, file or person that is not there', async () => {
    await expect(rows.link(999999, ids.brief)).rejects.toMatchObject({ errno: 1452 });
    await expect(rows.link(ids.payment, 999999)).rejects.toMatchObject({ errno: 1452 });
    await expect(rows.link(ids.payment, ids.contract, 999999)).rejects.toMatchObject({
      errno: 1452,
    });
  });

  it('keeps a person who linked a file (users are never deleted: RESTRICT)', async () => {
    const hr = await createUser({ role: 'hr' });
    await rows.link(ids.payment, ids.contract, hr.id);
    await expect(db('users').where({ id: hr.id }).del()).rejects.toMatchObject({ errno: 1451 });
    await db('taskFileLinks').where({ taskId: ids.payment, fileId: ids.contract }).del();
    await db('users').where({ id: hr.id }).del();
  });

  it('a deleted task takes its links with it; the files stay in Files', async () => {
    const task = await rows.addTask('Product image zoom');
    await rows.link(task, ids.brief);
    await rows.link(task, ids.contract);
    await db('projectTasks').where({ id: task }).del();
    expect(await db('taskFileLinks').where({ taskId: task })).toEqual([]);
    const files = await db('projectFiles').whereIn('id', [ids.brief, ids.contract]).select('id');
    expect(files).toHaveLength(2);
  });

  it('the purge of a deleted file row takes its links with it; the tasks stay', async () => {
    const deletedBy = owner.pm.id;
    const file = await rows.addFile(3, { status: 'deleted', deletedAt: new Date(), deletedBy });
    await rows.link(ids.login, file);
    await rows.link(ids.payment, file);
    await db('projectFiles').where({ id: file, status: 'deleted' }).delete(); // as cleanup.js
    expect(await db('taskFileLinks').where({ fileId: file })).toEqual([]);
    const tasks = await db('projectTasks').whereIn('id', [ids.login, ids.payment]).select('id');
    expect(tasks).toHaveLength(2);
  });

  it("019's down is refused while links point at project_files, and works once 020 is down", async () => {
    // Straight to 019's down (not through knex, so its log is unchanged): it stops at
    // project_files, which keeps its rows and links.
    const error = await migration019.down(db).catch((caught) => caught);
    expect(PARENT_IN_USE).toContain(error?.errno);
    expect(await rows.links()).toHaveLength(3);
    // 020 first, then 019's down runs again (it checks each object first); latest brings both.
    await db.migrate.down({ name: MIGRATION });
    await db.migrate.down({ name: '019_project_files.js' });
    expect(await tablesOf(['project_files', TABLE])).toEqual({});
    await db.migrate.latest();
    await expectSchema(expect);
  });
});

describe('migration 020 down and up with rows', () => {
  let ids;

  beforeAll(async () => {
    ids = {
      login: await rows.addTask('Fix the login page'),
      brief: await rows.addFile(4, { visibility: 'everyone' }),
      contract: await rows.addFile(5),
    };
    await rows.link(ids.login, ids.brief);
    await rows.link(ids.login, ids.contract);
  });

  it('down drops the links only: every task and file stays', async () => {
    expect(await db('taskFileLinks').where({ taskId: ids.login })).toHaveLength(2);
    await db.migrate.down({ name: MIGRATION });
    await expectNoTable(expect);
    expect(await db('projectTasks').where({ id: ids.login }).first('title')).toEqual({
      title: 'Fix the login page',
    });
    const files = await db('projectFiles')
      .whereIn('id', [ids.brief, ids.contract])
      .orderBy('id')
      .select('id', 'status', 'visibility');
    expect(files).toEqual([
      { id: ids.brief, status: 'active', visibility: 'everyone' },
      { id: ids.contract, status: 'active', visibility: 'managers' },
    ]);
  });

  it('up again makes an empty table, and links work as before', async () => {
    await db.migrate.latest();
    await expectSchema(expect);
    expect(await rows.links()).toEqual([]);
    await rows.link(ids.login, ids.contract);
    expect(await rows.links()).toEqual([{ taskId: ids.login, fileId: ids.contract }]);
  });

  it('down and up again with that row', async () => {
    await db.migrate.down({ name: MIGRATION });
    await expectNoTable(expect);
    await db.migrate.latest();
    await expectSchema(expect);
    expect(await rows.links()).toEqual([]);
  });
});

describe('deploy before migrate (migration020.js)', () => {
  const missing = Object.assign(new Error("Table 'task_file_links' doesn't exist"), {
    errno: 1146,
  });
  const fails = (error) => () => Promise.reject(error);
  let warn;

  beforeAll(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterAll(() => warn.mockRestore());

  it('tells a missing table (1146) from every other error', () => {
    expect(isMissing020(missing)).toBe(true);
    expect(isMissing020({ errno: 1054 })).toBe(false); // 020 adds no column
    expect(isMissing020({ errno: 1062 })).toBe(false);
    expect(isMissing020(null)).toBe(false);
  });

  it('reads links as none and answers UPDATE_NEEDED on a write, warning once per area', async () => {
    resetMigration020WarningsForTests();
    warn.mockClear();
    expect(await guard020Read('links', fails(missing), () => [])).toEqual([]);
    expect(await guard020Read('links', fails(missing), () => 0)).toBe(0);
    await expect(guard020Write('links', fails(missing))).rejects.toMatchObject({
      code: 'UPDATE_NEEDED',
      status: 503,
      message: 'This needs the latest database update. Ask an Admin.',
    });
    expect(UPDATE_NEEDED_MESSAGE).toBe('This needs the latest database update. Ask an Admin.');
    expect(warn.mock.calls).toEqual([
      ['The 1.13 database update is missing (run the migrate line); links is off'],
    ]);
  });

  it('lets every other error through and answers what the read or write answers', async () => {
    const other = Object.assign(new Error('Duplicate entry'), { errno: 1062 });
    await expect(guard020Read('links', fails(other), () => [])).rejects.toBe(other);
    await expect(guard020Write('links', fails(other))).rejects.toBe(other);
    const read = async () => [7];
    expect(await guard020Read('links', read, () => [])).toEqual([7]);
    expect(await guard020Write('links', async () => 'saved')).toBe('saved');
  });

  it('linksReady: false before 020, true after, never cached; a transaction goes on', async () => {
    resetMigration020WarningsForTests();
    warn.mockClear();
    expect(await linksReady()).toBe(true);
    await db.migrate.down({ name: MIGRATION });
    expect(await linksReady()).toBe(false);
    expect(await linksReady()).toBe(false);
    // MySQL and MariaDB roll back only the failed statement: the transaction goes on.
    await db.transaction(async (trx) => {
      const read = () => trx('taskFileLinks').where({ taskId: 1 }).select('fileId');
      expect(await guard020Read('links', read, () => [])).toEqual([]);
      const project = await trx('projects').where({ id: owner.project.id }).first('id');
      expect(project).toEqual({ id: owner.project.id });
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await db.migrate.latest();
    expect(await linksReady()).toBe(true);
  });
});
