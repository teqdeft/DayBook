// Deploy before migrate (CONTRACT 27): until the migrate line has run migration 019, its tables
// and columns are missing (errno 1146 or 1054). Every existing screen and job keeps working as
// 1.11: reads answer their "nothing yet" fallback and writes one plain sentence, with one warning
// in the log per area per process. Nothing caches "missing", so everything works once migrated,
// without a restart (the attendance/migration018.js pattern).
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const NO_SUCH_TABLE = 1146;
const NO_SUCH_COLUMN = 1054;

/** The sentence every 1.12 write answers before migration 019 (`UPDATE_NEEDED`, 503). */
export const UPDATE_NEEDED_MESSAGE = 'This needs the latest database update. Ask an Admin.';

const warned = new Set();

/**
 * Logs "the 1.12 update is missing" once per area per process.
 * @param {'files' | 'documents' | string} area
 */
function warnMissing(area) {
  if (warned.has(area)) return;
  warned.add(area);
  logger.warn(`The 1.12 database update is missing (run the migrate line); ${area} is off`);
}

/** True when the error says a table or column of migration 019 doesn't exist yet. */
export function isMissing019(error) {
  return error?.errno === NO_SUCH_TABLE || error?.errno === NO_SUCH_COLUMN;
}

/** The error a 1.12 write throws before migration 019. */
export function updateNeededError() {
  return new AppError('UPDATE_NEEDED', { status: 503, message: UPDATE_NEEDED_MESSAGE });
}

/**
 * Runs a read; before migration 019 it answers `fallback()` instead (one warning per area per
 * process). Other database errors throw. Safe inside a transaction: MySQL and MariaDB roll back
 * only the failed statement, so the caller's transaction goes on.
 * @template T
 * @param {'files' | 'documents'} area
 * @param {() => Promise<T>} read
 * @param {() => T} fallback
 * @returns {Promise<T>}
 */
export async function guard019Read(area, read, fallback) {
  try {
    return await read();
  } catch (error) {
    if (!isMissing019(error)) throw error;
    warnMissing(area);
    return fallback();
  }
}

/**
 * Runs a write; before migration 019 it throws `UPDATE_NEEDED` (503, "This needs the latest
 * database update. Ask an Admin.") instead of a database error. Other errors pass through.
 * @template T
 * @param {'files' | 'documents'} area
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 * @throws UPDATE_NEEDED (503)
 */
export async function guard019Write(area, write) {
  try {
    return await write();
  } catch (error) {
    if (!isMissing019(error)) throw error;
    warnMissing(area);
    throw updateNeededError();
  }
}

/** Tests only: lets the next missing-019 read or write warn again. */
export function resetMigration019WarningsForTests() {
  warned.clear();
}
