// Company request after the build guide (CONTRACT 19): someone still checked in after office hours
// who shows no activity is checked out automatically, and the row says so ('auto'). The same
// request moved the "no timer yet" reminder to 25 minutes: a database still on the old default (20)
// gets the new one; a value Admin chose stays.

export async function up(knex) {
  await knex.raw(
    "ALTER TABLE `attendance` MODIFY `checkout_status` ENUM('open', 'checked_out', 'missing', 'corrected', 'auto') NOT NULL DEFAULT 'open'",
  );
  // CAST: on MySQL 8 the column is JSON, and comparing it with the text '20' never matches.
  await knex('settings')
    .where({ key: 'timer_reminder_minutes' })
    .whereRaw('CAST(`value` AS CHAR) = ?', ['20'])
    .update({ value: '25' });
}

export async function down(knex) {
  await knex('attendance')
    .where({ checkoutStatus: 'auto' })
    .update({ checkoutStatus: 'checked_out' });
  await knex.raw(
    "ALTER TABLE `attendance` MODIFY `checkout_status` ENUM('open', 'checked_out', 'missing', 'corrected') NOT NULL DEFAULT 'open'",
  );
}
