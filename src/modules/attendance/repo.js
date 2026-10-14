// Attendance queries. The only file in this module that talks to the database.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

const DEADLOCK = 1213;
const ATTEMPTS = 3;

/**
 * Runs `run(trx)` in a READ COMMITTED transaction, again (up to 3 times) after a deadlock. Break,
 * check-out and timer writes of one person wait for each other on that person's attendance row;
 * READ COMMITTED takes no gap locks, so a lookup that finds nothing (no open break, no running
 * timer) never makes different people wait for, or deadlock with, each other. A WFH request
 * passes 'repeatable read' instead: its overlap check must lock the gap a second request would
 * be inserted into (findOverlappingWfh).
 * @template T
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} run
 * @param {{ isolationLevel?: 'read committed' | 'repeatable read' }} [options]
 * @returns {Promise<T>}
 * @throws CONFLICT when it still deadlocks on the last try
 */
export async function transaction(run, { isolationLevel = 'read committed' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(run, { isolationLevel });
    } catch (error) {
      if (error?.errno !== DEADLOCK) throw error;
      if (attempt >= ATTEMPTS) {
        const message = 'Something else changed at the same moment. Try again.';
        throw new AppError('CONFLICT', { message, cause: error });
      }
    }
  }
}

const ROW_COLUMNS = [
  'id',
  'userId',
  'workDate',
  'checkInAt',
  'checkOutAt',
  'location',
  'officeVerified',
  'checkInIp',
  'checkOutIp',
  'note',
  'lateMinutes',
  'isWorkingDay',
  'checkoutStatus',
  'source',
];

const BREAK_COLUMNS = [
  'id',
  'userId',
  'attendanceId',
  'workDate',
  'startedAt',
  'endedAt',
  'endReason',
  'pausedEntryId',
];

const CORRECTION_COLUMNS = [
  'id',
  'userId',
  'attendanceId',
  'workDate',
  'type',
  'requestedTime',
  'requestedEndTime',
  'requestedLocation',
  'reason',
  'status',
  'handledBy',
  'handledAt',
  'handlerNote',
  'createdAt',
];

// ---------- attendance ----------

export function findById(id, trx = db, { forUpdate = false } = {}) {
  const query = trx('attendance').select(ROW_COLUMNS).where({ id }).first();
  return forUpdate ? query.forUpdate() : query;
}

/** Rows by id (any order); [] for no ids. */
export function findByIds(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('attendance').select(ROW_COLUMNS).whereIn('id', ids);
}

export function findByUserAndDate(userId, workDate, trx = db) {
  return trx('attendance').select(ROW_COLUMNS).where({ userId, workDate }).first();
}

export function listByUserRange(userId, from, to, trx = db) {
  return trx('attendance')
    .select(ROW_COLUMNS)
    .where({ userId })
    .whereBetween('workDate', [from, to])
    .orderBy('workDate', 'asc');
}

export function listByDate(workDate, trx = db) {
  return trx('attendance').select(ROW_COLUMNS).where({ workDate }).orderBy('userId', 'asc');
}

/** @returns {Promise<number>} the new row id */
export async function insertRow(row, trx = db) {
  const [id] = await trx('attendance').insert(row);
  return id;
}

/** @returns {Promise<number>} rows changed */
export function updateRow(id, changes, trx = db) {
  return trx('attendance').where({ id }).update(changes);
}

/** Closes an open row; 0 when someone else closed it first. */
export function closeOpenRow(id, changes, trx = db) {
  return trx('attendance')
    .where({ id, checkoutStatus: 'open' })
    .whereNull('checkOutAt')
    .update(changes);
}

/** Open rows (no check-out) from days before `date`, locked for the update that follows. */
export function listOpenBefore(date, trx = db) {
  return trx('attendance')
    .select(ROW_COLUMNS)
    .where({ checkoutStatus: 'open' })
    .whereNull('checkOutAt')
    .where('workDate', '<', date)
    .orderBy('workDate', 'asc')
    .orderBy('userId', 'asc')
    .forUpdate();
}

export function markMissing(ids, updatedAt, trx = db) {
  if (ids.length === 0) return 0;
  return trx('attendance')
    .whereIn('id', ids)
    .where({ checkoutStatus: 'open' })
    .whereNull('checkOutAt')
    .update({ checkoutStatus: 'missing', updatedAt });
}

/**
 * Rows still marked missing (not fixed yet) of the people the Attendance screen shows: active and
 * tracking attendance (guide 7.10). A leaver's or an untracked person's row has nowhere to be
 * fixed, so it is never counted or listed. `hideAdmins` leaves out Admins' rows (a viewer who
 * isn't an Admin never sees an Admin's attendance).
 */
function missingOfTracked(trx, { hideAdmins = false } = {}) {
  const query = trx('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .where({ 'a.checkoutStatus': 'missing', 'u.status': 'active', 'u.tracksAttendance': true });
  if (hideAdmins) query.whereNot('u.role', 'admin');
  return query;
}

/** Missing rows (see missingOfTracked), newest day first. */
export function listMissing({ limit = 20, hideAdmins = false } = {}, trx = db) {
  return missingOfTracked(trx, { hideAdmins })
    .select(ROW_COLUMNS.map((column) => `a.${column}`))
    .orderBy('a.workDate', 'desc')
    .orderBy('a.userId', 'asc')
    .limit(limit);
}

/** How many missing rows (see missingOfTracked) there are. */
export async function countMissing({ hideAdmins = false } = {}, trx = db) {
  const row = await missingOfTracked(trx, { hideAdmins }).count({ n: '*' }).first();
  return Number(row?.n ?? 0);
}

/**
 * Missing rows (see missingOfTracked) per work date from `from` to `to` (inclusive), oldest first.
 * @returns {Promise<Array<{ workDate: string, count: number }>>}
 */
export async function countMissingByDay(from, to, { hideAdmins = false } = {}, trx = db) {
  const rows = await missingOfTracked(trx, { hideAdmins })
    .whereBetween('a.workDate', [from, to])
    .groupBy('a.workDate')
    .select('a.workDate')
    .count({ n: '*' })
    .orderBy('a.workDate', 'asc');
  return rows.map((row) => ({ workDate: row.workDate, count: Number(row.n) }));
}

// ---------- breaks (never write the generated open_user_id) ----------

/** @returns {Promise<number>} the new break id */
export async function insertBreak(row, trx = db) {
  const [id] = await trx('attendanceBreaks').insert(row);
  return id;
}

export function findBreakById(id, trx = db) {
  return trx('attendanceBreaks').select(BREAK_COLUMNS).where({ id }).first();
}

/**
 * The person's open break (at most one: open_user_id is unique), any day. Lock it only inside
 * `transaction` (READ COMMITTED): under REPEATABLE READ, locking a break that doesn't exist takes a
 * gap lock that other people's break inserts deadlock on.
 */
export function findOpenBreak(userId, trx = db, { forUpdate = false } = {}) {
  const query = trx('attendanceBreaks').select(BREAK_COLUMNS).where({ openUserId: userId }).first();
  return forUpdate ? query.forUpdate() : query;
}

/** Ends an open break; 0 when it was already ended. */
export function endBreakRow(id, { endedAt, endReason, updatedAt }, trx = db) {
  return trx('attendanceBreaks')
    .where({ id })
    .whereNull('endedAt')
    .update({ endedAt, endReason, updatedAt });
}

export function listBreaksByUserDate(userId, workDate, trx = db) {
  return trx('attendanceBreaks')
    .select(BREAK_COLUMNS)
    .where({ userId, workDate })
    .orderBy('startedAt', 'asc')
    .orderBy('id', 'asc');
}

export function listBreaksByDate(workDate, trx = db) {
  return trx('attendanceBreaks')
    .select(BREAK_COLUMNS)
    .where({ workDate })
    .orderBy('userId', 'asc')
    .orderBy('startedAt', 'asc')
    .orderBy('id', 'asc');
}

/** Breaks still open from days before `date`, locked for the update that follows. */
export function listOpenBreaksBefore(date, trx = db) {
  return trx('attendanceBreaks')
    .select(BREAK_COLUMNS)
    .whereNull('endedAt')
    .where('workDate', '<', date)
    .orderBy('workDate', 'asc')
    .orderBy('userId', 'asc')
    .forUpdate();
}

// ---------- corrections ----------

/** @returns {Promise<number>} the new correction id */
export async function insertCorrection(row, trx = db) {
  const [id] = await trx('attendanceCorrections').insert(row);
  return id;
}

export function findCorrection(id, trx = db, { forUpdate = false } = {}) {
  const query = trx('attendanceCorrections').select(CORRECTION_COLUMNS).where({ id }).first();
  return forUpdate ? query.forUpdate() : query;
}

export function findPendingCorrection({ userId, workDate, type }, trx = db) {
  return trx('attendanceCorrections')
    .select(CORRECTION_COLUMNS)
    .where({ userId, workDate, type, status: 'pending' })
    .first();
}

/**
 * Corrections with a status (and one person's, with `userId`). `hideAdmins` leaves out requests
 * from Admins (only Admins see an Admin's attendance), still in the same query.
 */
function correctionsWhere({ status, userId, hideAdmins = false }, trx) {
  const query = trx('attendanceCorrections').where({ status });
  if (userId) query.where({ userId });
  if (hideAdmins) query.whereNotIn('userId', trx('users').select('id').where({ role: 'admin' }));
  return query;
}

export function listCorrections({ status, userId, hideAdmins, limit, offset }, trx = db) {
  const query = correctionsWhere({ status, userId, hideAdmins }, trx).select(CORRECTION_COLUMNS);
  // Pending requests are handled oldest first; decided ones are shown newest first.
  if (status === 'pending') query.orderBy('createdAt', 'asc').orderBy('id', 'asc');
  else query.orderBy('handledAt', 'desc').orderBy('id', 'desc');
  return query.limit(limit).offset(offset);
}

export async function countCorrections({ status, userId, hideAdmins }, trx = db) {
  const row = await correctionsWhere({ status, userId, hideAdmins }, trx).count({ n: '*' }).first();
  return Number(row?.n ?? 0);
}

/** Marks a pending correction handled; 0 when it was already handled. */
export function handleCorrection(id, changes, trx = db) {
  return trx('attendanceCorrections').where({ id, status: 'pending' }).update(changes);
}

// ---------- work from home requests (CONTRACT 17) ----------

const WFH_COLUMNS = [
  'id',
  'userId',
  'fromDate',
  'toDate',
  'reason',
  'status',
  'handledBy',
  'handledAt',
  'declineReason',
  'createdAt',
];

/** Requests with the person who asked and whoever handled them, in one query. */
function wfhRows(trx) {
  return trx('wfhRequests as w')
    .join('users as u', 'u.id', 'w.userId')
    .leftJoin('users as h', 'h.id', 'w.handledBy')
    .select([
      ...WFH_COLUMNS.map((column) => `w.${column}`),
      'u.name as userName',
      'u.designation as userDesignation',
      'u.role as userRole',
      'u.status as userStatus',
      'h.name as handlerName',
    ]);
}

/**
 * Filters for lists and counts. `hideAdmins` leaves out Admins' requests (only Admins see an
 * Admin's attendance); `exceptUserId` leaves out one person's own; `endsFrom` ('YYYY-MM-DD')
 * keeps requests whose last day is that day or later; `handledSince` ({ date: 'YYYY-MM-DD',
 * at: UTC Date }) keeps pending requests whose last day is `date` or later and those handled
 * from `at` on.
 */
function filterWfh(
  query,
  { status, userId, exceptUserId, hideAdmins = false, endsFrom, handledSince },
) {
  if (status) query.where('w.status', status);
  if (userId) query.where('w.userId', userId);
  if (exceptUserId) query.whereNot('w.userId', exceptUserId);
  if (hideAdmins) query.whereNot('u.role', 'admin');
  if (endsFrom) query.where('w.toDate', '>=', endsFrom);
  if (handledSince) {
    query.where((inner) =>
      inner
        .where((open) =>
          open.where('w.status', 'pending').where('w.toDate', '>=', handledSince.date),
        )
        .orWhere('w.handledAt', '>=', handledSince.at),
    );
  }
  return query;
}

/** @returns {Promise<number>} the new request id */
export async function insertWfh(row, trx = db) {
  const [id] = await trx('wfhRequests').insert(row);
  return id;
}

/** One request with its people (see wfhRows), or undefined. */
export function findWfh(id, trx = db) {
  return wfhRows(trx).where('w.id', id).first();
}

/** The bare request row, locked for the update that follows (only this table's row). */
export function lockWfh(id, trx) {
  return trx('wfhRequests').select(WFH_COLUMNS).where({ id }).first().forUpdate();
}

/**
 * The person's first pending or approved request sharing a day with fromDate..toDate. With
 * `forUpdate` (inside a REPEATABLE READ transaction) the scan also locks the gap where an
 * overlapping request would go, so two requests sent at once can't both pass the check.
 */
export function findOverlappingWfh({ userId, fromDate, toDate }, trx = db, { forUpdate } = {}) {
  const query = trx('wfhRequests')
    .select(WFH_COLUMNS)
    .where({ userId })
    .where('fromDate', '<=', toDate)
    .where('toDate', '>=', fromDate)
    .whereIn('status', ['pending', 'approved'])
    .orderBy('fromDate', 'asc')
    .first();
  return forUpdate ? query.forUpdate() : query;
}

/** The person's pending and approved requests covering a work date (with people), oldest first. */
export function listWfhCovering(userId, workDate, trx = db) {
  return wfhRows(trx)
    .where('w.userId', userId)
    .whereIn('w.status', ['pending', 'approved'])
    .where('w.fromDate', '<=', workDate)
    .where('w.toDate', '>=', workDate)
    .orderBy('w.createdAt', 'asc')
    .orderBy('w.id', 'asc');
}

/** True when an approved request covers the person's work date. */
export async function hasApprovedWfh(userId, workDate, trx = db) {
  const row = await trx('wfhRequests')
    .select('id')
    .where({ userId, status: 'approved' })
    .where('fromDate', '<=', workDate)
    .where('toDate', '>=', workDate)
    .first();
  return Boolean(row);
}

/**
 * Requests with their people (filters: filterWfh). Pending first, soonest day first; then the
 * rest, most recently handled (or asked) first.
 */
export function listWfh({ limit, offset, ...where }, trx = db) {
  return filterWfh(wfhRows(trx), where)
    .orderByRaw("CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END")
    .orderByRaw("CASE WHEN w.status = 'pending' THEN w.from_date END")
    .orderByRaw('COALESCE(w.handled_at, w.created_at) DESC')
    .orderBy('w.id', 'desc')
    .limit(limit)
    .offset(offset);
}

/** How many requests match (filters: filterWfh). */
export async function countWfh(where, trx = db) {
  const query = trx('wfhRequests as w').join('users as u', 'u.id', 'w.userId');
  const row = await filterWfh(query, where).count({ n: '*' }).first();
  return Number(row?.n ?? 0);
}

/** Changes a request still in status `from` (a decision, or a shorter toDate); 0 when it wasn't. */
export function updateWfhStatus(id, from, changes, trx = db) {
  return trx('wfhRequests').where({ id, status: from }).update(changes);
}
