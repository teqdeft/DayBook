// A task save that loses a deadlock (errno 1213) runs again (CONTRACT 28, Bulk actions in the
// Table): the Table's bulk save and the single saves of an existing task (edit, done, delete).
// InnoDB rolls the whole transaction back and everything a task save writes is in the database
// (rows, audit lines, notifications), so running it again is safe. Only 1213: a lock wait (1205)
// has already waited innodb_lock_wait_timeout, and three of them would hold the request for minutes.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

const DEADLOCK = 1213;
const ATTEMPTS = 3;

/**
 * Runs the save in a transaction, again after a deadlock (up to 3 tries).
 * @template T
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} run
 * @returns {Promise<T>}
 * @throws CONFLICT (409) "Something else changed at the same moment. Try again." on the last
 *   deadlock
 */
export async function withDeadlockRetry(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(run);
    } catch (error) {
      if (error?.errno !== DEADLOCK) throw error;
      if (attempt >= ATTEMPTS) {
        const message = 'Something else changed at the same moment. Try again.';
        throw new AppError('CONFLICT', { message, cause: error });
      }
    }
  }
}
