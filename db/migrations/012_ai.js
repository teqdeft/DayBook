// Company request after the build guide (CONTRACT 20): AI features with Gemini.
// - ai_usage: one row per Gemini request, for the daily limits and for Admin to see the use.
// - ai_summaries: the texts the worker writes (a PM's daily project summary, HR's weekly notes);
//   the bell notification links to them.

function tableDefaults(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

export async function up(knex) {
  await knex.schema.createTable('ai_usage', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    // NULL for the worker's own requests (summaries, HR notes).
    t.bigInteger('user_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.string('feature', 40).notNullable(); // polish | pm_summary | hr_notes | ask
    t.string('model', 80).notNullable();
    t.boolean('ok').notNullable();
    t.string('error_code', 60).nullable();
    t.integer('input_tokens').unsigned().nullable();
    t.integer('output_tokens').unsigned().nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.index(['created_at']);
    t.index(['user_id', 'feature', 'created_at']);
  });

  await knex.schema.createTable('ai_summaries', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.enu('kind', ['pm_daily', 'hr_weekly']).notNullable();
    t.bigInteger('recipient_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.date('period_from').notNullable(); // company dates, both included
    t.date('period_to').notNullable();
    t.string('title', 200).notNullable();
    t.text('body').notNullable(); // plain text with simple "- " lists, names already filled in
    t.datetime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.unique(['kind', 'recipient_id', 'period_from']);
    t.index(['recipient_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('ai_summaries');
  await knex.schema.dropTableIfExists('ai_usage');
}
