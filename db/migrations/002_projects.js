// clients, projects, project_members, project_requests

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
  await knex.schema.createTable('clients', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('name', 160).notNullable().unique();
    t.boolean('is_internal').notNullable().defaultTo(false);
    timestamps(knex, t);
  });

  await knex.schema.createTable('projects', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('name', 120).notNullable().unique();
    t.bigInteger('client_id').unsigned().notNullable().references('id').inTable('clients');
    t.bigInteger('pm_id').unsigned().notNullable().references('id').inTable('users');
    t.enu('status', ['active', 'on_hold', 'completed']).notNullable().defaultTo('active');
    t.enu('color', ['blue', 'green', 'violet', 'orange', 'teal', 'pink'])
      .notNullable()
      .defaultTo('blue');
    t.boolean('is_urgent').notNullable().defaultTo(false);
    t.string('urgent_note', 200).nullable();
    t.datetime('urgent_marked_at').nullable();
    t.bigInteger('urgent_marked_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('completed_at').nullable();
    t.bigInteger('created_by').unsigned().notNullable().references('id').inTable('users');
    timestamps(knex, t);
    t.index(['status']);
    t.index(['pm_id']);
    t.index(['is_urgent']);
  });

  await knex.schema.createTable('project_members', (t) => {
    tableDefaults(t);
    t.bigInteger('project_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.bigInteger('added_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('added_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.primary(['project_id', 'user_id']);
    t.index(['user_id']);
  });

  await knex.schema.createTable('project_requests', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('requested_by').unsigned().notNullable().references('id').inTable('users');
    t.string('name', 120).notNullable();
    t.string('note', 500).notNullable().defaultTo('');
    t.enu('status', ['pending', 'approved', 'declined']).notNullable().defaultTo('pending');
    t.bigInteger('handled_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('handled_at').nullable();
    t.string('decline_reason', 300).nullable();
    t.bigInteger('project_id').unsigned().nullable().references('id').inTable('projects'); // the project it became
    timestamps(knex, t);
    t.index(['status']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('project_requests');
  await knex.schema.dropTableIfExists('project_members');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('clients');
}
