// Company request (CONTRACT 28, Daybook 1.13): files from the project on tasks. A link is one row
// naming a task and a file of the project's Files tab; the file stays in its place with its own
// name and setting, so a link is never a copy. ONE SQL statement (raw DDL, as 018 and 019), so on
// MySQL 8.4 and MariaDB 10.4 it either happens or it doesn't; a run the host stopped part way
// ("Aborted") runs again and skips the table when it is already there, also when the stopped run
// left the CREATE finishing on the server (1050, then checked again).
// - task_id CASCADE: deleting a task removes its links; the files stay in Files.
// - file_id CASCADE: the nightly purge of a deleted file row (CONTRACT 27 cleanup) removes them.
// - created_by RESTRICT: users are never deleted.
// The primary key (task_id, file_id) keeps a file on a task once and serves the task_id foreign
// key; file_id has its own key; InnoDB adds the created_by key itself (as 019). No generated
// columns. created_at is UTC, written by the app (nowDate()).
// Roll 020 back before 019: 019's down can't drop project_files while task_file_links points at
// it (the service tests and .github/workflows/migration-check.yml do so).

export const config = { transaction: false };

const ALREADY_THERE = new Set([1050]); // table already exists
const TABLE = 'task_file_links';

const CREATE_LINKS = [
  `CREATE TABLE \`${TABLE}\` (`,
  '  `task_id` BIGINT UNSIGNED NOT NULL,',
  '  `file_id` BIGINT UNSIGNED NOT NULL,',
  '  `created_by` BIGINT UNSIGNED NOT NULL,',
  '  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  PRIMARY KEY (`task_id`, `file_id`),',
  '  KEY `task_file_links_file_id_index` (`file_id`),',
  '  CONSTRAINT `task_file_links_task_id_foreign` FOREIGN KEY (`task_id`) ' +
    'REFERENCES `project_tasks` (`id`) ON DELETE CASCADE,',
  '  CONSTRAINT `task_file_links_file_id_foreign` FOREIGN KEY (`file_id`) ' +
    'REFERENCES `project_files` (`id`) ON DELETE CASCADE,',
  '  CONSTRAINT `task_file_links_created_by_foreign` FOREIGN KEY (`created_by`) ' +
    'REFERENCES `users` (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
].join('\n');

/**
 * Runs one schema statement unless `isThere()` says it already ran (019's, copied). The host
 * stopping a migrate ("Aborted") doesn't stop its CREATE on the server, which finishes it on its
 * own; a rerun that checked before it committed sends the same statement, which waits for it and
 * then fails with 1050. Checked again, that is "already there", and the run goes on.
 */
async function runUnlessThere(ddl, isThere, sql) {
  if (await isThere()) return;
  try {
    await ddl.raw(sql);
  } catch (error) {
    if (!ALREADY_THERE.has(error?.errno) || !(await isThere())) throw error;
  }
}

/** On one pinned connection (019's, copied: the transaction only pins it; DDL commits itself). */
async function onPinnedConnection(knex, run) {
  await knex.transaction(async (ddl) => {
    // A blocked CREATE fails with 1205 after 30 s instead of queueing every request behind it.
    await ddl.raw('SET SESSION lock_wait_timeout = 30');
    try {
      await run(ddl);
    } finally {
      await ddl.raw('SET SESSION lock_wait_timeout = DEFAULT');
    }
  });
}

export async function up(knex) {
  await onPinnedConnection(knex, (ddl) =>
    runUnlessThere(ddl, () => ddl.schema.hasTable(TABLE), CREATE_LINKS),
  );
}

// The links are lost; every file and task stays. Safe to run again (IF EXISTS).
export async function down(knex) {
  await onPinnedConnection(knex, (ddl) => ddl.raw(`DROP TABLE IF EXISTS \`${TABLE}\``));
}
