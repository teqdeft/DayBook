// The transaction of every write that inserts or links report lines (a report save or submit, a
// to-do write, closing a suggestion; CONTRACT 24). It runs at READ COMMITTED: a locking read then
// locks only the rows it finds, never the gaps between them, and a plain read sees the latest
// commit. Under REPEATABLE READ two people carrying a task at the same moment deadlocked: each
// save's read of the lines carried from its source share-locked the gap at the top of the
// carried_from_task_id index, and each then inserted its carried line into that gap. Claims on one
// source still wait for each other, because carry.js locks the source line itself first.
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const DEADLOCK = 1213;
/** MySQL with binlog_format STATEMENT refuses InnoDB writes at READ COMMITTED. */
const NEEDS_ROW_BINLOG = 1665;
let readCommitted = true;

/**
 * Runs a write, and once more when the database picked it as a deadlock victim (the whole
 * transaction was rolled back, so running it again is safe).
 * @template T
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
export async function retryOnDeadlock(write) {
  try {
    return await write();
  } catch (error) {
    if (error?.errno !== DEADLOCK) throw error;
    return write();
  }
}

/**
 * db.transaction at READ COMMITTED. A server whose binary log is written as statements can't log
 * such writes (errno 1665): then this write, and every later one, runs at the server's default
 * level instead (one warning in the log), as before 1.09.
 * @template T
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} handler
 * @returns {Promise<T>}
 */
export async function lineTransaction(handler) {
  if (readCommitted) {
    try {
      return await db.transaction(handler, { isolationLevel: 'read committed' });
    } catch (error) {
      if (error?.errno !== NEEDS_ROW_BINLOG) throw error;
      readCommitted = false;
      logger.warn(
        'report writes run at the default isolation level: the binary log is written as statements',
      );
    }
  }
  return db.transaction(handler);
}

/** Tests only: whether lineTransaction still asks for READ COMMITTED (true restores it). */
export function setReadCommittedForTests(value) {
  readCommitted = value;
}
