// departments, users, sessions

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
  await knex.schema.createTable('departments', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('name', 80).notNullable().unique();
    timestamps(knex, t);
  });

  await knex.schema.createTable('users', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable().unique(); // lowercase; must match their Slack email
    t.string('slack_user_id', 32).nullable().unique();
    t.string('avatar_url', 500).nullable();
    t.string('designation', 120).notNullable().defaultTo('');
    t.bigInteger('department_id').unsigned().notNullable().references('id').inTable('departments');
    t.enu('role', ['employee', 'pm', 'hr', 'admin']).notNullable().defaultTo('employee');
    t.bigInteger('reports_to_id').unsigned().nullable().references('id').inTable('users');
    t.date('joined_on').nullable();
    t.time('shift_start').nullable(); // null means the company default
    t.time('shift_end').nullable();
    t.boolean('tracks_attendance').notNullable().defaultTo(true); // 0 for the CEO
    t.enu('status', ['active', 'deactivated']).notNullable().defaultTo('active');
    t.datetime('deactivated_at').nullable();
    t.datetime('last_login_at').nullable();
    timestamps(knex, t);
    t.index(['role']);
    t.index(['status']);
    t.index(['department_id']);
    t.index(['reports_to_id']);
  });

  await knex.schema.createTable('sessions', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.specificType('token_hash', 'CHAR(64)').notNullable().unique();
    t.datetime('expires_at').notNullable();
    t.string('ip', 45).nullable();
    t.string('user_agent', 255).nullable();
    t.datetime('last_seen_at').nullable();
    timestamps(knex, t);
    t.index(['expires_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('departments');
}
