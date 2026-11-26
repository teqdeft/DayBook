// Deploy before migrate (CONTRACT 28): until the migrate line has run migration 020, the
// task_file_links table is missing (errno 1146). Every existing screen keeps working as 1.12:
// reads answer "no links" (counts, chips and file lists are 1.12's) and link writes answer one
// plain sentence (`UPDATE_NEEDED`, 503), with one warning in the log per area per process. Nothing
// caches "missing", so links work once migrated, without a restart (the migration019.js pattern).
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { updateNeededError } from './migration019';

const NO_SUCH_TABLE = 1146;

const warned = new Set();

/**
 * Logs "the 1.13 update is missing" once per area per process.
 * @param {'links' | string} area
 */
function warnMissing(area) {
  if (warned.has(area)) return;
  warned.add(area);
  logger.warn(`The 1.13 database update is missing (run the migrate line); ${area} is off`);
}

/** True when the error says migration 020's table doesn't exist yet. */
export function isMissing020(error) {
  return error?.errno === NO_SUCH_TABLE;
}

/**
 * Runs a read; before migration 020 it answers `fallback()` instead (one warning per area per
 * process). Other database errors throw. Safe inside a transaction: MySQL and MariaDB roll back
 * only the failed statement, so the caller's transaction goes on.
 * @template T
 * @param {'links'} area
 * @param {() => Promise<T>} read
 * @param {() => T} fallback
 * @returns {Promise<T>}
 */
export async function guard020Read(area, read, fallback) {
  try {
    return await read();
  } catch (error) {
    if (!isMissing020(error)) throw error;
    warnMissing(area);
    return fallback();
  }
}

/**
 * Runs a write; before migration 020 it throws `UPDATE_NEEDED` (503, "This needs the latest
 * database update. Ask an Admin.") instead of a database error. Other errors pass through.
 * @template T
 * @param {'links'} area
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 * @throws UPDATE_NEEDED (503)
 */
export async function guard020Write(area, write) {
  try {
    return await write();
  } catch (error) {
    if (!isMissing020(error)) throw error;
    warnMissing(area);
    throw updateNeededError();
  }
}

/**
 * True once migration 020 has run (the picker's `linksReady`). Asked on every call, never cached.
 * @returns {Promise<boolean>}
 */
export async function linksReady() {
  return guard020Read(
    'links',
    async () => {
      await db.raw('SELECT 1 FROM `task_file_links` LIMIT 0');
      return true;
    },
    () => false,
  );
}

/** Tests only: lets the next missing-020 read or write warn again. */
export function resetMigration020WarningsForTests() {
  warned.clear();
}
