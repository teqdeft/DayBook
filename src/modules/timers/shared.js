// Helpers shared by the timers service files: who may use timers, today's context, the checks
// every write makes, row mapping and input parsing. attendance and timers import each other, so
// other modules are only used inside functions here.
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { dayjs, now, toLocal, workDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import { entryMinutes } from './rules';

const TASK_MESSAGE = 'Pick an open priority task of this project, or none.';

/**
 * Whether the person can use timers at all: active, tracked, and allowed to check in and write
 * reports (employee, HR, tracked Admin; never PMs).
 * @param {{ status?: string, role: string, tracksAttendance?: boolean } | null} user
 * @returns {boolean}
 */
export function canUse(user) {
  return (
    Boolean(user) &&
    user.status === 'active' &&
    Boolean(user.tracksAttendance) &&
    can(user, 'report.self') &&
    can(user, 'attendance.self')
  );
}

/** @throws FORBIDDEN unless the person can use timers */
export function assertWriter(user) {
  if (!canUse(user)) {
    throw new AppError('FORBIDDEN', {
      message: 'Timers are for people who check in and write reports.',
    });
  }
}

/** True when an attendance row is checked in and not closed. */
export function isOpenRow(row) {
  return Boolean(row) && !row.checkOutAt && row.checkoutStatus === 'open';
}

/**
 * Settings, today's company date and the person's attendance row today.
 * @param {number} userId
 * @param {object} [known] settings.getAll(), when the caller has already read it
 * @returns {Promise<{ settings: object, tz: string, date: string, row: object | null,
 *   open: boolean }>}
 */
export async function loadToday(userId, known) {
  const current = known ?? (await settings.getAll());
  const date = workDate(current.timezone);
  const row = (await attendance.getForUserOnDate(userId, date)) ?? null;
  return { settings: current, tz: current.timezone, date, row, open: isOpenRow(row) };
}

/** @throws TIMERS_OFF when Admin turned timers off */
export function assertTimersOn(ctx) {
  if (ctx.settings.timersMode === 'off') throw new AppError('TIMERS_OFF');
}

/** @throws NOT_CHECKED_IN, ALREADY_CHECKED_OUT unless today's row is open */
export function assertCheckedIn(ctx) {
  if (!ctx.row) throw new AppError('NOT_CHECKED_IN');
  if (!ctx.open) throw new AppError('ALREADY_CHECKED_OUT');
}

/** @throws PROJECT_NOT_ACTIVE unless the project exists and is active */
export async function checkProject(projectId) {
  const project = await projects.findById(projectId);
  if (project?.status !== 'active') {
    const message = 'Only active projects can be timed.';
    throw new AppError('PROJECT_NOT_ACTIVE', { message, fields: { projectId: message } });
  }
  return project;
}

/**
 * @throws VALIDATION_FAILED on projectTaskId unless it is an open priority task of the project
 *   that the person can link (null passes)
 */
export async function checkTask({ userId, projectId, projectTaskId }) {
  if (!projectTaskId) return;
  const open = await projectTasks.findOpenForPicker({ userId, projectId });
  if (!open.some((task) => Number(task.id) === Number(projectTaskId))) {
    throw validationError({ projectTaskId: TASK_MESSAGE }, TASK_MESSAGE);
  }
}

export function entryNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that timer." });
}

const iso = (value) => (value ? dayjs(value).toISOString() : null);

/** A 'HH:mm' clock in company time. */
export function clockOf(at, tz) {
  return toLocal(at, tz).format('HH:mm');
}

/**
 * A time_entries row (joined with its project and task) as the contract's EntryView.
 * @param {object} row
 * @param {string} tz
 * @param {Date | import('dayjs').Dayjs} [at] what "now" is for a running entry
 * @returns {{ id, projectId, projectName, projectColor, isUrgent, projectTaskId, priority,
 *   projectTaskTitle, note, startedAt, endedAt, minutes, source, stopReason, startClock,
 *   endClock }}
 */
export function toEntryView(row, tz, at = now()) {
  if (!row) return null;
  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    projectName: row.projectName ?? null,
    projectColor: row.projectColor ?? null,
    isUrgent: Boolean(row.isUrgent),
    projectTaskId: row.projectTaskId ? Number(row.projectTaskId) : null,
    priority: row.projectTaskId ? (row.priority ?? null) : null,
    projectTaskTitle: row.projectTaskId ? (row.projectTaskTitle ?? null) : null,
    note: row.note ?? null,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    minutes: entryMinutes(row, at, tz),
    source: row.source,
    stopReason: row.stopReason ?? null,
    startClock: clockOf(row.startedAt, tz),
    endClock: row.endedAt ? clockOf(row.endedAt, tz) : null,
  };
}

/**
 * Validates service input with a zod schema (routes validate too; services are also called from
 * tests and other modules).
 * @throws VALIDATION_FAILED with a fields map
 */
export function parseInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/** A positive whole id, or null. */
export function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
