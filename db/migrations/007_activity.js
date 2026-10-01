// activity_segments: screen time (company request after the build guide; guide Phase 3 topic).
// The installed Daybook app reports whether the person is active, idle or has the screen locked;
// the server turns those reports into continuous segments. Nothing about apps or sites is stored.

export async function up(knex) {
  await knex.schema.createTable('activity_segments', (t) => {
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
    t.bigIncrements('id');
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.date('work_date').notNullable(); // company-time-zone date of started_at
    t.enu('state', ['active', 'idle', 'locked']).notNullable();
    // system: the browser's Idle Detection (whole computer); window: only the Daybook window
    // (fallback when Idle Detection is unavailable or not allowed).
    t.enu('source', ['system', 'window']).notNullable().defaultTo('system');
    t.datetime('started_at').notNullable(); // server time, UTC
    t.datetime('ended_at').notNullable(); // last report received for this segment, UTC
    t.datetime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.datetime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.index(['user_id', 'work_date']);
    t.index(['work_date']);
    t.index(['user_id', 'ended_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('activity_segments');
}
