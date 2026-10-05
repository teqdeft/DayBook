// `npm run reset -- --confirm=<database name>`: a fresh start for a live database. Empties every
// table (people, attendance, reports, projects, settings, notifications, sign-ins, everything
// except the migration bookkeeping), then runs the base seeds again: departments, the Internal
// client, default settings and the Admin from SEED_ADMIN_EMAIL. It cannot be undone, so it needs
// the database name typed in --confirm. Without it, it only shows what would be emptied.
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { seed as seedDepartments } from '../db/seeds/01_departments.js';
import { seed as seedClients } from '../db/seeds/02_clients.js';
import { seed as seedSettings } from '../db/seeds/03_settings.js';
import { seed as seedAdmin } from '../db/seeds/04_admin.js';

const KEEP_TABLES = new Set(['knex_migrations', 'knex_migrations_lock']);
// The worker cron's lock (src/worker/cron.js): holding it keeps the worker away during the reset.
const WORKER_LOCK = 'daybook_worker_cron';
const WORKER_WAIT_SECONDS = 70;
const PLACEHOLDER_EMAIL = 'ceo@company.com';

function confirmArg() {
  const arg = process.argv.find((value) => value.startsWith('--confirm='));
  return arg ? arg.slice('--confirm='.length).trim() : '';
}

async function tableCounts() {
  const [tables] = await db.raw(
    'SELECT table_name AS name FROM information_schema.tables ' +
      "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const names = tables.map((row) => row.name).filter((name) => !KEEP_TABLES.has(name));
  const counts = [];
  for (const name of names) {
    const [rows] = await db.raw('SELECT COUNT(*) AS count FROM ??', [name]);
    counts.push({ name, count: Number(rows[0].count) });
  }
  return counts;
}

async function main() {
  const adminEmail = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (!adminEmail || adminEmail === PLACEHOLDER_EMAIL) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL in .env.local to the Admin's Slack email first: after the reset that " +
        'is the only person who can sign in.',
    );
  }
  const counts = await tableCounts();
  const total = counts.reduce((sum, table) => sum + table.count, 0);
  console.log(`Database "${env.DB_NAME}": ${counts.length} tables, ${total} rows.`);
  console.log(
    `  ${counts
      .filter((table) => table.count > 0)
      .map((table) => `${table.name} ${table.count}`)
      .join(', ')}`,
  );

  if (confirmArg() !== env.DB_NAME) {
    console.log(
      `\nNothing was changed. To empty all of it and start fresh, run this again with ` +
        `--confirm=${env.DB_NAME}\nAfterwards only ${adminEmail} can sign in.`,
    );
    return;
  }

  // One connection for everything: the worker lock and the foreign key switch belong to it.
  await db.transaction(async (trx) => {
    const [rows] = await trx.raw('SELECT GET_LOCK(?, ?) AS got', [
      WORKER_LOCK,
      WORKER_WAIT_SECONDS,
    ]);
    if (Number(rows[0]?.got) !== 1) {
      throw new Error('The worker is still busy. Nothing was changed; try again in a minute.');
    }
    try {
      await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const { name } of counts) await trx.raw('TRUNCATE TABLE ??', [name]);
      } finally {
        await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
      }
      await seedDepartments(trx);
      await seedClients(trx);
      await seedSettings(trx);
      await seedAdmin(trx);
    } finally {
      await trx.raw('SELECT RELEASE_LOCK(?)', [WORKER_LOCK]);
    }
  });
  const admin = await db('users').where({ email: adminEmail }).first('name', 'email', 'role');
  console.log(
    `\nDone: emptied ${counts.length} tables and ran the base seeds. ` +
      `Admin: ${admin?.name} <${admin?.email}> (${admin?.role}).`,
  );
  console.log(
    'Next: press Restart in Setup Node.js App, sign in, then set the company name, Slack channel ' +
      'and office Wi-Fi in Settings and add your people.',
  );
}

main()
  .catch((error) => {
    console.error(`Reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
