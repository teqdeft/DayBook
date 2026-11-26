// Time from timers per task (CONTRACT 28, Task number, status chip, time and updates per viewer):
// the sum of the finished time entries on each task, only one person's when `userId` is given (a
// viewer without team.view sees only their own minutes; the caller passes their id). A running
// timer isn't counted until it stops. Its own query (the projectTasks builder owns this file): one
// grouped read that selects only its GROUP BY column and an aggregate (MySQL 8.4's
// ONLY_FULL_GROUP_BY), on time_entries' project_task_id index.
import { db } from '@/lib/db';

/** A positive whole id, or null. */
function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * @param {{ taskIds: number[], userId?: number | null }} args userId: only that person's entries
 * @returns {Promise<Record<number, number>>} task id → whole minutes (the seconds summed, then
 *   rounded down); tasks without finished entries are left out
 */
export async function minutesByTask({ taskIds, userId = null }) {
  const ids = [...new Set((taskIds ?? []).map(toId).filter(Boolean))];
  if (ids.length === 0) return {};
  const query = db('timeEntries')
    .whereIn('projectTaskId', ids)
    .whereNotNull('endedAt')
    .groupBy('projectTaskId')
    .select('projectTaskId')
    .select(db.raw('SUM(TIMESTAMPDIFF(SECOND, started_at, ended_at)) AS seconds'));
  if (userId !== null && userId !== undefined) query.where('userId', toId(userId) ?? 0);
  const minutes = {};
  for (const row of await query) {
    const total = Math.floor(Math.max(Number(row.seconds) || 0, 0) / 60);
    if (total > 0) minutes[Number(row.projectTaskId)] = total;
  }
  return minutes;
}
