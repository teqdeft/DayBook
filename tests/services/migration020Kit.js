// Shared pieces for tests/services/migration020.test.js (CONTRACT 28, "Data"): what migration 020
// must create, read back from information_schema in a way MySQL 8.4 and MariaDB 10.4 both answer
// alike, and the rows the tests link (no disk file: the migration never reads the disk).
import { db } from '@/lib/db';
import { constraintsOf, foreignKeysOf, indexesOf, tablesOf } from './migration018Kit.js';
import { columnsOf } from './migration019Kit.js';

export const MIGRATION = '020_task_file_links.js';
export const TABLE = 'task_file_links';

const BIG = 'bigint unsigned';
const STAMP = new Date('2026-11-24T05:00:00Z');
const HEX = (n) => String(n).repeat(32).slice(0, 32);

/** [type, nullable, default] as migration019Kit's columnsOf reads them on both servers. */
export const COLUMNS = {
  task_id: [BIG, 'NO', null],
  file_id: [BIG, 'NO', null],
  created_by: [BIG, 'NO', null],
  created_at: ['datetime', 'NO', 'current_timestamp'],
};
// The primary key serves the task_id foreign key; InnoDB adds the created_by key itself.
export const INDEXES = {
  task_file_links_file_id_index: [false, ['file_id']],
  task_file_links_created_by_foreign: [false, ['created_by']],
};
export const FOREIGN_KEYS = {
  task_file_links_task_id_foreign: ['task_id', 'project_tasks', 'CASCADE'],
  task_file_links_file_id_foreign: ['file_id', 'project_files', 'CASCADE'],
  task_file_links_created_by_foreign: ['created_by', 'users', 'RESTRICT'],
};
// 019's down refused while task_file_links points at project_files: MariaDB 10.4 answers 1217
// (or 1451), MySQL 8.4 3730.
export const PARENT_IN_USE = [1217, 1451, 3730];

const rowsOf = async (sql, bindings) => (await db.raw(sql, bindings))[0];

/** The primary key's columns, in order. */
async function primaryKeyOf(table) {
  const rows = await rowsOf(
    'SELECT COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE ' +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' " +
      'ORDER BY ORDINAL_POSITION',
    [table],
  );
  return rows.map((row) => row.col);
}

/** Every part of 020 is there (asserted with `expect`). */
export async function expectSchema(expect) {
  expect(await tablesOf([TABLE])).toEqual({
    [TABLE]: { collation: 'utf8mb4_unicode_ci', engine: 'InnoDB' },
  });
  expect(await columnsOf(TABLE)).toEqual(COLUMNS);
  expect(await primaryKeyOf(TABLE)).toEqual(['task_id', 'file_id']);
  expect(await indexesOf(TABLE)).toEqual(INDEXES);
  expect(await foreignKeysOf(TABLE)).toEqual(FOREIGN_KEYS);
  const constraints = await constraintsOf(TABLE);
  expect(constraints.PRIMARY).toBe('PRIMARY KEY');
  for (const name of Object.keys(FOREIGN_KEYS)) expect(constraints[name], name).toBe('FOREIGN KEY');
}

/** Nothing of 020 is left. */
export async function expectNoTable(expect) {
  expect(await tablesOf([TABLE])).toEqual({});
}

/** The SQL sent while `run` runs. */
export async function sqlDuring(run) {
  const queries = [];
  const listen = (query) => queries.push(query.sql);
  db.on('query', listen);
  try {
    await run();
  } finally {
    db.removeListener('query', listen);
  }
  return queries;
}

/**
 * Rows for the tests, on one project of `pm`: tasks, project files and links.
 * @param {{ pm: { id: number }, project: { id: number } }} owner
 */
export function linkRows({ pm, project }) {
  return {
    /** One project_tasks row; returns its id. */
    async addTask(title) {
      const [id] = await db('projectTasks').insert({
        projectId: project.id,
        title,
        createdBy: pm.id,
      });
      return id;
    },
    /** One project file row (Only PM and Admins unless `fields` say otherwise); returns its id. */
    async addFile(n, fields = {}) {
      const [id] = await db('projectFiles').insert({
        projectId: project.id,
        scope: 'project',
        name: `brief-${n}.pdf`,
        ext: 'pdf',
        sizeBytes: 1024 * n,
        storageKey: `2026/11/${HEX(n)}`,
        createdBy: pm.id,
        createdAt: STAMP,
        updatedAt: STAMP,
        ...fields,
      });
      return id;
    },
    link: (taskId, fileId, createdBy = pm.id) =>
      db('taskFileLinks').insert({ taskId, fileId, createdBy, createdAt: STAMP }),
    links: () => db('taskFileLinks').orderBy(['taskId', 'fileId']).select('taskId', 'fileId'),
  };
}

/** One PM and their project, for the rows above. */
export async function makeOwner(createUser) {
  const pm = await createUser({ role: 'pm' });
  const client = await db('clients').first('id');
  const [projectId] = await db('projects').insert({
    name: 'Acme store',
    clientId: client.id,
    pmId: pm.id,
    createdBy: pm.id,
  });
  return { pm, project: { id: projectId } };
}
