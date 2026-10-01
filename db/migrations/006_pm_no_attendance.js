// Company decision after the build guide: project managers don't check in, check out or write
// daily reports, so they are never tracked. The users service keeps this true from now on.

export async function up(knex) {
  await knex('users').where({ role: 'pm' }).update({ tracks_attendance: false });
}

export async function down() {
  // Nothing to undo: which PMs were tracked before isn't known any more.
}
