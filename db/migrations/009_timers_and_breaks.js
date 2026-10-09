// Company requests after the build guide (CONTRACT 15):
// 1. Project timers: time_entries holds one row per unbroken stretch of work on one project. A
//    running timer has ended_at NULL; pausing (a break) or switching projects ends the row and a
//    new one starts later. The daily report is filled from these rows.
// 2. Breaks: attendance_breaks holds one row per break inside a check-in. Worked time is present
//    time minus breaks.
// Each table has a generated column that is the user id only while the row is open, with a unique
// index on it, so the database itself allows one running timer and one open break per person.
// MySQL (error 3192) refuses ON DELETE CASCADE / SET NULL on a base column of a stored generated
// column, so user_id keeps the default RESTRICT (people are deactivated, never deleted).

function tableDefaults(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

function timestamps(knex, t) {
  t.datetime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
  t.datetime('updated_at')
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
}

/** A column that holds `user_id` while `ended_at` is NULL (MySQL 8 and MariaDB 10.4 syntax). */
function openUserColumn(knex, t, name) {
  t.specificType(
    name,
    'BIGINT UNSIGNED GENERATED ALWAYS AS (IF(`ended_at` IS NULL, `user_id`, NULL)) STORED',
  );
  t.unique([name]);
}

export async function up(knex) {
  await knex.schema.createTable('time_entries', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users'); // RESTRICT, see the header
    t.date('work_date').notNullable(); // company-time-zone date of started_at
    t.bigInteger('project_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    t.bigInteger('project_task_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('project_tasks')
      .onDelete('SET NULL');
    t.string('note', 200).nullable(); // becomes a task line in the daily report
    t.datetime('started_at').notNullable(); // UTC
    t.datetime('ended_at').nullable(); // NULL while the timer runs
    t.enu('source', ['timer', 'manual']).notNullable().defaultTo('timer');
    t.enu('stop_reason', [
      'stopped',
      'switched',
      'break',
      'checkout',
      'midnight',
      'away',
    ]).nullable();
    // "You were away, keep or remove?" is not asked again about time before this moment.
    t.datetime('away_checked_until').nullable();
    timestamps(knex, t);
    openUserColumn(knex, t, 'running_user_id');
    t.index(['user_id', 'work_date']);
    t.index(['work_date', 'ended_at']);
    t.index(['project_id', 'work_date']);
  });

  await knex.schema.createTable('attendance_breaks', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users'); // RESTRICT, see the header
    t.bigInteger('attendance_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('attendance')
      .onDelete('CASCADE');
    t.date('work_date').notNullable(); // the attendance row's work date
    t.datetime('started_at').notNullable(); // UTC
    t.datetime('ended_at').nullable(); // NULL while the break is on
    // self: End break; checkout: checking out ended it; timer: starting a timer ended it;
    // midnight: the worker closed a break nobody ended.
    t.enu('end_reason', ['self', 'checkout', 'timer', 'midnight']).nullable();
    // The timer this break paused, so End break can start it again.
    t.bigInteger('paused_entry_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('time_entries')
      .onDelete('SET NULL');
    timestamps(knex, t);
    openUserColumn(knex, t, 'open_user_id');
    t.index(['user_id', 'work_date']);
    t.index(['attendance_id']);
    t.index(['work_date', 'ended_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('attendance_breaks');
  await knex.schema.dropTableIfExists('time_entries');
}
