// Database steps for the end-to-end runs: create the database when it doesn't exist yet (CI),
// migrate it and load the demo data with the project's own scripts. DB_NAME is the database the
// web server uses (playwright.config.js sets it for CI; locally it comes from .env.local).
import { execSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { env } from '../../../src/lib/env.js';

const ROOT = new URL('../../../', import.meta.url);

/** Runs an npm script in the project root with the current environment (including DB_NAME). */
export function runScript(script) {
  execSync(`npm run ${script}`, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

/** CREATE DATABASE IF NOT EXISTS for DB_NAME (a fresh CI database). */
export async function ensureDatabase() {
  const name = env.DB_NAME;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}".`);
  const admin = Boolean(env.DB_MIGRATE_USER);
  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: admin ? env.DB_MIGRATE_USER : env.DB_USER,
    password: admin ? env.DB_MIGRATE_PASSWORD : env.DB_PASSWORD,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
  return name;
}

/** Migrates DB_NAME and loads the demo data (`npm run seed:demo` wipes it first). */
export async function resetDemoData() {
  const name = await ensureDatabase();
  console.log(`\n[e2e] Migrating and seeding demo data into "${name}"`);
  runScript('migrate');
  runScript('seed:demo');
}
