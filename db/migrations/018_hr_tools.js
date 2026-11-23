// Company request after the build guide (CONTRACT 25, Daybook 1.10): HR tools, breaks and missing
// check-outs. Three parts:
// 1. Schema. Each table change is ONE SQL statement (raw DDL), so on MySQL 8.4 and MariaDB 10.4 it
//    either happens or it doesn't. knex's createTable and alterTable send unique keys and foreign
//    keys as separate statements, which a run the host stopped part way ("Aborted") could leave out
//    for good; they aren't used here. A stopped run runs again and skips what is already there
//    (hasTable / hasColumn on each statement's first new object), also a statement the stopped
//    run left finishing on the server (1050 or 1060, then checked again).
//    - holidays, leave_entries, attendance_reminders, attendance_alerts: new tables;
//    - attendance: who entered a missing check-out and when, the suggested time the person saw,
//      and "Not now" on Today's pop-up;
//    - attendance_breaks: end_reason gains 'away' and 'hr' IN THE SAME STATEMENT that adds source
//      and changed_by_id. Every 1.10 write of 'away' or 'hr' also writes one of those columns, so
//      before this statement it fails with errno 1054 ("needs the latest database update") and
//      never with 1265 or a silent '' on a server without a strict sql_mode.
// 2. Backfill: time removed from a timer as away time since 1 Nov 2026 becomes an away break (the
//    1.09 bug: Remove never wrote attendance_breaks). One short transaction per person and day that
//    locks that day's attendance row first (CONTRACT 15's order), so a 1.10 Remove of the same
//    person and day waits for it instead of racing it. Daily reports are never read or written.
// 3. The deploy day's late-alert run is claimed, so HR's first late alerts come at office end of
//    the next working day, after an Admin has set the payroll month (CONTRACT 25, item 10).
// No knex batch transaction (config below): DDL commits on its own on both servers anyway, and the
// backfill needs its own short transactions.
import { removedSpans } from '../lib/removedSpans018.js';

export const config = { transaction: false };

const BACKFILL_FROM = '2026-11-01';
const RETRY_ERRNOS = new Set([1213, 1205]); // deadlock, lock wait timeout
const ALREADY_THERE = new Set([1050, 1060]); // table already exists, duplicate column name
const ATTEMPTS = 3;
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const TIMESTAMPS = [
  '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
];
const OLD_END_REASONS = "ENUM('self','checkout','timer','midnight')";
const NEW_END_REASONS = "ENUM('self','checkout','timer','midnight','away','hr')";
const USERS = 'REFERENCES `users` (`id`)';

/** CREATE TABLE with the column, key and constraint lines and the table options. */
function createTable(name, lines) {
  return `CREATE TABLE \`${name}\` (\n  ${lines.join(',\n  ')}\n) ${OPTIONS}`;
}

/** One inline foreign key named as knex names it: `<table>_<column>_foreign`. */
function foreignKey(table, column, target, onDelete = '') {
  const name = `${table}_${column}_foreign`;
  return `CONSTRAINT \`${name}\` FOREIGN KEY (\`${column}\`) ${target}${onDelete ? ` ON DELETE ${onDelete}` : ''}`;
}

const TABLES = {
  holidays: createTable('holidays', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    '`holiday_date` DATE NOT NULL', // company date; one holiday per date
    '`name` VARCHAR(80) NOT NULL',
    '`created_by` BIGINT UNSIGNED NULL',
    '`updated_by` BIGINT UNSIGNED NULL',
    ...TIMESTAMPS,
    'PRIMARY KEY (`id`)',
    'UNIQUE KEY `holidays_holiday_date_unique` (`holiday_date`)',
    foreignKey('holidays', 'created_by', USERS),
    foreignKey('holidays', 'updated_by', USERS),
  ]),
  // "leave" is a reserved word in MySQL.
  leave_entries: createTable('leave_entries', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    '`user_id` BIGINT UNSIGNED NOT NULL',
    '`from_date` DATE NOT NULL', // company dates, both included
    '`to_date` DATE NOT NULL',
    "`part` ENUM('full','first_half','second_half') NOT NULL DEFAULT 'full'",
    '`paid` TINYINT(1) NOT NULL DEFAULT 1',
    "`leave_type` ENUM('casual','sick','other') NOT NULL DEFAULT 'casual'",
    '`note` VARCHAR(300) NULL', // HR and Admins only, never the person
    '`created_by` BIGINT UNSIGNED NULL',
    '`updated_by` BIGINT UNSIGNED NULL',
    ...TIMESTAMPS,
    'PRIMARY KEY (`id`)',
    'KEY `leave_entries_user_id_from_date_index` (`user_id`, `from_date`)',
    'KEY `leave_entries_from_date_to_date_index` (`from_date`, `to_date`)',
    foreignKey('leave_entries', 'user_id', USERS, 'CASCADE'),
    foreignKey('leave_entries', 'created_by', USERS),
    foreignKey('leave_entries', 'updated_by', USERS),
  ]),
  // One row per remind sent (HR's Remind and Daybook's check-in reminder).
  attendance_reminders: createTable('attendance_reminders', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    '`user_id` BIGINT UNSIGNED NOT NULL', // who was reminded
    "`kind` ENUM('check_in','break','check_out','missing_checkout') NOT NULL",
    '`work_date` DATE NOT NULL', // company date it was sent
    '`sent_by` BIGINT UNSIGNED NULL', // null = Daybook
    '`sent_at` DATETIME NOT NULL',
    '`auto_key` VARCHAR(40) NULL', // automatic reminders only: 'check_in:2026-11-19'
    ...TIMESTAMPS,
    'PRIMARY KEY (`id`)',
    // NULL auto_keys never collide, on either server.
    'UNIQUE KEY `attendance_reminders_user_id_auto_key_unique` (`user_id`, `auto_key`)',
    'KEY `attendance_reminders_user_id_kind_sent_at_index` (`user_id`, `kind`, `sent_at`)',
    'KEY `attendance_reminders_work_date_index` (`work_date`)',
    foreignKey('attendance_reminders', 'user_id', USERS, 'CASCADE'),
    foreignKey('attendance_reminders', 'sent_by', USERS, 'SET NULL'),
  ]),
  // One row per HR alert or summary per person and period: 'late_days' (period 'YYYY-MM', the
  // payroll month), 'hr_morning' and 'hr_evening' (period 'YYYY-MM-DD'; user_id = the recipient).
  attendance_alerts: createTable('attendance_alerts', [
    '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    '`user_id` BIGINT UNSIGNED NOT NULL',
    '`kind` VARCHAR(30) NOT NULL', // VARCHAR, so a later kind needs no ALTER
    '`period_key` VARCHAR(10) NOT NULL',
    '`days` SMALLINT UNSIGNED NOT NULL DEFAULT 0', // late days when sent; 0 for summaries
    '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'PRIMARY KEY (`id`)',
    'UNIQUE KEY `attendance_alerts_user_id_kind_period_key_unique` (`user_id`, `kind`, `period_key`)',
    foreignKey('attendance_alerts', 'user_id', USERS),
  ]),
};

// Never part of ROW_COLUMNS (attendance/repo.js): read by checkoutEntered.js and missingRepo.js.
const ALTER_ATTENDANCE = [
  'ALTER TABLE `attendance`',
  '  ADD COLUMN `checkout_entered_by` BIGINT UNSIGNED NULL,',
  '  ADD COLUMN `checkout_entered_at` DATETIME NULL,',
  '  ADD COLUMN `checkout_suggested_at` DATETIME NULL,',
  '  ADD COLUMN `checkout_prompt_hidden_on` DATE NULL,',
  `  ADD ${foreignKey('attendance', 'checkout_entered_by', USERS, 'SET NULL')}`,
].join('\n');

// Never part of BREAK_COLUMNS. away_entry_id and changed_by_id are not base columns of the stored
// generated open_user_id, so MySQL error 3192 doesn't apply to their foreign keys (as
// paused_entry_id in migration 009).
const ALTER_BREAKS = [
  'ALTER TABLE `attendance_breaks`',
  `  MODIFY \`end_reason\` ${NEW_END_REASONS} NULL,`,
  "  ADD COLUMN `source` ENUM('self','away') NOT NULL DEFAULT 'self',",
  '  ADD COLUMN `away_entry_id` BIGINT UNSIGNED NULL,',
  '  ADD COLUMN `changed_by_id` BIGINT UNSIGNED NULL,',
  '  ADD COLUMN `changed_at` DATETIME NULL,',
  `  ADD ${foreignKey('attendance_breaks', 'away_entry_id', 'REFERENCES `time_entries` (`id`)', 'SET NULL')},`,
  `  ADD ${foreignKey('attendance_breaks', 'changed_by_id', USERS)}`,
].join('\n');

const ENTRY_COLUMNS = [
  'id',
  'userId',
  'workDate',
  'projectId',
  'source',
  'startedAt',
  'endedAt',
  'stopReason',
  'awayCheckedUntil',
  'createdAt',
  'updatedAt',
];

async function withRetry(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!RETRY_ERRNOS.has(error?.errno) || attempt >= ATTEMPTS) throw error;
    }
  }
}

async function hasForeignKey(knex, table, name) {
  const [rows] = await knex.raw(
    'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ' +
      "AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
    [table, name],
  );
  return rows.length > 0;
}

/** The company date now: the timezone settings row (JSON), else DEFAULT_TIMEZONE, else Kolkata. */
async function companyDate(knex, at) {
  const row = await knex('settings').where({ key: 'timezone' }).first('value');
  const zones = [];
  try {
    zones.push(row?.value ? JSON.parse(row.value) : null);
  } catch {
    // a hand-edited value: fall through to the next
  }
  zones.push(process.env.DEFAULT_TIMEZONE, 'Asia/Kolkata');
  for (const timeZone of zones.filter(Boolean)) {
    try {
      const parts = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' };
      return new Intl.DateTimeFormat('en-CA', parts).format(at); // 'YYYY-MM-DD'
    } catch {
      // not a time zone Intl knows: try the next
    }
  }
  return at.toISOString().slice(0, 10);
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

/** Part 1, on one pinned connection (the transaction only pins it: each DDL commits on its own). */
async function createSchema(knex) {
  await knex.transaction(async (ddl) => {
    // A blocked ALTER fails with 1205 after 30 s instead of queueing every check-in behind it.
    await ddl.raw('SET SESSION lock_wait_timeout = 30');
    try {
      for (const [name, sql] of Object.entries(TABLES)) {
        await runUnlessThere(ddl, () => ddl.schema.hasTable(name), sql);
      }
      const hasColumn = (table, column) => () => ddl.schema.hasColumn(table, column);
      await runUnlessThere(ddl, hasColumn('attendance', 'checkout_entered_by'), ALTER_ATTENDANCE);
      await runUnlessThere(ddl, hasColumn('attendance_breaks', 'source'), ALTER_BREAKS);
    } finally {
      await ddl.raw('SET SESSION lock_wait_timeout = DEFAULT');
    }
  });
}

/** Part 2, one person-day under its attendance row lock (by primary key, CONTRACT 15). */
async function rebuildDay(trx, { userId, workDate }, at) {
  const found = await trx('attendance').where({ userId, workDate }).first('id');
  const row = found
    ? await trx('attendance')
        .where({ id: found.id })
        .first(['id', 'checkInAt', 'checkOutAt'])
        .forUpdate()
    : null;
  const entries = await trx('timeEntries')
    .where({ userId, workDate })
    .orderBy([{ column: 'startedAt' }, { column: 'id' }])
    .select(ENTRY_COLUMNS);
  const breaks = await trx('attendanceBreaks')
    .where({ userId, workDate })
    .select(['id', 'startedAt', 'endedAt']);
  const { spans, skipped } = removedSpans({ entries, breaks, row });
  for (const span of spans) {
    const [breakId] = await trx('attendanceBreaks').insert({
      userId,
      attendanceId: row.id,
      workDate,
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      endReason: 'away',
      source: 'away',
      pausedEntryId: null,
      awayEntryId: span.awayEntryId,
      createdAt: at,
      updatedAt: at,
    });
    await trx('auditLogs').insert({
      actorId: null,
      action: 'attendance.away_backfill',
      entityType: 'attendance',
      entityId: row.id,
      after: JSON.stringify({ breakId, startedAt: span.startedAt, endedAt: span.endedAt }),
      reason: 'Removed timer time counted as a break (1.10)',
      createdAt: at,
      updatedAt: at,
    });
  }
  return { inserted: spans.length, skipped };
}

/** Part 2. The person-days are picked with plain reads (no locks). */
async function rebuildAwayBreaks(knex, at) {
  const days = await knex('timeEntries')
    .distinct('userId', 'workDate')
    .where('workDate', '>=', BACKFILL_FROM)
    .where({ source: 'timer' })
    .where((query) =>
      query
        .where({ stopReason: 'away' })
        .orWhere((moved) =>
          moved
            .whereNotNull('awayCheckedUntil')
            .whereRaw('`started_at` = `away_checked_until`')
            .whereRaw('`created_at` < `started_at`'),
        ),
    )
    .orderBy([{ column: 'workDate' }, { column: 'userId' }]);
  const totals = { inserted: 0, skipped: 0 };
  for (const day of days) {
    const result = await withRetry(() =>
      knex.transaction((trx) => rebuildDay(trx, day, at), { isolationLevel: 'read committed' }),
    );
    totals.inserted += result.inserted;
    totals.skipped += result.skipped;
  }
  return totals;
}

/** Part 3: today's three late-alerts attempts (the runAttempts keys) read as done. */
async function claimLateAlerts(knex, at) {
  const date = await companyDate(knex, at);
  for (const suffix of ['', '#2', '#3']) {
    try {
      await knex('jobRuns').insert({
        job: 'late-alerts',
        runKey: `late_alerts:${date}${suffix}`,
        status: 'done',
        startedAt: at,
        finishedAt: at,
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      if (error?.errno !== 1062) throw error;
    }
  }
}

export async function up(knex) {
  await createSchema(knex);
  const at = new Date();
  const { inserted, skipped } = await rebuildAwayBreaks(knex, at);
  await claimLateAlerts(knex, at);
  // The lean migrate line on the host prints this; tests stay quiet.
  if (process.env.NODE_ENV !== 'test') {
    console.log(`018: rebuilt ${inserted} away breaks (${skipped} skipped)`);
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('attendance_breaks', 'source')) {
    // Worked time goes back to the 1.09 numbers; HR's break fixes read as ended by the person.
    await knex('attendanceBreaks').where({ source: 'away' }).del();
    await knex('attendanceBreaks').where({ endReason: 'hr' }).update({ endReason: 'self' });
  }
  await knex('auditLogs').where({ action: 'attendance.away_backfill' }).del();
  for (const column of ['away_entry_id', 'changed_by_id']) {
    const name = `attendance_breaks_${column}_foreign`;
    if (await hasForeignKey(knex, 'attendance_breaks', name)) {
      await knex.raw(`ALTER TABLE \`attendance_breaks\` DROP FOREIGN KEY \`${name}\``);
    }
  }
  if (await knex.schema.hasColumn('attendance_breaks', 'source')) {
    // One statement: the columns go and the ENUM shrinks together, so a 1.10 write of 'away' or
    // 'hr' fails with 1054 from here on, never with 1265.
    await knex.raw(
      'ALTER TABLE `attendance_breaks` DROP COLUMN `source`, DROP COLUMN `away_entry_id`, ' +
        'DROP COLUMN `changed_by_id`, DROP COLUMN `changed_at`, ' +
        `MODIFY \`end_reason\` ${OLD_END_REASONS} NULL`,
    );
  }
  if (await hasForeignKey(knex, 'attendance', 'attendance_checkout_entered_by_foreign')) {
    await knex.raw(
      'ALTER TABLE `attendance` DROP FOREIGN KEY `attendance_checkout_entered_by_foreign`',
    );
  }
  if (await knex.schema.hasColumn('attendance', 'checkout_entered_by')) {
    await knex.raw(
      'ALTER TABLE `attendance` DROP COLUMN `checkout_entered_by`, ' +
        'DROP COLUMN `checkout_entered_at`, DROP COLUMN `checkout_suggested_at`, ' +
        'DROP COLUMN `checkout_prompt_hidden_on`',
    );
  }
  for (const name of ['attendance_alerts', 'attendance_reminders', 'leave_entries', 'holidays']) {
    await knex.schema.dropTableIfExists(name);
  }
}
