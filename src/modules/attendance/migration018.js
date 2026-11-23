// Deploy before migrate (CONTRACT 25): until `npm run migrate` has run migration 018, its tables
// and columns are missing (errno 1146 or 1054). Every existing screen and job keeps working as
// 1.09: reads answer their "nothing yet" fallback and writes one plain sentence, with one warning
// in the log per area per process. Nothing caches "missing", so everything works once migrated,
// without a restart (the projectPlan/migrationGuard.js pattern).
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const NO_SUCH_TABLE = 1146;
const NO_SUCH_COLUMN = 1054;

/** The sentence every 1.10 write answers before migration 018 (`UPDATE_NEEDED`, 503). */
export const UPDATE_NEEDED_MESSAGE = 'This needs the latest database update. Ask an Admin.';

const warned = new Set();

/**
 * Logs "the 1.10 update is missing" once per area per process.
 * @param {'calendar' | 'breaks' | 'checkouts' | 'reminders' | 'alerts' | string} area
 */
function warnMissing(area) {
  if (warned.has(area)) return;
  warned.add(area);
  logger.warn(`The 1.10 database update is missing (run npm run migrate); ${area} is off`);
}

/** True when the error says a table or column of migration 018 doesn't exist yet. */
export function isMissing018(error) {
  return error?.errno === NO_SUCH_TABLE || error?.errno === NO_SUCH_COLUMN;
}

/** The error a 1.10 write throws before migration 018. */
export function updateNeededError() {
  return new AppError('UPDATE_NEEDED', { status: 503, message: UPDATE_NEEDED_MESSAGE });
}

/**
 * Runs a read; before migration 018 it answers `fallback()` instead (one warning per area per
 * process). Other database errors throw.
 * @template T
 * @param {string} area 'calendar', 'breaks', 'checkouts', 'reminders' or 'alerts'
 * @param {() => Promise<T>} read
 * @param {() => T} fallback
 * @returns {Promise<T>}
 */
export async function guard018Read(area, read, fallback) {
  try {
    return await read();
  } catch (error) {
    if (!isMissing018(error)) throw error;
    warnMissing(area);
    return fallback();
  }
}

/**
 * Runs a write; before migration 018 it throws `UPDATE_NEEDED` (503, "This needs the latest
 * database update. Ask an Admin.") instead of a database error. Other errors pass through.
 * @template T
 * @param {string} area see guard018Read()
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 * @throws UPDATE_NEEDED (503)
 */
export async function guard018Write(area, write) {
  try {
    return await write();
  } catch (error) {
    if (!isMissing018(error)) throw error;
    warnMissing(area);
    throw updateNeededError();
  }
}

/**
 * Runs an extra statement inside a transaction; before migration 018 it swallows the error and
 * answers null. MySQL and MariaDB roll back only the failed statement, so the transaction goes
 * on (an HR fix still saves the check-out without the entered-by columns).
 * @template T
 * @param {string} area see guard018Read()
 * @param {() => Promise<T>} write
 * @returns {Promise<T | null>}
 */
export async function try018Write(area, write) {
  try {
    return await write();
  } catch (error) {
    if (!isMissing018(error)) throw error;
    warnMissing(area);
    return null;
  }
}
