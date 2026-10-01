// settings, notifications, audit_logs, slack_outbox, job_runs

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

export async function up(knex) {
  await knex.schema.createTable('settings', (t) => {
    tableDefaults(t);
    t.string('key', 80).primary();
    t.json('value').nullable();
    t.bigInteger('updated_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  // The bell.
  await knex.schema.createTable('notifications', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.string('type', 50).notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 500).nullable();
    t.string('link', 300).nullable();
    t.datetime('read_at').nullable();
    timestamps(knex, t);
    t.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('actor_id').unsigned().nullable().references('id').inTable('users');
    t.string('action', 80).notNullable(); // for example attendance.correct
    t.string('entity_type', 40).notNullable();
    t.bigInteger('entity_id').unsigned().nullable();
    t.json('before').nullable();
    t.json('after').nullable();
    t.string('reason', 500).nullable();
    t.string('ip', 45).nullable();
    timestamps(knex, t);
    t.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('slack_outbox', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('kind', 40).notNullable(); // report_post, report_update, dm
    t.string('channel', 40).nullable(); // channel ID, or a Slack user ID for DMs
    t.json('payload').notNullable();
    t.enu('status', ['pending', 'sent', 'failed']).notNullable().defaultTo('pending');
    t.tinyint('attempts').unsigned().notNullable().defaultTo(0);
    t.datetime('next_attempt_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.string('last_error', 500).nullable();
    t.string('related_type', 40).nullable();
    t.bigInteger('related_id').unsigned().nullable();
    t.string('result_ts', 32).nullable();
    t.datetime('sent_at').nullable();
    timestamps(knex, t);
    t.index(['status', 'next_attempt_at']);
  });

  await knex.schema.createTable('job_runs', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('job', 60).notNullable();
    t.string('run_key', 120).notNullable().unique(); // for example report_reminder:2026-10-01
    t.enu('status', ['running', 'done', 'failed']).notNullable().defaultTo('running');
    t.datetime('started_at').notNullable();
    t.datetime('finished_at').nullable();
    t.string('error', 1000).nullable();
    timestamps(knex, t);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('job_runs');
  await knex.schema.dropTableIfExists('slack_outbox');
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('settings');
}
