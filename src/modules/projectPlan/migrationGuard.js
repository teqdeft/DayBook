// Deploy before migrate (CONTRACT 22): until `npm run migrate` has run migration 015, its tables and
// columns are missing. Reads answer "nothing planned yet" and writes a clear error, with one warning
// in the log per process. As soon as the migration has run everything works, without a restart.
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const NO_SUCH_TABLE = 1146;
const NO_SUCH_COLUMN = 1054;

let warned = false;

function warnPlanMissing() {
  if (warned) return;
  warned = true;
  logger.warn(
    'The project plan tables or columns are missing (run npm run migrate); projects show as Not set',
  );
}

/** True when the error says a table or column of migration 015 doesn't exist yet. */
export function isPlanMissing(error) {
  return error?.errno === NO_SUCH_TABLE || error?.errno === NO_SUCH_COLUMN;
}

/**
 * Runs a read; before migration 015 it answers `fallback` instead (with one warning per process).
 * Other database errors throw.
 * @template T
 * @param {() => Promise<T>} read
 * @param {() => T} fallback
 * @returns {Promise<T>}
 */
export async function guardPlanRead(read, fallback) {
  try {
    return await read();
  } catch (error) {
    if (!isPlanMissing(error)) throw error;
    warnPlanMissing();
    return fallback();
  }
}

/**
 * Runs a write; before migration 015 it throws a clear error instead of a database one. Other
 * errors pass through.
 * @template T
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 * @throws PLAN_UNAVAILABLE (503)
 */
export async function guardPlanWrite(write) {
  try {
    return await write();
  } catch (error) {
    if (!isPlanMissing(error)) throw error;
    warnPlanMissing();
    throw new AppError('PLAN_UNAVAILABLE', {
      status: 503,
      message: "Phases and deadlines can't be saved yet. Please try again later.",
    });
  }
}
