// office_networks, attendance, attendance_corrections

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
  await knex.schema.createTable('office_networks', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.string('name', 80).notNullable();
    t.string('ip_address', 45).notNullable().unique(); // the office's public IP
    t.bigInteger('created_by').unsigned().nullable().references('id').inTable('users');
    timestamps(knex, t);
  });

  // One row per person per working day.
  await knex.schema.createTable('attendance', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users');
    t.date('work_date').notNullable(); // company-time-zone date of check-in
    t.datetime('check_in_at').notNullable(); // server time, UTC
    t.datetime('check_out_at').nullable();
    t.enu('location', ['office', 'wfh']).notNullable();
    t.boolean('office_verified').notNullable().defaultTo(true); // 0 for "Office, unverified"
    t.string('check_in_ip', 45).nullable();
    t.string('check_out_ip', 45).nullable();
    t.string('note', 255).nullable(); // optional note for the PM
    t.smallint('late_minutes').unsigned().notNullable().defaultTo(0); // recorded only in Phase 1
    t.boolean('is_working_day').notNullable().defaultTo(true); // 0 for weekend work
    t.enu('checkout_status', ['open', 'checked_out', 'missing', 'corrected'])
      .notNullable()
      .defaultTo('open');
    t.enu('source', ['self', 'hr']).notNullable().defaultTo('self'); // hr when HR created the row
    timestamps(knex, t);
    t.unique(['user_id', 'work_date']);
    t.index(['work_date']);
  });

  await knex.schema.createTable('attendance_corrections', (t) => {
    tableDefaults(t);
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users');
    t.bigInteger('attendance_id').unsigned().nullable().references('id').inTable('attendance');
    t.date('work_date').notNullable();
    t.enu('type', ['check_in', 'check_out', 'missing_day']).notNullable();
    t.datetime('requested_time').notNullable(); // the corrected time; check-in time for a missing day
    // A missing day also needs its check-out time and where the person worked.
    t.datetime('requested_end_time').nullable();
    t.enu('requested_location', ['office', 'wfh']).nullable();
    t.string('reason', 500).notNullable();
    t.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    t.bigInteger('handled_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('handled_at').nullable();
    t.string('handler_note', 300).nullable();
    timestamps(knex, t);
    t.index(['status']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('attendance_corrections');
  await knex.schema.dropTableIfExists('attendance');
  await knex.schema.dropTableIfExists('office_networks');
}
