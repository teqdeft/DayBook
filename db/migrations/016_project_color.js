// Company request after the build guide (CONTRACT 23): projects get a yellow colour label and any
// custom colour. projects.color becomes text holding a preset name or a lowercase '#rrggbb'
// (src/lib/projectColors.js); the values already stored are kept. Going back loses yellow and the
// custom colours: those projects turn blue.

const OLD_COLORS = ['blue', 'green', 'violet', 'orange', 'teal', 'pink'];

export async function up(knex) {
  await knex.raw("ALTER TABLE `projects` MODIFY `color` VARCHAR(7) NOT NULL DEFAULT 'blue'");
}

export async function down(knex) {
  await knex('projects').whereNotIn('color', OLD_COLORS).update({ color: 'blue' });
  await knex.raw(
    "ALTER TABLE `projects` MODIFY `color` ENUM('blue', 'green', 'violet', 'orange', 'teal', 'pink') NOT NULL DEFAULT 'blue'",
  );
}
