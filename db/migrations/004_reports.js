// daily_reports, report_entries, report_tasks, report_edit_requests, report_revisions

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
  // One per person per day.
  await knex.schema.createTable('daily_reports', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users');
    t.date('work_date').notNullable();
    t.enu('status', ['draft', 'submitted']).notNullable().defaultTo('draft'); // drafts autosave
    t.smallint('total_minutes').unsigned().notNullable().defaultTo(0); // sum of entries, kept in sync
    t.datetime('first_submitted_at').nullable();
    t.datetime('submitted_at').nullable(); // latest submit
    t.datetime('locks_at').notNullable(); // set on create from the lock rule
    t.datetime('unlocked_until').nullable(); // set when a PM approves an edit
    t.integer('revision').notNullable().defaultTo(0); // goes up on every submit
    t.string('slack_channel_id', 32).nullable(); // lets later edits update the same Slack message
    t.string('slack_ts', 32).nullable();
    timestamps(knex, t);
    t.unique(['user_id', 'work_date']);
    t.index(['work_date', 'status']);
  });

  // One per project in a report.
  await knex.schema.createTable('report_entries', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('report_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('daily_reports')
      .onDelete('CASCADE');
    t.bigInteger('project_id').unsigned().nullable().references('id').inTable('projects');
    t.bigInteger('project_request_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('project_requests');
    t.smallint('minutes').unsigned().notNullable().defaultTo(0);
    t.smallint('sort_order').unsigned().notNullable().defaultTo(0);
    timestamps(knex, t);
    t.index(['project_id']);
  });
  // Exactly one of the two project columns is set.
  await knex.raw(
    'ALTER TABLE report_entries ADD CONSTRAINT report_entries_one_project ' +
      'CHECK ((project_id IS NULL) <> (project_request_id IS NULL))',
  );

  await knex.schema.createTable('report_tasks', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('entry_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('report_entries')
      .onDelete('CASCADE');
    t.string('title', 500).notNullable();
    t.enu('status', ['done', 'in_progress', 'blocked']).notNullable();
    t.date('first_reported_on').notNullable(); // carried from the original task, for stuck-task flags
    t.bigInteger('carried_from_task_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('report_tasks')
      .onDelete('SET NULL');
    t.smallint('sort_order').unsigned().notNullable().defaultTo(0);
    timestamps(knex, t);
    t.index(['status', 'first_reported_on']);
  });

  await knex.schema.createTable('report_edit_requests', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    // Null for a forgotten day: the report is created when the request is approved.
    t.bigInteger('report_id').unsigned().nullable().references('id').inTable('daily_reports');
    t.date('work_date').notNullable();
    t.bigInteger('requested_by').unsigned().notNullable().references('id').inTable('users');
    t.string('reason', 500).notNullable();
    t.enu('status', ['pending', 'approved', 'declined']).notNullable().defaultTo('pending');
    t.bigInteger('handled_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('handled_at').nullable();
    t.string('decline_reason', 300).nullable();
    timestamps(knex, t);
    t.index(['status']);
  });

  await knex.schema.createTable('report_revisions', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('report_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('daily_reports')
      .onDelete('CASCADE');
    t.integer('revision').notNullable();
    t.json('snapshot').notNullable(); // entries, tasks, total
    t.bigInteger('edited_by').unsigned().notNullable().references('id').inTable('users');
    t.string('reason', 500).nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.unique(['report_id', 'revision']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('report_revisions');
  await knex.schema.dropTableIfExists('report_edit_requests');
  await knex.schema.dropTableIfExists('report_tasks');
  await knex.schema.dropTableIfExists('report_entries');
  await knex.schema.dropTableIfExists('daily_reports');
}
