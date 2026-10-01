// Screen-time queries. The only file in this module that talks to the database. Each read is one
// query on the activity_segments indexes: (user_id, work_date), (work_date), (user_id, ended_at).
import { db } from '@/lib/db';

const SEGMENT_COLUMNS = ['id', 'userId', 'workDate', 'state', 'source', 'startedAt', 'endedAt'];

/**
 * The person's latest segment (by end time), locked for the heartbeat update that follows.
 * @returns {Promise<object | undefined>}
 */
export function findLatestForUpdate(userId, trx = db) {
  return trx('activitySegments')
    .select(SEGMENT_COLUMNS)
    .where({ userId })
    .orderBy([
      { column: 'endedAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .first()
    .forUpdate();
}

/** @returns {Promise<number>} the new segment id */
export async function insertSegment(segment, trx = db) {
  const [id] = await trx('activitySegments').insert({
    ...segment,
    createdAt: segment.startedAt,
    updatedAt: segment.endedAt,
  });
  return id;
}

/** Moves a segment's end. @returns {Promise<number>} rows changed */
export function setEndedAt(id, endedAt, trx = db) {
  return trx('activitySegments').where({ id }).update({ endedAt, updatedAt: endedAt });
}

/** One person's segments on one work date, in time order. */
export function listForUserDate(userId, workDate, trx = db) {
  return trx('activitySegments')
    .select(['state', 'source', 'startedAt', 'endedAt'])
    .where({ userId, workDate })
    .orderBy([
      { column: 'startedAt', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);
}

/**
 * Seconds per work date and state for one person, with the first start and last end of each:
 * [{ workDate, state, seconds, firstStartedAt, lastEndedAt }], oldest day first.
 */
export function sumByDayAndState(userId, from, to, trx = db) {
  return trx('activitySegments')
    .select(
      'workDate',
      'state',
      trx.raw('SUM(TIMESTAMPDIFF(SECOND, `started_at`, `ended_at`)) AS `seconds`'),
      trx.raw('MIN(`started_at`) AS `first_started_at`'),
      trx.raw('MAX(`ended_at`) AS `last_ended_at`'),
    )
    .where({ userId })
    .whereBetween('workDate', [from, to])
    .groupBy('workDate', 'state')
    .orderBy('workDate', 'asc');
}

/**
 * Every active tracked person (by name) with their segments on one work date: one row per
 * segment, or one row with null segment columns for someone without data.
 */
export function listTeamDay(workDate, trx = db) {
  return trx('users as u')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .leftJoin('activitySegments as s', function joinDay() {
      this.on('s.userId', '=', 'u.id').andOnVal('s.workDate', '=', workDate);
    })
    .where({ 'u.status': 'active', 'u.tracksAttendance': true })
    .select([
      'u.id as userId',
      'u.name',
      'u.email',
      'u.designation',
      'u.role',
      'u.status',
      'u.avatarUrl',
      'd.name as departmentName',
      's.id as segmentId',
      's.state',
      's.source',
      's.startedAt',
      's.endedAt',
    ])
    .orderBy([
      { column: 'u.name', order: 'asc' },
      { column: 'u.id', order: 'asc' },
      { column: 's.startedAt', order: 'asc' },
      { column: 's.id', order: 'asc' },
    ]);
}

/**
 * Deletes segments of work dates before `workDate`, `batchSize` rows at a time (short locks).
 * @returns {Promise<number>} rows deleted
 */
export async function deleteBefore(workDate, { batchSize = 5000 } = {}, trx = db) {
  let total = 0;
  for (;;) {
    const deleted = await trx('activitySegments')
      .where('workDate', '<', workDate)
      .limit(batchSize)
      .delete();
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
