// Every Knex query of the timers module. Project and priority task names are read with joins;
// other modules' data is changed only through their services. Never write running_user_id: it is
// generated from ended_at (migration 009).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

export const ANOTHER_TIMER_MESSAGE = 'Another timer just started. Refresh to see it.';

const DUPLICATE = 1062; // a second running timer (the unique running_user_id)
const DEADLOCK = 1213;
const ATTEMPTS = 3;

const BARE_COLUMNS = [
  'id',
  'userId',
  'workDate',
  'projectId',
  'projectTaskId',
  'note',
  'startedAt',
  'endedAt',
  'source',
  'stopReason',
  'awayCheckedUntil',
];

const ENTRY_COLUMNS = [
  ...BARE_COLUMNS.map((column) => `te.${column}`),
  'p.name as projectName',
  'p.color as projectColor',
  'p.isUrgent',
  'pt.priority',
  'pt.title as projectTaskTitle',
  'pt.status as projectTaskStatus',
];

const OLDEST_FIRST = [
  { column: 'te.startedAt', order: 'asc' },
  { column: 'te.id', order: 'asc' },
];

function entryQuery(trx) {
  return trx('timeEntries as te')
    .leftJoin('projects as p', 'p.id', 'te.projectId')
    .leftJoin('projectTasks as pt', 'pt.id', 'te.projectTaskId')
    .select(ENTRY_COLUMNS);
}

/**
 * Runs `run(trx)` in a READ COMMITTED transaction, again (up to 3 times) after a deadlock. One
 * person's timer writes wait for each other on their attendance row (attendance.lockDay);
 * READ COMMITTED takes no gap locks, so looking for a running timer that doesn't exist never makes
 * different people wait for, or deadlock with, each other.
 * @template T
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} run
 * @returns {Promise<T>}
 * @throws CONFLICT when it still deadlocks on the last try
 */
export async function transaction(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(run, { isolationLevel: 'read committed' });
    } catch (error) {
      if (error?.errno !== DEADLOCK) throw error;
      if (attempt >= ATTEMPTS) {
        const message = 'Something else changed at the same moment. Try again.';
        throw new AppError('CONFLICT', { message, cause: error });
      }
    }
  }
}

// ---------- reads (with project and task names) ----------

export function findById(id, trx = db) {
  return entryQuery(trx).where('te.id', id).first();
}

/** The person's running entry, whatever its work date. */
export function findRunning(userId, trx = db) {
  return entryQuery(trx).where('te.userId', userId).whereNull('te.endedAt').first();
}

/** One person's entries of one work date, oldest first. */
export function listForUserDate(userId, workDate, trx = db) {
  return entryQuery(trx)
    .where('te.userId', userId)
    .where('te.workDate', workDate)
    .orderBy(OLDEST_FIRST);
}

/** Entries still running from a work date before `date` (the midnight job). */
export function listRunningBefore(date, trx = db) {
  return entryQuery(trx).whereNull('te.endedAt').where('te.workDate', '<', date).orderBy('te.id');
}

/** Which of these people have a running timer (any date). */
export async function listRunningUserIds(userIds, trx = db) {
  if (userIds.length === 0) return [];
  const rows = await trx('timeEntries')
    .whereIn('userId', userIds)
    .whereNull('endedAt')
    .select('userId');
  return rows.map((row) => Number(row.userId));
}

/** Everyone with a running timer (any date), lowest user id first. Reads the unique index. */
export async function listAllRunningUserIds(trx = db) {
  const rows = await trx('timeEntries')
    .whereNotNull('runningUserId')
    .orderBy('runningUserId')
    .select('runningUserId');
  return rows.map((row) => Number(row.runningUserId));
}

/** [{ userId, lastEndedAt }]: when each person's last finished entry of the day ended. */
export function lastEndedByUser(workDate, userIds, trx = db) {
  if (userIds.length === 0) return Promise.resolve([]);
  return trx('timeEntries')
    .where({ workDate })
    .whereIn('userId', userIds)
    .whereNotNull('endedAt')
    .groupBy('userId')
    .select('userId')
    .max({ lastEndedAt: 'endedAt' });
}

// ---------- locks (bare rows, inside the caller's transaction) ----------

/**
 * The person's running entry (any work date), locked for the rest of the transaction. It reads the
 * unique running_user_id, so it locks that one row; use it inside `transaction`.
 */
export function findRunningForUpdate(userId, trx) {
  return trx('timeEntries').where({ runningUserId: userId }).first(BARE_COLUMNS).forUpdate();
}

export function lockById(id, trx) {
  return trx('timeEntries').where({ id }).first(BARE_COLUMNS).forUpdate();
}

/** One person's entries of one work date, locked (overlap checks for changes by hand). */
export function lockForUserDate(userId, workDate, trx) {
  return trx('timeEntries')
    .where({ userId, workDate })
    .orderBy([
      { column: 'startedAt', order: 'asc' },
      { column: 'id', order: 'asc' },
    ])
    .select(BARE_COLUMNS)
    .forUpdate();
}

// ---------- writes ----------

/**
 * @returns {Promise<number>} the new entry id
 * @throws CONFLICT when the person already has a running timer (errno 1062); a deadlock is left
 *   to `transaction`, which tries again
 */
export async function insertEntry(row, trx) {
  try {
    const [id] = await trx('timeEntries').insert(row);
    return id;
  } catch (error) {
    if (error?.errno === DUPLICATE) {
      throw new AppError('CONFLICT', { message: ANOTHER_TIMER_MESSAGE, cause: error });
    }
    throw error;
  }
}

export function updateEntry(id, changes, trx) {
  return trx('timeEntries').where({ id }).update(changes);
}

/** Ends a running entry. @returns {Promise<number>} 0 when it had already ended */
export function endRunning(id, { endedAt, stopReason, updatedAt }, trx) {
  return trx('timeEntries')
    .where({ id })
    .whereNull('endedAt')
    .update({ endedAt, stopReason, updatedAt });
}

export function removeEntry(id, trx) {
  return trx('timeEntries').where({ id }).del();
}
