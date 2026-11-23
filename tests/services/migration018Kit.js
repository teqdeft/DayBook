// Shared pieces for tests/services/migration018.test.js (CONTRACT 25, "Data"): what migration 018
// must create, read back from information_schema in a way MySQL 8.4 and MariaDB 10.4 both answer
// alike, and 1.09-shaped timer rows inserted directly, as 1.09's Remove left them.
import { db } from '@/lib/db';
import { localToUtc } from '@/lib/time';

export const MIGRATION = '018_hr_tools.js';
export const TZ = 'Asia/Kolkata';
export const NEW_TABLES = [
  'holidays',
  'leave_entries',
  'attendance_reminders',
  'attendance_alerts',
];

const BIGINT = 'bigint unsigned';
const IDS = { id: [BIGINT, 'NO'] };
const BY = { created_by: [BIGINT, 'YES'], updated_by: [BIGINT, 'YES'] };
const STAMPS = { created_at: ['datetime', 'NO'], updated_at: ['datetime', 'NO'] };
const TEXT = 'utf8mb4_unicode_ci';

/** Every column 018 adds: [COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME?]. */
export const COLUMNS = {
  holidays: {
    ...IDS,
    holiday_date: ['date', 'NO'],
    name: ['varchar(80)', 'NO', TEXT],
    ...BY,
    ...STAMPS,
  },
  leave_entries: {
    ...IDS,
    user_id: [BIGINT, 'NO'],
    from_date: ['date', 'NO'],
    to_date: ['date', 'NO'],
    part: ["enum('full','first_half','second_half')", 'NO', TEXT],
    paid: ['tinyint(1)', 'NO'],
    leave_type: ["enum('casual','sick','other')", 'NO', TEXT],
    note: ['varchar(300)', 'YES', TEXT],
    ...BY,
    ...STAMPS,
  },
  attendance_reminders: {
    ...IDS,
    user_id: [BIGINT, 'NO'],
    kind: ["enum('check_in','break','check_out','missing_checkout')", 'NO', TEXT],
    work_date: ['date', 'NO'],
    sent_by: [BIGINT, 'YES'],
    sent_at: ['datetime', 'NO'],
    auto_key: ['varchar(40)', 'YES', TEXT],
    ...STAMPS,
  },
  attendance_alerts: {
    ...IDS,
    user_id: [BIGINT, 'NO'],
    kind: ['varchar(30)', 'NO', TEXT],
    period_key: ['varchar(10)', 'NO', TEXT],
    days: ['smallint unsigned', 'NO'],
    created_at: ['datetime', 'NO'],
  },
  attendance: {
    checkout_entered_by: [BIGINT, 'YES'],
    checkout_entered_at: ['datetime', 'YES'],
    checkout_suggested_at: ['datetime', 'YES'],
    checkout_prompt_hidden_on: ['date', 'YES'],
  },
  attendance_breaks: {
    end_reason: ["enum('self','checkout','timer','midnight','away','hr')", 'YES', TEXT],
    source: ["enum('self','away')", 'NO', TEXT],
    away_entry_id: [BIGINT, 'YES'],
    changed_by_id: [BIGINT, 'YES'],
    changed_at: ['datetime', 'YES'],
  },
};

/** Unique keys and plain keys 018 creates, by name: [unique, columns]. */
export const INDEXES = {
  holidays: { holidays_holiday_date_unique: [true, ['holiday_date']] },
  leave_entries: {
    leave_entries_user_id_from_date_index: [false, ['user_id', 'from_date']],
    leave_entries_from_date_to_date_index: [false, ['from_date', 'to_date']],
  },
  attendance_reminders: {
    attendance_reminders_user_id_auto_key_unique: [true, ['user_id', 'auto_key']],
    attendance_reminders_user_id_kind_sent_at_index: [false, ['user_id', 'kind', 'sent_at']],
    attendance_reminders_work_date_index: [false, ['work_date']],
  },
  attendance_alerts: {
    attendance_alerts_user_id_kind_period_key_unique: [true, ['user_id', 'kind', 'period_key']],
  },
};

/** Foreign keys 018 creates, by name: [column, referenced table, ON DELETE]. */
export const FOREIGN_KEYS = {
  holidays: {
    holidays_created_by_foreign: ['created_by', 'users', 'RESTRICT'],
    holidays_updated_by_foreign: ['updated_by', 'users', 'RESTRICT'],
  },
  leave_entries: {
    leave_entries_user_id_foreign: ['user_id', 'users', 'CASCADE'],
    leave_entries_created_by_foreign: ['created_by', 'users', 'RESTRICT'],
    leave_entries_updated_by_foreign: ['updated_by', 'users', 'RESTRICT'],
  },
  attendance_reminders: {
    attendance_reminders_user_id_foreign: ['user_id', 'users', 'CASCADE'],
    attendance_reminders_sent_by_foreign: ['sent_by', 'users', 'SET NULL'],
  },
  attendance_alerts: { attendance_alerts_user_id_foreign: ['user_id', 'users', 'RESTRICT'] },
  attendance: {
    attendance_checkout_entered_by_foreign: ['checkout_entered_by', 'users', 'SET NULL'],
  },
  attendance_breaks: {
    attendance_breaks_away_entry_id_foreign: ['away_entry_id', 'time_entries', 'SET NULL'],
    attendance_breaks_changed_by_id_foreign: ['changed_by_id', 'users', 'RESTRICT'],
  },
};

/** MariaDB writes display widths ("bigint(20) unsigned"), MySQL 8.4 doesn't; tinyint(1) stays. */
const plainType = (type) =>
  type.toLowerCase().replace(/\b(bigint|int|smallint|mediumint)\(\d+\)/g, '$1');

const rowsOf = async (sql, bindings) => (await db.raw(sql, bindings))[0];

/** { table: { collation, engine } } of the given tables that exist. */
export async function tablesOf(names) {
  const rows = await rowsOf(
    'SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation, ENGINE AS engine ' +
      'FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [names],
  );
  return Object.fromEntries(
    rows.map(({ name, collation, engine }) => [name, { collation, engine }]),
  );
}

/** The table's columns that `COLUMNS[table]` names, in the same [type, nullable, collation] form. */
export async function columnsOf(table) {
  const rows = await rowsOf(
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, ' +
      'COLLATION_NAME AS collation FROM information_schema.COLUMNS ' +
      'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  const wanted = Object.keys(COLUMNS[table]);
  return Object.fromEntries(
    rows
      .filter((row) => wanted.includes(row.name))
      .map((row) => [
        row.name,
        [plainType(row.type), row.nullable, ...(row.collation ? [row.collation] : [])],
      ]),
  );
}

/** COLUMNS[table] as columnsOf() reads it. */
export const expectedColumns = (table) => COLUMNS[table];

/** { indexName: [unique, columns] } of the table (every index, PRIMARY left out). */
export async function indexesOf(table) {
  const rows = await rowsOf(
    'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS col, SEQ_IN_INDEX AS seq ' +
      'FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ' +
      "AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    [table],
  );
  const out = {};
  for (const row of rows) {
    out[row.name] ??= [Number(row.nonUnique) === 0, []];
    out[row.name][1].push(row.col);
  }
  return out;
}

/** { constraintName: type } from TABLE_CONSTRAINTS ('UNIQUE', 'FOREIGN KEY', 'PRIMARY KEY'). */
export async function constraintsOf(table) {
  const rows = await rowsOf(
    'SELECT CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS type FROM information_schema.TABLE_CONSTRAINTS ' +
      'WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return Object.fromEntries(rows.map(({ name, type }) => [name, type]));
}

/**
 * { fkName: [column, referenced table, ON DELETE] }; NO ACTION reads as RESTRICT (MySQL 8.4 names
 * an unspecified rule so, MariaDB RESTRICT). Two plain reads: a join of the two information_schema
 * views scans every database on MariaDB 10.4 (20 s with the test databases there).
 */
export async function foreignKeysOf(table) {
  const columns = await rowsOf(
    'SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS target ' +
      'FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() ' +
      'AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
    [table],
  );
  const rules = await rowsOf(
    'SELECT CONSTRAINT_NAME AS name, DELETE_RULE AS rule ' +
      'FROM information_schema.REFERENTIAL_CONSTRAINTS ' +
      'WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  const ruleOf = new Map(rules.map(({ name, rule }) => [name, rule]));
  return Object.fromEntries(
    columns.map(({ name, col, target }) => {
      const rule = ruleOf.get(name);
      return [name, [col, target, rule === 'NO ACTION' ? 'RESTRICT' : rule]];
    }),
  );
}

/** A local clock ('13:45' or '13:45:30') on a date as a UTC Date, whole seconds. */
export function at(date, clock) {
  const [h, m, s = '0'] = clock.split(':');
  return localToUtc(date, `${h}:${m}`, TZ).add(Number(s), 'second').toDate();
}

/** An attendance row; `out` null leaves it open. Returns its id. */
export async function insertRow(user, date, { in: inAt = '09:30', out = null, ...rest } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(date, inAt),
    checkOutAt: out ? at(date, out) : null,
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: out ? 'checked_out' : 'open',
    ...rest,
  });
  return id;
}

/**
 * A time_entries row as 1.09 left it. `created`/`updated` default to the start and the end (or
 * the start while it runs); `checked` is away_checked_until.
 */
export async function insertEntry(user, project, date, options) {
  const { from, to = null, created, updated, checked = null, ...rest } = options;
  const [id] = await db('timeEntries').insert({
    userId: user.id,
    workDate: date,
    projectId: project.id,
    startedAt: at(date, from),
    endedAt: to ? at(date, to) : null,
    source: 'timer',
    stopReason: to ? 'stopped' : null,
    awayCheckedUntil: checked ? at(date, checked) : null,
    createdAt: at(date, created ?? from),
    updatedAt: at(date, updated ?? to ?? from),
    ...rest,
  });
  return id;
}

/**
 * 1.09's split Remove: the head ends at `gap[0]` (stop reason away) and its copy starts at
 * `gap[1]`; the head's updated_at and the copy's created_at are the Remove's moment `removedAt`.
 * Returns { head, tail } ids.
 */
export async function split109(user, project, date, { from, gap, to = null, removedAt }) {
  const head = await insertEntry(user, project, date, {
    from,
    to: gap[0],
    stopReason: 'away',
    checked: gap[0],
    updated: removedAt,
  });
  const tail = await insertEntry(user, project, date, {
    from: gap[1],
    to,
    checked: gap[1],
    created: removedAt,
    updated: to ?? removedAt,
  });
  return { head, tail };
}

/** 1.09's moved start: a timer created at `created`, started on at `from` by a Remove. */
export function moved109(user, project, date, { created, from, to = null, removedAt }) {
  return insertEntry(user, project, date, {
    from,
    to,
    checked: from,
    created,
    updated: to ?? removedAt,
  });
}

/** One self break (End break) of an attendance row. Returns its id. */
export async function insertBreak(user, rowId, date, from, to) {
  const [id] = await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId: rowId,
    workDate: date,
    startedAt: at(date, from),
    endedAt: at(date, to),
    endReason: 'self',
  });
  return id;
}

/** Every column of the three report tables, as stored: 018 must never touch them. */
export async function reportTables() {
  return {
    reports: await db('dailyReports').orderBy('id'),
    entries: await db('reportEntries').orderBy('id'),
    tasks: await db('reportTasks').orderBy('id'),
  };
}

/** The away breaks, oldest first, as [userId, workDate, from, to, awayEntryId] in ISO. */
export async function awayBreaks() {
  const rows = await db('attendanceBreaks')
    .where({ source: 'away' })
    .orderBy([{ column: 'workDate' }, { column: 'userId' }, { column: 'startedAt' }]);
  return rows.map((row) => ({
    userId: Number(row.userId),
    workDate: row.workDate,
    from: row.startedAt.toISOString(),
    to: row.endedAt.toISOString(),
    awayEntryId: row.awayEntryId === null ? null : Number(row.awayEntryId),
    attendanceId: Number(row.attendanceId),
    endReason: row.endReason,
  }));
}

/**
 * Runs a migration step with its stdout line on, as the lean migrate line on the host shows it
 * (018 stays quiet under NODE_ENV=test). Returns the lines it printed.
 */
export async function withMigrationLog(step) {
  const lines = [];
  const before = process.env.NODE_ENV;
  const log = console.log;
  process.env.NODE_ENV = 'production';
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await step();
  } finally {
    console.log = log;
    process.env.NODE_ENV = before;
  }
  return lines;
}

/** Today's company date by the real clock, as 018 claims the late-alert run (Data step 8). */
export function realCompanyDate(timeZone = TZ) {
  const parts = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('en-CA', parts).format(new Date());
}
