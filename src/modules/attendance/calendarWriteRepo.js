// Queries of the holiday and leave writes and the Leave page (CONTRACT 25, items 6 and 9). The
// reads every screen shares (holidays of a range, leave without the note) are A's calendarRepo.js.
// Tables of migration 018 (holidays, leave_entries) throw errno 1146 before it has run; the
// services guard them (migration018.js).
import { db } from '@/lib/db';

const HOLIDAY_COLUMNS = ['id', 'holidayDate', 'name'];
const LEAVE_COLUMNS = [
  'id',
  'userId',
  'fromDate',
  'toDate',
  'part',
  'paid',
  'leaveType',
  'note',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
];

const toHoliday = (row) => (row ? { id: row.id, date: row.holidayDate, name: row.name } : null);

// ---------- holidays ----------

/** One holiday by id ({ id, date, name } or null); `forUpdate` locks it for the write that follows. */
export async function findHoliday(id, trx = db, { forUpdate = false } = {}) {
  const query = trx('holidays').select(HOLIDAY_COLUMNS).where({ id }).first();
  return toHoliday(await (forUpdate ? query.forUpdate() : query));
}

/** How many holidays fall from `from` to `to` (inclusive), leaving out `excludeId`. */
export async function countHolidaysBetween({ from, to, excludeId }, trx = db) {
  const query = trx('holidays').whereBetween('holidayDate', [from, to]).count({ count: '*' });
  if (excludeId) query.whereNot({ id: excludeId });
  const [row] = await query;
  return Number(row?.count ?? 0);
}

/** Adds a holiday; errno 1062 when the date already has one (the unique key). */
export async function insertHoliday({ date, name, actorId, at }, trx) {
  const [id] = await trx('holidays').insert({
    holidayDate: date,
    name,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: at,
    updatedAt: at,
  });
  return id;
}

/** Saves a holiday's date and name; errno 1062 when the new date already has one. */
export function updateHoliday(id, { date, name, actorId, at }, trx) {
  return trx('holidays')
    .where({ id })
    .update({ holidayDate: date, name, updatedBy: actorId, updatedAt: at });
}

/** Deletes a holiday. */
export function deleteHoliday(id, trx) {
  return trx('holidays').where({ id }).delete();
}

// ---------- leave ----------

/** One leave entry by id (the whole row, note included), or undefined. */
export function findLeave(id, trx = db, { forUpdate = false } = {}) {
  const query = trx('leaveEntries').select(LEAVE_COLUMNS).where({ id }).first();
  return forUpdate ? query.forUpdate() : query;
}

/**
 * The person's first leave entry sharing a day with fromDate..toDate (other than `excludeId`).
 * With `forUpdate` inside a REPEATABLE READ transaction the scan of the (user_id, from_date) index
 * also locks the gap an overlapping entry would go into, so two entries sent at once (a double
 * tap) can't both pass the check (the WFH request pattern).
 */
export function findOverlappingLeave(
  { userId, fromDate, toDate, excludeId },
  trx = db,
  { forUpdate = false } = {},
) {
  const query = trx('leaveEntries')
    .select(LEAVE_COLUMNS)
    .where({ userId })
    .where('fromDate', '<=', toDate)
    .where('toDate', '>=', fromDate)
    .orderBy('fromDate', 'asc')
    .orderBy('id', 'asc')
    .first();
  if (excludeId) query.whereNot({ id: excludeId });
  return forUpdate ? query.forUpdate() : query;
}

/** Adds a leave entry and returns its id. */
export async function insertLeave(record, trx) {
  const [id] = await trx('leaveEntries').insert(record);
  return id;
}

/** Saves a leave entry's changed fields. */
export function updateLeave(id, changes, trx) {
  return trx('leaveEntries').where({ id }).update(changes);
}

/** Deletes a leave entry (a hard delete; the audit row keeps the whole entry). */
export function deleteLeave(id, trx) {
  return trx('leaveEntries').where({ id }).delete();
}

/**
 * Leave entries sharing a day with `from`..`to` (or the one entry `id`), with their person and
 * who marked and last changed them; newest first by first day. `hideAdmins` leaves out Admins'
 * leave.
 * @returns {Promise<object[]>} rows with userName, userDesignation, userRole, userStatus,
 *   userAvatarUrl, createdByName and updatedByName
 */
export function listLeaveEntries({ from, to, id, userId, hideAdmins, max = 2000 }, trx = db) {
  const query = trx('leaveEntries as l')
    .join('users as u', 'u.id', 'l.userId')
    .leftJoin('users as c', 'c.id', 'l.createdBy')
    .leftJoin('users as m', 'm.id', 'l.updatedBy')
    .select(LEAVE_COLUMNS.map((column) => `l.${column}`))
    .select(
      'u.name as userName',
      'u.designation as userDesignation',
      'u.role as userRole',
      'u.status as userStatus',
      'u.avatarUrl as userAvatarUrl',
      'c.name as createdByName',
      'm.name as updatedByName',
    )
    .orderBy('l.fromDate', 'desc')
    .orderBy('l.id', 'desc')
    .limit(max);
  if (to) query.where('l.fromDate', '<=', to);
  if (from) query.where('l.toDate', '>=', from);
  if (id) query.where('l.id', id);
  if (userId) query.where('l.userId', userId);
  if (hideAdmins) query.whereNot('u.role', 'admin');
  return query;
}

/** The days from `from` to `to` on which these people have an attendance row: [{ userId, workDate }]. */
export function listCheckInDays({ userIds, from, to }, trx = db) {
  if (!userIds?.length) return Promise.resolve([]);
  return trx('attendance')
    .select('userId', 'workDate')
    .whereIn('userId', userIds)
    .whereBetween('workDate', [from, to]);
}
