// Company request after the build guide (CONTRACT 22): project management.
// - project_plans: a project's current phase and deadline. No row = Not set and no deadline.
// - project_phase_plans: the planned and actual dates of one phase. No row = no dates.
// - project_tasks gets an optional phase and due date. Existing tasks stay NULL.
// - project_documents: the text of a project's files and notes. The text is stored, the file never.
// - project_summaries: the AI summary written from those documents.
// A deploy that runs before this migration keeps working (src/modules/projectPlan/migrationGuard.js).

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

function projectColumn(t) {
  return t
    .bigInteger('project_id')
    .unsigned()
    .notNullable()
    .references('id')
    .inTable('projects')
    .onDelete('CASCADE');
}

function updatedBy(t) {
  t.bigInteger('updated_by').unsigned().nullable().references('id').inTable('users');
}

function createdBy(t) {
  t.bigInteger('created_by').unsigned().notNullable().references('id').inTable('users');
}

export async function up(knex) {
  await knex.schema.createTable('project_plans', (t) => {
    tableDefaults(t);
    projectColumn(t).primary();
    t.string('current_phase', 24).nullable(); // src/modules/projectPlan/phases.js; NULL = Not set
    t.date('deadline').nullable();
    updatedBy(t);
    timestamps(knex, t);
  });

  await knex.schema.createTable('project_phase_plans', (t) => {
    tableDefaults(t);
    projectColumn(t);
    t.string('phase', 24).notNullable();
    t.date('planned_start').nullable();
    t.date('planned_end').nullable();
    t.date('actual_start').nullable(); // company dates, written by a phase move
    t.date('actual_end').nullable();
    updatedBy(t);
    timestamps(knex, t);
    t.primary(['project_id', 'phase']);
  });

  await knex.schema.alterTable('project_tasks', (t) => {
    t.string('phase', 24).nullable();
    t.date('due_date').nullable();
    t.index(['project_id', 'status', 'done_at']); // the "tasks done per week" counts
  });

  await knex.schema.createTable('project_documents', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    projectColumn(t);
    t.string('phase', 24).notNullable();
    t.enu('kind', ['file', 'note']).notNullable();
    t.string('title', 200).notNullable();
    t.text('body', 'mediumtext').notNullable(); // a file's pages are separated by \f
    t.integer('pages').nullable();
    t.integer('pages_total').nullable();
    t.integer('char_count').notNullable();
    createdBy(t);
    updatedBy(t);
    timestamps(knex, t);
    t.index(['project_id', 'phase']);
  });

  await knex.schema.createTable('project_summaries', (t) => {
    tableDefaults(t);
    projectColumn(t).primary();
    // No column default: MySQL 8 doesn't allow a literal default on a JSON column. The service
    // always writes it.
    t.json('body').notNullable();
    t.specificType('source_key', 'CHAR(64)').notNullable(); // sha256 of the documents it read
    t.boolean('truncated').notNullable().defaultTo(false);
    t.integer('dropped_count').notNullable().defaultTo(0);
    t.string('model', 60).nullable();
    createdBy(t);
    updatedBy(t);
    timestamps(knex, t);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('project_summaries');
  await knex.schema.dropTableIfExists('project_documents');
  await knex.schema.alterTable('project_tasks', (t) => {
    t.dropIndex(['project_id', 'status', 'done_at']);
    t.dropColumn('due_date');
    t.dropColumn('phase');
  });
  await knex.schema.dropTableIfExists('project_phase_plans');
  await knex.schema.dropTableIfExists('project_plans');
}
