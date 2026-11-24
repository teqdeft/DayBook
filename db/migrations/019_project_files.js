// Company request (CONTRACT 27, Daybook 1.12): the project board, files on tasks and the Files tab.
// From 1.12 Daybook keeps real files, on disk in a private folder (FILES_DIR); these tables name
// them. Four parts, each ONE SQL statement (raw DDL, as 018), so on MySQL 8.4 and MariaDB 10.4 it
// either happens or it doesn't; a run the host stopped part way ("Aborted") runs again and skips
// what is already there (hasTable / hasColumn on each statement's first new object), also a
// statement the stopped run left finishing on the server (1050 or 1060, then checked again).
// - project_files: every real file, of the project (a place: Whole project or a phase, and who
//   sees it) or of one task;
// - file_uploads: uploads on their way in (receiving) and finished task uploads held for the save;
// - file_space: one row, the lock that keeps two Starts from both passing the storage limit;
// - project_documents: Whole project (phase NULL), who sees it, and the file a text was read from.
//   Every existing row gets 'managers' (Only PM and Admins), today's privacy.
// No generated columns, so MySQL error 3192 can't arise. DATETIMEs are UTC, written by the app.
// Files on disk are never touched here, also not by down (README).

export const config = { transaction: false };

const ALREADY_THERE = new Set([1050, 1060]); // table already exists, duplicate column name
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const VISIBILITY = "ENUM('everyone','managers') NOT NULL DEFAULT 'managers'"; // fails closed
const USERS = 'REFERENCES `users` (`id`)';
const PROJECTS = 'REFERENCES `projects` (`id`)';
const TASKS = 'REFERENCES `project_tasks` (`id`)';
const FILES = 'REFERENCES `project_files` (`id`)';
// The picture facts, set at Finish (and copied from the upload at attach); they never change.
const PICTURE = [
  '`is_picture` TINYINT(1) NOT NULL DEFAULT 0',
  '`width` INT UNSIGNED NULL',
  '`height` INT UNSIGNED NULL',
  '`has_thumb` TINYINT(1) NOT NULL DEFAULT 0', // a thumbnail sits at files/<storage_key>.t
];
const DOCUMENT_FK = 'project_documents_file_id_foreign';

/** CREATE TABLE with the column, key and constraint lines and the table options. */
function createTable(name, lines) {
  return `CREATE TABLE \`${name}\` (\n  ${lines.join(',\n  ')}\n) ${OPTIONS}`;
}

/** One inline foreign key named as knex names it: `<table>_<column>_foreign`. */
function foreignKey(table, column, target, onDelete = '') {
  const name = `${table}_${column}_foreign`;
  return `CONSTRAINT \`${name}\` FOREIGN KEY (\`${column}\`) ${target}${onDelete ? ` ON DELETE ${onDelete}` : ''}`;
}

/** One plain key named as knex names it: `<table>_<columns>_index`. */
function key(table, columns) {
  const list = columns.map((column) => `\`${column}\``).join(', ');
  return `KEY \`${table}_${columns.join('_')}_index\` (${list})`;
}

const TABLES = {
  project_files: createTable('project_files', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    // Projects are never deleted in the app; seed:demo and reset empty the folder themselves.
    '`project_id` BIGINT UNSIGNED NOT NULL',
    "`scope` ENUM('project','task') NOT NULL",
    // The task delete marks its files deleted first; SET NULL is the safety net (a task file
    // without its task is never served, and the cleanup purges it).
    '`task_id` BIGINT UNSIGNED NULL',
    '`phase` VARCHAR(24) NULL', // project files: NULL = Whole project; task files: always NULL
    `\`visibility\` ${VISIBILITY}`, // task files: stored 'managers', never read
    "`status` ENUM('active','deleted') NOT NULL DEFAULT 'active'",
    '`name` VARCHAR(255) NOT NULL', // the cleaned display name; never on disk
    "`ext` VARCHAR(10) NOT NULL DEFAULT ''",
    '`size_bytes` BIGINT UNSIGNED NOT NULL',
    '`storage_key` VARCHAR(48) NOT NULL', // 'yyyy/mm/<32 lower hex>', the UTC month of Finish
    ...PICTURE,
    '`created_by` BIGINT UNSIGNED NOT NULL',
    '`updated_by` BIGINT UNSIGNED NULL',
    '`deleted_by` BIGINT UNSIGNED NULL',
    '`deleted_at` DATETIME NULL',
    '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', // the service writes both
    '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'PRIMARY KEY (`id`)',
    'UNIQUE KEY `project_files_storage_key_unique` (`storage_key`)',
    key('project_files', ['project_id', 'status']), // the Files tab, the foreign key
    key('project_files', ['task_id', 'status']), // task windows, counts, the foreign key
    key('project_files', ['status', 'deleted_at']), // the nightly purge
    foreignKey('project_files', 'project_id', PROJECTS, 'CASCADE'),
    foreignKey('project_files', 'task_id', TASKS, 'SET NULL'),
    foreignKey('project_files', 'created_by', USERS), // users are never deleted: RESTRICT
    foreignKey('project_files', 'updated_by', USERS),
    foreignKey('project_files', 'deleted_by', USERS),
  ]),
  file_uploads: createTable('file_uploads', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    '`upload_key` CHAR(32) NOT NULL', // random hex, the only id the browser sees
    '`project_id` BIGINT UNSIGNED NOT NULL',
    "`target` ENUM('project','task') NOT NULL",
    '`task_id` BIGINT UNSIGNED NULL', // the existing task, or NULL for a task not saved yet
    '`phase` VARCHAR(24) NULL', // target project only
    `\`visibility\` ${VISIBILITY}`, // target project only; Start always writes the choice
    '`name` VARCHAR(255) NOT NULL',
    "`ext` VARCHAR(10) NOT NULL DEFAULT ''",
    '`size_bytes` BIGINT UNSIGNED NOT NULL',
    '`received_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0', // the offset
    '`piece_bytes` INT UNSIGNED NOT NULL', // the piece size given at Start
    "`status` ENUM('receiving','ready','attached','cancelled','expired') NOT NULL DEFAULT 'receiving'",
    // Chosen at Finish before the .part is renamed, so the row always names any disk file it made.
    '`storage_key` VARCHAR(48) NULL',
    ...PICTURE,
    '`file_id` BIGINT UNSIGNED NULL',
    '`busy_until` DATETIME NULL', // the lease of the request writing a piece or finishing
    '`expires_at` DATETIME NOT NULL',
    '`created_by` BIGINT UNSIGNED NOT NULL',
    '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'PRIMARY KEY (`id`)',
    'UNIQUE KEY `file_uploads_upload_key_unique` (`upload_key`)',
    key('file_uploads', ['project_id']),
    key('file_uploads', ['task_id']),
    key('file_uploads', ['file_id']),
    key('file_uploads', ['status', 'expires_at']), // space used, cleanup
    key('file_uploads', ['created_by', 'status']), // running uploads per person
    foreignKey('file_uploads', 'project_id', PROJECTS, 'CASCADE'),
    foreignKey('file_uploads', 'task_id', TASKS, 'SET NULL'),
    foreignKey('file_uploads', 'file_id', FILES, 'SET NULL'),
    foreignKey('file_uploads', 'created_by', USERS),
  ]),
  file_space: createTable('file_space', [
    '`id` TINYINT UNSIGNED NOT NULL',
    '`disk_full_at` DATETIME NULL', // the last time the server refused a write for lack of disk
    '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'PRIMARY KEY (`id`)',
  ]),
};

// One statement, so the columns, the unique key (one text per file) and the foreign key come
// together. The table is copied once (adding a foreign key); it is small (at most 40 rows a
// project before 1.12). CASCADE: a file's text never outlives its file row, so it can never turn
// into a text-only document (the service deletes it in the same transaction first).
const ALTER_DOCUMENTS = [
  'ALTER TABLE `project_documents`',
  '  MODIFY `phase` VARCHAR(24) NULL,',
  `  ADD COLUMN \`visibility\` ${VISIBILITY},`,
  '  ADD COLUMN `file_id` BIGINT UNSIGNED NULL,',
  '  ADD UNIQUE KEY `project_documents_file_id_unique` (`file_id`),',
  `  ADD ${foreignKey('project_documents', 'file_id', FILES, 'CASCADE')}`,
].join('\n');

// down: 1.11 has no Whole project and no file column. The text of an uploaded file stays as a
// text-only document (kind 'file', the original file wasn't kept), as before 1.12.
const DROP_DOCUMENT_FK = `ALTER TABLE \`project_documents\` DROP FOREIGN KEY \`${DOCUMENT_FK}\``;
const SHRINK_DOCUMENTS = [
  'ALTER TABLE `project_documents`',
  '  DROP INDEX `project_documents_file_id_unique`,',
  '  DROP COLUMN `file_id`,',
  '  DROP COLUMN `visibility`,',
  '  MODIFY `phase` VARCHAR(24) NOT NULL',
].join('\n');

async function hasForeignKey(knex, table, name) {
  const [rows] = await knex.raw(
    'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ' +
      "AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
    [table, name],
  );
  return rows.length > 0;
}

/**
 * Runs one schema statement unless `isThere()` says it already ran. The host stopping a migrate
 * ("Aborted") doesn't stop its CREATE or ALTER on the server, which finishes it on its own; a
 * rerun that checked before it committed sends the same statement, which waits for it and then
 * fails with 1050 or 1060. Checked again, that is "already there", and the run goes on.
 */
async function runUnlessThere(ddl, isThere, sql) {
  if (await isThere()) return;
  try {
    await ddl.raw(sql);
  } catch (error) {
    if (!ALREADY_THERE.has(error?.errno) || !(await isThere())) throw error;
  }
}

/** On one pinned connection (the transaction only pins it: each DDL commits on its own). */
async function onPinnedConnection(knex, run) {
  await knex.transaction(async (ddl) => {
    // A blocked ALTER fails with 1205 after 30 s instead of queueing every request behind it.
    await ddl.raw('SET SESSION lock_wait_timeout = 30');
    try {
      await run(ddl);
    } finally {
      await ddl.raw('SET SESSION lock_wait_timeout = DEFAULT');
    }
  });
}

export async function up(knex) {
  await onPinnedConnection(knex, async (ddl) => {
    for (const [name, sql] of Object.entries(TABLES)) {
      await runUnlessThere(ddl, () => ddl.schema.hasTable(name), sql);
    }
    // The one space row; Start puts it back only when its lock finds none. Both servers.
    await ddl.raw(
      'INSERT IGNORE INTO `file_space` (`id`, `updated_at`) VALUES (1, UTC_TIMESTAMP())',
    );
    const hasVisibility = () => ddl.schema.hasColumn('project_documents', 'visibility');
    await runUnlessThere(ddl, hasVisibility, ALTER_DOCUMENTS);
  });
}

// Each object is checked first, so a stopped down runs again.
export async function down(knex) {
  await onPinnedConnection(knex, async (ddl) => {
    // Whole project notes go to the first phase; `updated_at = updated_at` keeps the column's ON
    // UPDATE from restamping them (the AI summary's freshness and the notes' dates stay).
    await ddl.raw(
      "UPDATE `project_documents` SET `phase` = 'requirement_gathering', " +
        '`updated_at` = `updated_at` WHERE `phase` IS NULL',
    );
    if (await hasForeignKey(ddl, 'project_documents', DOCUMENT_FK)) {
      await ddl.raw(DROP_DOCUMENT_FK);
    }
    if (await ddl.schema.hasColumn('project_documents', 'visibility')) {
      await ddl.raw(SHRINK_DOCUMENTS);
    }
    for (const name of ['file_uploads', 'file_space', 'project_files']) {
      await ddl.schema.dropTableIfExists(name);
    }
  });
}
