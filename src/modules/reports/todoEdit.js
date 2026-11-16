// Changing lines of today's to-do (CONTRACT 24): rename, tick and untick, remove a line, remove a
// project with its lines. Only the person's own lines and projects of today's report, until it is
// submitted; everything else is NOT_FOUND. The Today card hides a removed line or project at once
// and sends the DELETE when its Undo toast ends, so Undo never needs the server. A rename to a
// suggestion's title carries the line, as typing that title would.
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { resolveCarried } from './carry';
import { listCarrySuggestions, projectKeyOf } from './suggestions';
import * as todoRepo from './todoRepo';
import { todoLineUpdateSchema } from './todoSchemas';
import { getTodo } from './todoRead';
import { normalizeTitle } from './todoText';
import { tickedStatus } from './todoView';
import { changeToday, lineNotFound, parseTodoInput, projectNotFound } from './todoWrite';

/** The columns a rename or tick changes, or null when nothing changes. */
function lineChanges(task, { title, done }) {
  const changes = {};
  if (title !== undefined && title !== task.title) changes.title = title;
  if (done !== undefined) {
    const status = tickedStatus(task.status, done);
    if (status !== task.status) changes.status = status;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

const findLine = (tasks, id) => tasks.find((task) => Number(task.id) === Number(id));

/** The day's suggestions a rename may match ({} when they can't be read: it stays a rename). */
async function suggestionsForRename(user) {
  try {
    return await listCarrySuggestions({ userId: user.id });
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'could not read the suggestions for a rename');
    return {};
  }
}

/**
 * A rename to the title of a suggestion on the line's project (normalised) carries the line
 * (CONTRACT 24, "Typing ... a title equal to a suggestion's"), checked by resolveCarried under
 * this transaction's locks. The line keeps its id and takes the source's first_reported_on,
 * project_task_id and timer_note (its own when the source has none) and its status, unless the
 * line is Done. A line that already continues a task keeps its link.
 * @returns {Promise<object | null>} the columns to write with the rename, or null
 */
async function carryOnRename({ report, entries, task, title, status, suggestions }, trx) {
  if (task.carriedFromTaskId) return null;
  const entry = entries.find((row) => Number(row.id) === Number(task.entryId));
  const wanted = normalizeTitle(title);
  const match = entry
    ? (suggestions[projectKeyOf(entry)] ?? []).find((s) => normalizeTitle(s.title) === wanted)
    : null;
  if (!match) return null;
  const keepNotes = await repo.hasTimerNote(trx);
  const claim = {
    key: task.id,
    sourceId: match.taskId,
    projectId: entry.projectId ?? null,
    projectRequestId: entry.projectRequestId ?? null,
    projectTaskId: task.projectTaskId ?? null,
    timerNote: task.timerNote ?? null,
  };
  const { userId, workDate } = report;
  const carried = await resolveCarried({ userId, workDate, keepNotes, claims: [claim] }, trx);
  const link = carried.get(task.id);
  if (!link) return null;
  const [source] = await todoRepo.listSourceLines([link.carriedFromTaskId], trx);
  return { ...link, status: status === 'done' ? 'done' : (source?.status ?? status) };
}

/**
 * Renames a line (2 to 500 characters, spaces collapse) and/or ticks or unticks it. Its timer
 * note, priority task and carried link stay; a rename to a suggestion's title on its project
 * carries the line from that open task (carryOnRename). Ticking never closes a priority task.
 * @param {{ user: object, id: number, title?: string, done?: boolean }} input
 * @returns {Promise<object>} the new to-do (getTodo)
 * @throws NOT_FOUND (not a line of the person's report today), REPORT_LOCKED, VALIDATION_FAILED
 */
export async function updateTodoLine({ user, id, title, done }) {
  const input = parseTodoInput(todoLineUpdateSchema, { title, done });
  // Read before the transaction: the active-project check takes other pool connections.
  const suggestions = input.title === undefined ? {} : await suggestionsForRename(user);
  await changeToday({ user, notFound: lineNotFound }, async ({ report, entries, tasks }, trx) => {
    const task = findLine(tasks, id);
    if (!task) throw lineNotFound();
    const changes = lineChanges(task, input);
    if (!changes) return;
    const status = changes.status ?? task.status;
    const carry = changes.title
      ? await carryOnRename(
          { report, entries, task, title: changes.title, status, suggestions },
          trx,
        )
      : null;
    const at = nowDate();
    await repo.updateTask(task.id, { ...changes, ...carry, updatedAt: at }, trx);
    await repo.updateReport(report.id, { updatedAt: at }, trx);
  });
  return getTodo({ user });
}

/**
 * Deletes a line of today's to-do (its project stays, even with no lines left).
 * @param {{ user: object, id: number }} input
 * @returns {Promise<object>} the new to-do (getTodo)
 * @throws NOT_FOUND, REPORT_LOCKED
 */
export async function removeTodoLine({ user, id }) {
  await changeToday({ user, notFound: lineNotFound }, async ({ report, tasks }, trx) => {
    const task = findLine(tasks, id);
    if (!task) throw lineNotFound();
    await repo.deleteTasks([task.id], trx);
    await repo.updateReport(report.id, { updatedAt: nowDate() }, trx);
  });
  return getTodo({ user });
}

/**
 * Removes a project from today's to-do with its lines. A project with hours stays: its hours
 * belong to the report, so it is removed there.
 * @param {{ user: object, entryId: number }} input
 * @returns {Promise<object>} the new to-do (getTodo)
 * @throws NOT_FOUND, REPORT_LOCKED, CONFLICT (409, "This project has hours in your report.
 *   Remove it in the report.")
 */
export async function removeTodoProject({ user, entryId }) {
  await changeToday(
    { user, notFound: projectNotFound },
    async ({ report, entries, tasks }, trx) => {
      const entry = entries.find((row) => Number(row.id) === Number(entryId));
      if (!entry) throw projectNotFound();
      if (Number(entry.minutes) > 0) {
        throw new AppError('CONFLICT', {
          message: 'This project has hours in your report. Remove it in the report.',
        });
      }
      const lines = tasks.filter((task) => task.entryId === entry.id).map((task) => task.id);
      await repo.deleteTasks(lines, trx);
      await repo.deleteEntries([entry.id], trx);
      await repo.updateReport(report.id, { updatedAt: nowDate() }, trx);
    },
  );
  return getTodo({ user });
}
