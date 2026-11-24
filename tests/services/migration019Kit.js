// Shared pieces for tests/services/migration019.test.js (CONTRACT 27, "Data"): what migration 019
// must create, read back from information_schema in a way MySQL 8.4 and MariaDB 10.4 both answer
// alike, and a knex whose schema checks answer too early (a rerun of a stopped migrate).
import { db } from '@/lib/db';
import { foreignKeysOf, indexesOf, tablesOf } from './migration018Kit.js';

export const MIGRATION = '019_project_files.js';
export const NEW_TABLES = ['project_files', 'file_uploads', 'file_space'];

const BIG = 'bigint unsigned';
const INT = 'int unsigned';
const NOW = 'current_timestamp';
const FLAG = ['tinyint(1)', 'NO', '0'];
const VISIBILITY = ["enum('everyone','managers')", 'NO', 'managers'];
const NULLABLE = (type) => [type, 'YES', null];
const REQUIRED = (type) => [type, 'NO', null];
const PICTURE = {
  is_picture: FLAG,
  width: NULLABLE(INT),
  height: NULLABLE(INT),
  has_thumb: FLAG,
};

/** Every column of the new tables, and 019's columns of project_documents: [type, null, default]. */
export const COLUMNS = {
  project_files: {
    id: REQUIRED(BIG),
    project_id: REQUIRED(BIG),
    scope: REQUIRED("enum('project','task')"),
    task_id: NULLABLE(BIG),
    phase: NULLABLE('varchar(24)'),
    visibility: VISIBILITY,
    status: ["enum('active','deleted')", 'NO', 'active'],
    name: REQUIRED('varchar(255)'),
    ext: ['varchar(10)', 'NO', ''],
    size_bytes: REQUIRED(BIG),
    storage_key: REQUIRED('varchar(48)'),
    ...PICTURE,
    created_by: REQUIRED(BIG),
    updated_by: NULLABLE(BIG),
    deleted_by: NULLABLE(BIG),
    deleted_at: NULLABLE('datetime'),
    created_at: ['datetime', 'NO', NOW],
    updated_at: ['datetime', 'NO', NOW], // the service writes it
  },
  file_uploads: {
    id: REQUIRED(BIG),
    upload_key: REQUIRED('char(32)'),
    project_id: REQUIRED(BIG),
    target: REQUIRED("enum('project','task')"),
    task_id: NULLABLE(BIG),
    phase: NULLABLE('varchar(24)'),
    visibility: VISIBILITY,
    name: REQUIRED('varchar(255)'),
    ext: ['varchar(10)', 'NO', ''],
    size_bytes: REQUIRED(BIG),
    received_bytes: [BIG, 'NO', '0'],
    piece_bytes: REQUIRED(INT),
    status: ["enum('receiving','ready','attached','cancelled','expired')", 'NO', 'receiving'],
    storage_key: NULLABLE('varchar(48)'),
    ...PICTURE,
    file_id: NULLABLE(BIG),
    busy_until: NULLABLE('datetime'),
    expires_at: REQUIRED('datetime'),
    created_by: REQUIRED(BIG),
    created_at: ['datetime', 'NO', NOW],
    updated_at: ['datetime', 'NO', `${NOW} on update`],
  },
  file_space: {
    id: REQUIRED('tinyint unsigned'),
    disk_full_at: NULLABLE('datetime'),
    updated_at: ['datetime', 'NO', NOW],
  },
  project_documents: {
    phase: NULLABLE('varchar(24)'), // NULL = Whole project
    visibility: VISIBILITY, // every 1.11 row: Only PM and Admins
    file_id: NULLABLE(BIG),
  },
};

/** project_documents' changed columns as 1.11 has them (after down). */
export const DOCUMENT_COLUMNS_1_11 = { phase: REQUIRED('varchar(24)') };

/** Unique keys and plain keys 019 creates, by name: [unique, columns]. */
export const INDEXES = {
  project_files: {
    project_files_storage_key_unique: [true, ['storage_key']],
    project_files_project_id_status_index: [false, ['project_id', 'status']],
    project_files_task_id_status_index: [false, ['task_id', 'status']],
    project_files_status_deleted_at_index: [false, ['status', 'deleted_at']],
  },
  file_uploads: {
    file_uploads_upload_key_unique: [true, ['upload_key']],
    file_uploads_project_id_index: [false, ['project_id']],
    file_uploads_task_id_index: [false, ['task_id']],
    file_uploads_file_id_index: [false, ['file_id']],
    file_uploads_status_expires_at_index: [false, ['status', 'expires_at']],
    file_uploads_created_by_status_index: [false, ['created_by', 'status']],
  },
  project_documents: {
    project_documents_file_id_unique: [true, ['file_id']],
    project_documents_project_id_phase_index: [false, ['project_id', 'phase']], // 015's, kept
  },
};

/** Every foreign key of the new tables, and 019's of project_documents: [column, table, rule]. */
export const FOREIGN_KEYS = {
  project_files: {
    project_files_project_id_foreign: ['project_id', 'projects', 'CASCADE'],
    project_files_task_id_foreign: ['task_id', 'project_tasks', 'SET NULL'],
    project_files_created_by_foreign: ['created_by', 'users', 'RESTRICT'],
    project_files_updated_by_foreign: ['updated_by', 'users', 'RESTRICT'],
    project_files_deleted_by_foreign: ['deleted_by', 'users', 'RESTRICT'],
  },
  file_uploads: {
    file_uploads_project_id_foreign: ['project_id', 'projects', 'CASCADE'],
    file_uploads_task_id_foreign: ['task_id', 'project_tasks', 'SET NULL'],
    file_uploads_file_id_foreign: ['file_id', 'project_files', 'SET NULL'],
    file_uploads_created_by_foreign: ['created_by', 'users', 'RESTRICT'],
  },
  file_space: {},
  project_documents: {
    project_documents_file_id_foreign: ['file_id', 'project_files', 'CASCADE'],
  },
};

/** MariaDB writes display widths ("bigint(20) unsigned"), MySQL 8.4 doesn't; tinyint(1) stays. */
const plainType = (type) =>
  type
    .toLowerCase()
    .replace(/\b(bigint|int|smallint|mediumint)\(\d+\)/g, '$1')
    .replace(/\btinyint\((?!1\))\d+\)/g, 'tinyint');

/**
 * One default as both servers mean it: MariaDB quotes strings ("'managers'", "''") and writes a
 * nullable column's NULL as 'NULL' and "current_timestamp()"; MySQL 8.4 writes none of that.
 */
function plainDefault(value, extra) {
  if (value === null || value === 'NULL') return null;
  const text = String(value).replace(/^'(.*)'$/, '$1');
  if (!/^current_timestamp(\(\))?$/i.test(text)) return text;
  return /on update/i.test(extra ?? '') ? `${NOW} on update` : NOW;
}

const rowsOf = async (sql, bindings) => (await db.raw(sql, bindings))[0];

/** { column: [type, nullable, default] } of the table; `only` keeps those names. */
export async function columnsOf(table, only = null) {
  const rows = await rowsOf(
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, ' +
      'COLUMN_DEFAULT AS fallback, EXTRA AS extra FROM information_schema.COLUMNS ' +
      'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [table],
  );
  return Object.fromEntries(
    rows
      .filter((row) => !only || only.includes(row.name))
      .map((row) => [
        row.name,
        [plainType(row.type), row.nullable, plainDefault(row.fallback, row.extra)],
      ]),
  );
}

/** Every 019 table, column, key and foreign key is there (asserted with `expect`). */
export async function expectSchema(expect) {
  expect(Object.keys(await tablesOf(NEW_TABLES)).sort()).toEqual([...NEW_TABLES].sort());
  for (const table of NEW_TABLES) {
    expect(await columnsOf(table), table).toEqual(COLUMNS[table]);
    expect(await foreignKeysOf(table), table).toEqual(FOREIGN_KEYS[table]);
  }
  const documentColumns = Object.keys(COLUMNS.project_documents);
  expect(await columnsOf('project_documents', documentColumns)).toEqual(COLUMNS.project_documents);
  expect(await foreignKeysOf('project_documents')).toMatchObject(FOREIGN_KEYS.project_documents);
  for (const [table, indexes] of Object.entries(INDEXES)) {
    expect(await indexesOf(table), table).toMatchObject(indexes);
  }
  expect(await db('fileSpace').select('id')).toEqual([{ id: 1 }]);
}

/** Nothing of 019 is left: no new table, project_documents as 1.11 made it. */
export async function expectNoSchema(expect) {
  expect(await tablesOf(NEW_TABLES)).toEqual({});
  const documentColumns = Object.keys(COLUMNS.project_documents);
  expect(await columnsOf('project_documents', documentColumns)).toEqual(DOCUMENT_COLUMNS_1_11);
  const keys = await foreignKeysOf('project_documents');
  expect(keys).not.toHaveProperty('project_documents_file_id_foreign');
  expect(await indexesOf('project_documents')).not.toHaveProperty(
    'project_documents_file_id_unique',
  );
}

/**
 * `base` as a rerun sees it when it checked before the stopped run's statements committed: the
 * first hasTable or hasColumn of each object answers false, later ones the truth.
 */
export function checkedTooEarly(base) {
  const asked = new Set();
  const early = (name, check) => {
    if (asked.has(name)) return check();
    asked.add(name);
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
