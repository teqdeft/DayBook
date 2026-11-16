// Carried lines (CONTRACT 24, "Report save"): a line added from a suggestion links back to the
// open task it continues (carried_from_task_id) and copies that task's first_reported_on,
// project_task_id and timer_note, as carry-over did before drafts stopped copying lines. A link
// that doesn't pass every check is dropped and the line saves as a new one.
import * as carryRepo from './carryRepo';
import { OPEN_STATUSES, isLapsedDraft } from './suggestions';

/** Whether one claim may carry from its source line (the checks besides "not carried yet"). */
function mayCarry(source, { userId, workDate, projectId, projectRequestId }) {
  if (!source || Number(source.userId) !== Number(userId)) return false;
  if (source.reportStatus !== 'submitted' || !(source.workDate < workDate)) return false;
  if (!OPEN_STATUSES.has(source.status) || source.carryClosedAt) return false;
  if (projectId) return Number(source.projectId) === Number(projectId);
  return Boolean(projectRequestId) && Number(source.projectRequestId) === Number(projectRequestId);
}

/**
 * Checks lines about to be inserted that say which open task they continue, inside the writing
 * transaction, which must run at READ COMMITTED (lineTransaction, writeTx.js): the sources are
 * locked first and stay locked until it ends, so a line closed or carried at the same moment
 * waits or is seen by the plain read of the carriers. A source passes when it is the person's own
 * line, in a submitted report before this day, on the same project (or project request), In
 * progress or Blocked, not closed, and not carried by another line (lines in `ignoreTaskIds`,
 * those this same save deletes, and lines of a draft that locked unsubmitted don't count). One
 * claim per source: the first one wins.
 * @param {{ userId: number, workDate: string, keepNotes: boolean, ignoreTaskIds?: Set<number>,
 *   claims: Array<{ key: unknown, sourceId: number, projectId?: number | null,
 *   projectRequestId?: number | null, projectTaskId?: number | null,
 *   timerNote?: string | null }> }} input workDate: the day of the report the lines go into;
 *   keepNotes: report_tasks has timer_note (repo.hasTimerNote); projectTaskId and timerNote are
 *   the line's own, used when the source has none
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<Map<unknown, { carriedFromTaskId: number, firstReportedOn: string,
 *   projectTaskId: number | null, timerNote?: string | null }>>} claim key -> the fields to insert
 *   the line with, only for the claims that pass
 */
export async function resolveCarried({ userId, workDate, keepNotes, ignoreTaskIds, claims }, trx) {
  const passed = new Map();
  const ids = [...new Set(claims.map((claim) => Number(claim.sourceId)).filter(Boolean))];
  if (ids.length === 0) return passed;
  const rows = await carryRepo.withClosedColumns((withClosed) =>
    carryRepo.lockLines(ids, { withClosed, withTimerNote: keepNotes }, trx),
  );
  const sources = new Map(rows.map((row) => [Number(row.id), row]));
  const carriers = await carryRepo.listCarriers(ids, trx);
  const taken = new Set(
    carriers
      .filter((row) => !ignoreTaskIds?.has(Number(row.id)) && !isLapsedDraft(row))
      .map((row) => Number(row.carriedFromTaskId)),
  );
  for (const claim of claims) {
    const sourceId = Number(claim.sourceId);
    const source = sources.get(sourceId);
    if (taken.has(sourceId) || !mayCarry(source, { userId, workDate, ...claim })) continue;
    taken.add(sourceId);
    passed.set(claim.key, {
      carriedFromTaskId: sourceId,
      firstReportedOn: source.firstReportedOn,
      // The carried line keeps working on the same priority task (CONTRACT 13) and keeps the
      // timer note it was filled from (CONTRACT 21), so today's Fill of that note doesn't add it
      // again after the line was reworded.
      projectTaskId: source.projectTaskId ?? claim.projectTaskId ?? null,
      ...(keepNotes ? { timerNote: source.timerNote ?? claim.timerNote ?? null } : null),
    });
  }
  return passed;
}

/**
 * The carried-line claims of a report save (pure): the lines writeEntries will insert (no id, an
 * id it doesn't know, or an id sent twice) that send `carriedFromTaskId`, and the stored task ids
 * the save deletes (those it isn't sent). An existing line's link never changes, so a kept line's
 * `carriedFromTaskId` is ignored.
 * @param {Array<{ projectId?: number, projectRequestId?: number, tasks: Array<{ id?: number,
 *   carriedFromTaskId?: number, projectTaskId?: number, timerNote?: string | null }> }>} entries
 * @param {Array<{ id: number }>} storedTasks the report's stored task rows
 * @returns {{ claims: object[], deletedIds: Set<number> }} claim keys are the task objects
 */
export function saveClaims(entries, storedTasks) {
  const stored = new Set(storedTasks.map((task) => Number(task.id)));
  const kept = new Set();
  const claims = [];
  for (const entry of entries) {
    for (const task of entry.tasks) {
      const id = Number(task.id);
      if (id && stored.has(id) && !kept.has(id)) {
        kept.add(id);
        continue;
      }
      if (!task.carriedFromTaskId) continue;
      claims.push({
        key: task,
        sourceId: Number(task.carriedFromTaskId),
        projectId: entry.projectId ?? null,
        projectRequestId: entry.projectRequestId ?? null,
        projectTaskId: task.projectTaskId ?? null,
        timerNote: task.timerNote ?? null,
      });
    }
  }
  return { claims, deletedIds: new Set([...stored].filter((id) => !kept.has(id))) };
}
