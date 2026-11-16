// Play on a to-do line (CONTRACT 24): starts a timer on the line's project with its priority task
// and the first 200 characters of its title as the note, then remembers that note on the line
// (report_tasks.timer_note), so Fill report from timers merges the timer into this line even after
// the title is reworded (reportTimers.lineFor matches by timer note).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { timers } from '@/modules/timers';
import * as repo from './repo';
import { lockStoredRows } from './save';
import { getTodo } from './todoRead';
import { noteFromTitle } from './todoView';
import { findTodayReport, lineNotFound, retryOnDeadlock } from './todoWrite';
import { isEditable, loadEntriesFor } from './view';

/** The written line with this id in today's report, with its entry, or null. */
async function findLine(reportId, id) {
  const entries = (await loadEntriesFor([reportId])).get(reportId) ?? [];
  for (const entry of entries) {
    const task = entry.tasks.find((row) => Number(row.id) === Number(id));
    if (task) return task.title.trim() ? { entry, task } : null;
  }
  return null;
}

/** The line's priority task when the person can still time it (open, on this project), else null. */
async function openTaskOf(user, entry, task) {
  if (!task.projectTaskId) return null;
  const open = await projectTasks.findOpenForPicker({
    userId: user.id,
    projectId: entry.projectId,
  });
  return open.some((row) => Number(row.id) === Number(task.projectTaskId))
    ? Number(task.projectTaskId)
    : null;
}

/**
 * Remembers the timer's note on the line while the report can still change. Best effort: the
 * timer already runs, and the line's title still starts with the note, so Fill matches it by
 * title when this fails.
 */
async function rememberNote({ reportId, lineId, note }) {
  if (!note) return;
  try {
    await retryOnDeadlock(() =>
      db.transaction(async (trx) => {
        if (!(await repo.hasTimerNote(trx))) return;
        const locked = await repo.findByIdForUpdate(reportId, trx);
        if (!isEditable(locked)) return;
        const { tasks } = await lockStoredRows(locked, trx);
        const task = tasks.find((row) => Number(row.id) === Number(lineId));
        if (task && task.timerNote !== note) {
          await repo.updateTask(task.id, { timerNote: note, updatedAt: nowDate() }, trx);
        }
      }),
    );
  } catch (error) {
    logger.warn({ err: error, reportId }, 'could not keep the timer note on the to-do line');
  }
}

/**
 * Starts a timer on a line of today's to-do: timers.start with the line's project, its priority
 * task (left out when that task is closed or no longer the person's to link) and the first 200
 * characters of its title as the note; then the line's timer_note becomes that note. Works on a
 * submitted report's lines too (the timer isn't a report change; the note is written quietly, as
 * Fill does). A timer already running on this work is left as it is.
 * @param {{ user: object, id: number }} input
 * @returns {Promise<object>} the new to-do (getTodo) plus `timerState` (timers.getState, what
 *   POST /api/timers/start answers)
 * @throws NOT_FOUND (not a written line of the person's report today), PROJECT_NOT_ACTIVE
 *   ("Only active projects can be timed.": a project request), CONFLICT ("This task is done.
 *   Untick it to start a timer."), ALREADY_ON_BREAK ("End your break to start a timer."), and
 *   timers.start's refusals as they come (FORBIDDEN, TIMERS_OFF, NOT_CHECKED_IN,
 *   ALREADY_CHECKED_OUT, PROJECT_NOT_ACTIVE, CONFLICT)
 */
export async function startTodoTimer({ user, id }) {
  const { report } = await findTodayReport(user);
  const found = report ? await findLine(report.id, id) : null;
  if (!found) throw lineNotFound();
  const { entry, task } = found;
  if (!entry.projectId) {
    throw new AppError('PROJECT_NOT_ACTIVE', { message: 'Only active projects can be timed.' });
  }
  if (task.status === 'done') {
    throw new AppError('CONFLICT', { message: 'This task is done. Untick it to start a timer.' });
  }
  const state = await timers.getState({ user });
  // timers.start would end the break; Play is hidden on a break, so it is refused here.
  if (state.onBreak && state.blocked === null) {
    throw new AppError('ALREADY_ON_BREAK', { message: 'End your break to start a timer.' });
  }
  const note = noteFromTitle(task.title);
  const timerState = await timers.start({
    user,
    projectId: entry.projectId,
    projectTaskId: await openTaskOf(user, entry, task),
    note,
  });
  await rememberNote({ reportId: report.id, lineId: task.id, note });
  return { ...(await getTodo({ user, timerState })), timerState };
}
