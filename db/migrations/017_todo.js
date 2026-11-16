// Company request after the build guide (CONTRACT 24, Daybook 1.09): today's to-do and the
// unfinished-task suggestions. A to-do line is an ordinary report_tasks line of today's draft, so
// no new table. Additive:
// - daily_reports remembers the to-do message posted to Slack (the to-do channel, never the
//   report channel). These columns are never part of REPORT_COLUMNS; reports/repo reads them
//   on their own (findTodoPost).
// - report_tasks records that the person closed an open line from the suggestions ("Done
//   already" or "Not needed") without bringing it into today. The old report itself is unchanged.

export async function up(knex) {
  await knex.schema.alterTable('daily_reports', (t) => {
    t.dateTime('todo_posted_at').nullable();
    t.string('todo_slack_channel_id', 32).nullable(); // lets "Update post" edit the same message
    t.string('todo_slack_ts', 32).nullable();
    // sha256 (hex) of the plan last sent: project ids and line titles, no statuses
    t.specificType('todo_post_hash', 'CHAR(64)').nullable();
  });
  await knex.schema.alterTable('report_tasks', (t) => {
    t.dateTime('carry_closed_at').nullable();
    t.enu('carry_closed_reason', ['done', 'dropped']).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('report_tasks', (t) => {
    t.dropColumn('carry_closed_reason');
    t.dropColumn('carry_closed_at');
  });
  await knex.schema.alterTable('daily_reports', (t) => {
    t.dropColumn('todo_post_hash');
    t.dropColumn('todo_slack_ts');
    t.dropColumn('todo_slack_channel_id');
    t.dropColumn('todo_posted_at');
  });
}
