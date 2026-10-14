// Company request after the build guide (CONTRACT 17): working from home needs HR's approval.
// A person asks for one day or a short range of days; HR (or an Admin) approves or declines. On an
// approved day the person can check in as WFH.

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
  await knex.schema.createTable('wfh_requests', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.date('from_date').notNullable(); // company dates, both included
    t.date('to_date').notNullable();
    t.string('reason', 500).notNullable();
    t.enu('status', ['pending', 'approved', 'declined', 'cancelled'])
      .notNullable()
      .defaultTo('pending');
    t.bigInteger('handled_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('handled_at').nullable();
    t.string('decline_reason', 300).nullable();
    timestamps(knex, t);
    t.index(['user_id', 'from_date']);
    t.index(['status', 'from_date']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('wfh_requests');
}
