// Company request after the build guide (CONTRACT 21): My settings.
// - user_preferences: one row per person, created on their first change. `prefs` holds only the
//   keys that differ from the defaults (PREFERENCE_DEFAULTS in src/modules/preferences), so a
//   later default reaches everyone who never changed that key.

function tableDefaults(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

export async function up(knex) {
  await knex.schema.createTable('user_preferences', (t) => {
    tableDefaults(t);
    t.bigInteger('user_id')
      .unsigned()
      .notNullable()
      .primary()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    // No column default: MySQL 8 doesn't allow a literal default on a JSON column. The service
    // always writes it.
    t.json('prefs').notNullable();
    t.datetime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_preferences');
}
