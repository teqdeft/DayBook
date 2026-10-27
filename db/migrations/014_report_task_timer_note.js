// Fix found testing 1.06 (CONTRACT 21, "Timer lines remember their note"): a daily-report task
// line written by "Fill report from timers" keeps the timer note it came from, so a line reworded
// later (Polish with AI, or by hand) still stands for that note and the next fill doesn't add the
// note again. Additive: lines saved before this stay NULL.

export async function up(knex) {
  await knex.schema.alterTable('report_tasks', (t) => {
    // The trimmed time_entries.note (VARCHAR(200)) the line was filled from; never shown.
    t.string('timer_note', 200).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('report_tasks', (t) => {
    t.dropColumn('timer_note');
  });
}
