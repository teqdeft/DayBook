// Company requests after the build guide:
// 1. Priority tasks: the project's PM (or Admin) lists a project's important tasks as P1, P2 or P3,
//    optionally for one person. Daily-report task lines can link to them.
// 2. Desktop notifications: every bell notification is also pushed to the person's computers
//    (Web Push). The worker sends them, like the Slack outbox, so pushing never blocks a request.

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
  await knex.schema.createTable('project_tasks', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('project_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    t.string('title', 200).notNullable();
    t.string('details', 1000).nullable();
    t.enu('priority', ['p1', 'p2', 'p3']).notNullable().defaultTo('p2'); // p1 is the highest
    // Null means anyone on the project.
    t.bigInteger('assignee_id').unsigned().nullable().references('id').inTable('users');
    t.enu('status', ['open', 'done']).notNullable().defaultTo('open');
    t.datetime('done_at').nullable();
    t.bigInteger('done_by').unsigned().nullable().references('id').inTable('users');
    t.bigInteger('created_by').unsigned().notNullable().references('id').inTable('users');
    t.bigInteger('updated_by').unsigned().nullable().references('id').inTable('users');
    timestamps(knex, t);
    t.index(['project_id', 'status', 'priority']);
    t.index(['assignee_id', 'status']);
  });

  // A daily-report task line can say which priority task it worked on.
  await knex.schema.alterTable('report_tasks', (t) => {
    t.bigInteger('project_task_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('project_tasks')
      .onDelete('SET NULL');
    t.index(['project_task_id']);
  });

  await knex.schema.createTable('push_subscriptions', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.string('endpoint', 1000).notNullable(); // the browser's push service URL
    t.specificType('endpoint_hash', 'CHAR(64)').notNullable().unique(); // sha256 of endpoint
    t.string('p256dh', 200).notNullable();
    t.string('auth', 100).notNullable();
    t.string('user_agent', 255).nullable();
    t.datetime('last_success_at').nullable();
    t.smallint('failure_count').unsigned().notNullable().defaultTo(0);
    timestamps(knex, t);
    t.index(['user_id']);
  });

  await knex.schema.alterTable('notifications', (t) => {
    t.datetime('pushed_at').nullable(); // when the worker handled the desktop push (sent or skipped)
    t.index(['pushed_at', 'created_at']);
  });
  // Notifications from before this change never pop up.
  await knex('notifications')
    .whereNull('pushed_at')
    .update({ pushed_at: knex.ref('created_at') });
}

export async function down(knex) {
  await knex.schema.alterTable('notifications', (t) => {
    t.dropIndex(['pushed_at', 'created_at']);
    t.dropColumn('pushed_at');
  });
  await knex.schema.dropTableIfExists('push_subscriptions');
  await knex.schema.alterTable('report_tasks', (t) => {
    t.dropForeign(['project_task_id']);
    t.dropIndex(['project_task_id']);
    t.dropColumn('project_task_id');
  });
  await knex.schema.dropTableIfExists('project_tasks');
}
