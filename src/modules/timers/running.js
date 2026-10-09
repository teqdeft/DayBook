// Starting and stopping timers (CONTRACT 15). One timer runs at a time: starting another stops the
// first at the same moment. A break pauses the running timer and End break resumes it; check-out
// stops it. Start and stop are not audited.
import { nowDate, workDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import { endForgotten } from './forgotten';
import * as repo from './repo';
import { stopTime, wholeSecond } from './rules';
import { STOP_REASONS, timerStartSchema } from './schemas';
import {
  assertCheckedIn,
  assertTimersOn,
  assertWriter,
  checkProject,
  checkTask,
  isOpenRow,
  loadToday,
  parseInput,
  toEntryView,
} from './shared';
import { getState } from './state';

/** True when the running entry is already this work (a double click on Start). */
function sameWork(entry, input) {
  return (
    Number(entry.projectId) === input.projectId &&
    Number(entry.projectTaskId ?? 0) === Number(input.projectTaskId ?? 0) &&
    (entry.note ?? null) === (input.note ?? null)
  );
}

/**
 * The person's running entry, locked. One still running from a work date before `at`'s (the
 * midnight job hasn't closed it yet) is closed by the midnight rule instead, and null returned: it
 * is never today's timer, and stopping it now would count the whole evening.
 */
async function lockRunning({ userId, at, tz }, trx) {
  const running = await repo.findRunningForUpdate(userId, trx);
  if (!running || running.workDate >= workDate(tz, at)) return running ?? null;
  await endForgotten(running, tz, trx);
  return null;
}

/** Ends a locked running entry at `at` (never before its start or past its work date). */
async function endEntry(entry, { at, reason, tz }, trx) {
  const endedAt = stopTime(entry, at, tz);
  await repo.endRunning(entry.id, { endedAt, stopReason: reason, updatedAt: nowDate() }, trx);
  return endedAt;
}

/**
 * Starts a timer on a project, optionally on one of its priority tasks and with a note. A timer
 * already running on other work stops (switched) at the same moment; one running on the same
 * project, task and note is left as it is. Starting while on a break ends the break (its timer is
 * not resumed). A timer still running from an earlier work date is closed by the midnight rule
 * first, so it is never treated as today's.
 * @param {{ user: object, projectId: number, projectTaskId?: number | null,
 *   note?: string | null }} input note is trimmed; '' means none
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN (can't use timers), VALIDATION_FAILED (projectTaskId not an open priority task
 *   of the project for this person, note over 200), TIMERS_OFF, NOT_CHECKED_IN,
 *   ALREADY_CHECKED_OUT, PROJECT_NOT_ACTIVE ("Only active projects can be timed."), CONFLICT
 *   ("Another timer just started. Refresh to see it.")
 */
export async function start({ user, projectId, projectTaskId = null, note = null }) {
  assertWriter(user);
  const input = parseInput(timerStartSchema, { projectId, projectTaskId, note });
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  assertCheckedIn(ctx);
  await checkProject(input.projectId);
  await checkTask({ userId: user.id, ...input });
  await repo.transaction(async (trx) => {
    const at = wholeSecond(nowDate());
    // Attendance row, break, then timer: the lock order of startBreak and checkOut. Checked again
    // under the lock, so a check-out that got in first wins.
    const row = await attendance.lockDay({ userId: user.id, workDate: ctx.date }, trx);
    assertCheckedIn({ row, open: isOpenRow(row) });
    await attendance.endOpenBreak({ userId: user.id, at, reason: 'timer' }, trx);
    const running = await lockRunning({ userId: user.id, at, tz: ctx.tz }, trx);
    if (running && sameWork(running, input)) return;
    if (running) await endEntry(running, { at, reason: 'switched', tz: ctx.tz }, trx);
    await repo.insertEntry(
      {
        userId: user.id,
        workDate: ctx.date,
        projectId: input.projectId,
        projectTaskId: input.projectTaskId,
        note: input.note,
        startedAt: at,
        source: 'timer',
        createdAt: at,
        updatedAt: at,
      },
      trx,
    );
  });
  return getState({ user });
}

/**
 * Stops the person's running timer (stopped). With nothing running it only returns the state.
 * Works whatever the mode and attendance, so a timer can always be stopped.
 * @param {{ user: object }} input
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN (can't use timers)
 */
export async function stop({ user }) {
  assertWriter(user);
  await stopRunning({ userId: user.id, at: nowDate(), reason: 'stopped' });
  return getState({ user });
}

/**
 * Stops the person's running timer inside the caller's transaction (attendance: break, check-out).
 * The end is `at`, never before the start or past the end of the entry's work date. A timer still
 * running from an earlier work date is closed by the midnight rule instead (and notified), and
 * counts as nothing running.
 * @param {{ userId: number, at?: Date, reason: 'stopped' | 'switched' | 'break' | 'checkout' |
 *   'midnight' | 'away' }} input at defaults to now
 * @param {import('knex').Knex.Transaction} [trx] without one, a transaction of its own
 * @returns {Promise<object | null>} the stopped EntryView, or null when nothing ran
 * @throws Error for an unknown reason (a programming error)
 */
export async function stopRunning({ userId, at, reason }, trx) {
  if (!STOP_REASONS.includes(reason)) throw new Error(`Unknown timer stop reason: ${reason}`);
  if (!trx) return repo.transaction((inner) => stopRunning({ userId, at, reason }, inner));
  const { timezone } = await settings.getAll();
  const end = wholeSecond(at ?? nowDate());
  const running = await lockRunning({ userId, at: end, tz: timezone }, trx);
  if (!running) return null;
  await endEntry(running, { at: end, reason, tz: timezone }, trx);
  return toEntryView(await repo.findById(running.id, trx), timezone);
}

/**
 * Stops every running timer, in one transaction (settings.update, after Admin turns timers off).
 * Each person's running entry is locked in turn, lowest user id first, so two calls lock in the
 * same order; it takes only timer locks, the last in the lock order, like stop. Each ends at `at`,
 * never before its start or past the end of its work date; one still running from an earlier
 * work date is closed by the midnight rule instead (and its person notified) and, as in
 * stopRunning, not counted.
 * @param {{ at?: Date, reason: 'stopped' | 'switched' | 'break' | 'checkout' | 'midnight' |
 *   'away' }} input at defaults to now
 * @returns {Promise<{ stopped: number }>} how many timers it stopped with `reason`
 * @throws Error for an unknown reason (a programming error), CONFLICT when it still deadlocks
 *   on the last try
 */
export async function stopAllRunning({ at, reason }) {
  if (!STOP_REASONS.includes(reason)) throw new Error(`Unknown timer stop reason: ${reason}`);
  const { timezone } = await settings.getAll();
  const end = wholeSecond(at ?? nowDate());
  return repo.transaction(async (trx) => {
    let stopped = 0;
    for (const userId of await repo.listAllRunningUserIds(trx)) {
      // Null when it stopped since the list was read, or was closed by the midnight rule.
      const running = await lockRunning({ userId, at: end, tz: timezone }, trx);
      if (!running) continue;
      await endEntry(running, { at: end, reason, tz: timezone }, trx);
      stopped += 1;
    }
    return { stopped };
  });
}

/** The task to keep on a resumed timer: null when it is no longer open for the person. */
async function stillOpenTask(entry) {
  if (!entry.projectTaskId) return null;
  const open = await projectTasks.findOpenForPicker({
    userId: entry.userId,
    projectId: entry.projectId,
  });
  return open.some((task) => Number(task.id) === Number(entry.projectTaskId))
    ? Number(entry.projectTaskId)
    : null;
}

/**
 * After a break that paused a timer: starts a new entry with the same project, task and note at
 * `at`, inside the caller's transaction. Skipped when timers are turned off, a timer already runs,
 * the entry isn't the person's, or its project is no longer active; a task that is no longer open
 * is dropped.
 * @param {{ userId: number, entryId: number, at?: Date }} input at defaults to now
 * @param {import('knex').Knex.Transaction} [trx] without one, a transaction of its own
 * @returns {Promise<object | null>} the new EntryView, or null when nothing was started
 */
export async function resumeAfterBreak({ userId, entryId, at }, trx) {
  if (!trx) return repo.transaction((inner) => resumeAfterBreak({ userId, entryId, at }, inner));
  const { timezone, timersMode } = await settings.getAll();
  if (timersMode === 'off') return null;
  const startedAt = wholeSecond(at ?? nowDate());
  if (await lockRunning({ userId, at: startedAt, tz: timezone }, trx)) return null;
  const entry = entryId ? await repo.findById(entryId, trx) : null;
  if (!entry || Number(entry.userId) !== Number(userId)) return null;
  const project = await projects.findById(entry.projectId);
  if (project?.status !== 'active') return null;
  const id = await repo.insertEntry(
    {
      userId: entry.userId,
      workDate: workDate(timezone, startedAt),
      projectId: entry.projectId,
      projectTaskId: await stillOpenTask(entry),
      note: entry.note ?? null,
      startedAt,
      source: 'timer',
      createdAt: nowDate(),
      updatedAt: nowDate(),
    },
    trx,
  );
  return toEntryView(await repo.findById(id, trx), timezone);
}
