// Changing timer entries by hand (CONTRACT 15): add time, edit and delete. Only the person's own
// entries of today; times are 'HH:mm' clocks on the work date. Each change is audited.
import { AppError, validationError } from '@/lib/errors';
import { dayjs, formatTime, localToUtc, minutesBetween, now, nowDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { audit } from '@/modules/audit';
import * as repo from './repo';
import { firstOverlap, minuteOf } from './rules';
import { timerEntryCreateSchema, timerEntryUpdateSchema } from './schemas';
import {
  assertTimersOn,
  assertWriter,
  checkProject,
  checkTask,
  clockOf,
  entryNotFound,
  loadToday,
  parseInput,
  toEntryView,
  toId,
} from './shared';
import { getState } from './state';

const fail = (field, message) => validationError({ [field]: message }, message);

/** A clock on today's work date as a UTC Date. */
function clockAt(ctx, clock) {
  return localToUtc(ctx.date, clock, ctx.tz).toDate();
}

/**
 * Checks a stretch's times. A running entry only needs a start that isn't in the future.
 * @throws VALIDATION_FAILED on startClock or endClock
 */
function checkTimes({ start, end, at, field = 'endClock' }) {
  if (end === null) {
    if (dayjs(start).isAfter(at)) throw fail('startClock', "Start can't be later than now.");
    return;
  }
  if (!dayjs(start).isBefore(end)) {
    throw field === 'startClock'
      ? fail('startClock', 'Start must be before the end.')
      : fail('endClock', 'End must be after the start.');
  }
  if (dayjs(end).isAfter(at)) throw fail('endClock', "End can't be later than now.");
  if (minutesBetween(start, end) < 1) throw fail('endClock', 'Add at least 1 minute.');
}

/** "9:30 to 10:15", or "running since 9:30". */
function described(item, tz) {
  return item.endedAt
    ? `from ${formatTime(item.startedAt, tz)} to ${formatTime(item.endedAt, tz)}`
    : `since ${formatTime(item.startedAt, tz)}`;
}

/**
 * Compared to the minute (firstOverlap), as the clocks show the stretches.
 * @throws VALIDATION_FAILED on startClock (the start is inside another stretch) or endClock when
 *   [start, end) overlaps another of the person's entries that day or a break
 */
async function checkOverlap({ userId, ctx, span, others, at }) {
  const start = minuteOf(span.start);
  const field = (item) =>
    start >= minuteOf(item.startedAt) && start < minuteOf(item.endedAt ?? at)
      ? 'startClock'
      : 'endClock';
  const entry = firstOverlap(span, others, at);
  if (entry) {
    const name = entry.projectName ?? 'other';
    const what = entry.endedAt ? `your ${name} time` : `your ${name} timer, running`;
    throw fail(field(entry), `That overlaps ${what} ${described(entry, ctx.tz)}.`);
  }
  const breaks = await attendance.listBreaks(userId, ctx.date);
  const found = firstOverlap(span, breaks, at);
  if (found) {
    const what = found.endedAt ? 'your break' : 'your break, on';
    throw fail(field(found), `That overlaps ${what} ${described(found, ctx.tz)}.`);
  }
}

/** What the audit log keeps of an entry. */
function snapshot(view) {
  return {
    projectId: view.projectId,
    projectTaskId: view.projectTaskId,
    note: view.note,
    startedAt: view.startedAt,
    endedAt: view.endedAt,
    source: view.source,
  };
}

async function log({ user, action, entry, before, after, ip }, trx) {
  await audit.log(
    {
      actorId: user.id,
      action,
      entityType: 'time_entry',
      entityId: entry.id,
      before: before ? snapshot(before) : null,
      after: after ? snapshot(after) : null,
      ip,
    },
    trx,
  );
}

/** The person's other entries of the day (locked), with project names for messages. */
async function otherEntries({ userId, ctx, exceptId }, trx) {
  const locked = await repo.lockForUserDate(userId, ctx.date, trx);
  const named = await repo.listForUserDate(userId, ctx.date, trx);
  const names = new Map(named.map((row) => [Number(row.id), row.projectName]));
  return locked
    .filter((row) => Number(row.id) !== exceptId)
    .map((row) => ({ ...row, projectName: names.get(Number(row.id)) ?? null }));
}

/**
 * Adds time by hand (source manual) on today's work date.
 * @param {{ user: object, input: { projectId: number, projectTaskId?: number | null,
 *   note?: string | null, startClock: string, endClock: string }, ip?: string | null }} args
 *   clocks 'HH:mm' in company time
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN, TIMERS_OFF, NOT_CHECKED_IN (no check-in today), PROJECT_NOT_ACTIVE,
 *   VALIDATION_FAILED (projectTaskId, note, startClock / endClock: start before end, end not
 *   after now, at least 1 minute, no overlap with the person's other entries or breaks)
 */
export async function addEntry({ user, input, ip = null }) {
  assertWriter(user);
  const values = parseInput(timerEntryCreateSchema, input);
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  if (!ctx.row) throw new AppError('NOT_CHECKED_IN');
  await checkProject(values.projectId);
  await checkTask({ userId: user.id, ...values });
  const at = now();
  const span = { start: clockAt(ctx, values.startClock), end: clockAt(ctx, values.endClock) };
  checkTimes({ ...span, at });
  await repo.transaction(async (trx) => {
    await attendance.lockDay({ userId: user.id, workDate: ctx.date }, trx);
    const others = await otherEntries({ userId: user.id, ctx }, trx);
    await checkOverlap({ userId: user.id, ctx, span, others, at });
    const stamp = nowDate();
    const id = await repo.insertEntry(
      {
        userId: user.id,
        workDate: ctx.date,
        projectId: values.projectId,
        projectTaskId: values.projectTaskId,
        note: values.note,
        startedAt: span.start,
        endedAt: span.end,
        source: 'manual',
        createdAt: stamp,
        updatedAt: stamp,
      },
      trx,
    );
    const entry = toEntryView(await repo.findById(id, trx), ctx.tz, at);
    await log({ user, action: 'time_entry.create', entry, after: entry, ip }, trx);
  });
  return getState({ user });
}

/**
 * Locks the person's attendance row of today (the order of every timer and break write), then one
 * of their entries of today. @throws NOT_FOUND, BAD_REQUEST
 */
async function lockOwnToday({ user, id, ctx }, trx) {
  await attendance.lockDay({ userId: user.id, workDate: ctx.date }, trx);
  const entryId = toId(id);
  const locked = entryId ? await repo.lockById(entryId, trx) : null;
  if (!locked || Number(locked.userId) !== Number(user.id)) throw entryNotFound();
  if (locked.workDate !== ctx.date) {
    throw new AppError('BAD_REQUEST', { message: "Only today's timers can be changed." });
  }
  return locked;
}

/** The project and task columns an edit changes. */
async function workChanges({ user, locked, values }) {
  const changes = {};
  const projectId =
    values.projectId !== undefined && values.projectId !== Number(locked.projectId)
      ? values.projectId
      : null;
  if (projectId) {
    await checkProject(projectId);
    changes.projectId = projectId;
  }
  const currentTask = locked.projectTaskId ? Number(locked.projectTaskId) : null;
  if (values.projectTaskId !== undefined) {
    // The task already linked may stay even when it is no longer open; a new one must be open.
    if (projectId || values.projectTaskId !== currentTask) {
      await checkTask({
        userId: user.id,
        projectId: projectId ?? Number(locked.projectId),
        projectTaskId: values.projectTaskId,
      });
      if (values.projectTaskId !== currentTask) changes.projectTaskId = values.projectTaskId;
    }
  } else if (projectId && currentTask) {
    changes.projectTaskId = null; // that task belongs to the old project
  }
  if (values.note !== undefined && values.note !== (locked.note ?? null)) {
    changes.note = values.note;
  }
  return changes;
}

/** The time columns an edit changes, checked. Clocks equal to the current ones change nothing. */
function timeChanges({ locked, values, ctx, at }) {
  const running = !locked.endedAt;
  if (running && values.endClock !== undefined) {
    throw fail('endClock', 'A running timer has no end yet. Stop it first to set one.');
  }
  const newStart =
    values.startClock !== undefined && values.startClock !== clockOf(locked.startedAt, ctx.tz);
  const newEnd =
    !running &&
    values.endClock !== undefined &&
    values.endClock !== clockOf(locked.endedAt, ctx.tz);
  if (!newStart && !newEnd) return {};
  const start = newStart ? clockAt(ctx, values.startClock) : locked.startedAt;
  const end = running ? null : newEnd ? clockAt(ctx, values.endClock) : locked.endedAt;
  checkTimes({ start, end, at, field: newEnd ? 'endClock' : 'startClock' });
  return { ...(newStart && { startedAt: start }), ...(newEnd && { endedAt: end }) };
}

/**
 * Edits one of the person's entries of today: project, priority task, note, start and end (only
 * the fields sent). A running entry can change everything but its end.
 * @param {{ user: object, id: number, input: { projectId?, projectTaskId?, note?, startClock?,
 *   endClock? }, ip?: string | null }} args
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN, TIMERS_OFF, NOT_FOUND, BAD_REQUEST ("Only today's timers can be changed."),
 *   PROJECT_NOT_ACTIVE (a newly picked project), VALIDATION_FAILED (as addEntry; endClock on a
 *   running entry)
 */
export async function updateEntry({ user, id, input, ip = null }) {
  assertWriter(user);
  const values = parseInput(timerEntryUpdateSchema, input);
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  const at = now();
  await repo.transaction(async (trx) => {
    const locked = await lockOwnToday({ user, id, ctx }, trx);
    const times = timeChanges({ locked, values, ctx, at });
    const changes = { ...(await workChanges({ user, locked, values })), ...times };
    if (Object.keys(changes).length === 0) return;
    if (times.startedAt || times.endedAt) {
      const span = {
        start: changes.startedAt ?? locked.startedAt,
        end: changes.endedAt ?? locked.endedAt ?? at,
      };
      const others = await otherEntries({ userId: user.id, ctx, exceptId: Number(locked.id) }, trx);
      await checkOverlap({ userId: user.id, ctx, span, others, at });
    }
    const before = toEntryView(await repo.findById(locked.id, trx), ctx.tz, at);
    await repo.updateEntry(locked.id, { ...changes, updatedAt: nowDate() }, trx);
    const after = toEntryView(await repo.findById(locked.id, trx), ctx.tz, at);
    await log({ user, action: 'time_entry.update', entry: after, before, after, ip }, trx);
  });
  return getState({ user });
}

/**
 * Deletes one of the person's entries of today (a running one too: the timer is gone).
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN, TIMERS_OFF, NOT_FOUND, BAD_REQUEST ("Only today's timers can be changed.")
 */
export async function removeEntry({ user, id, ip = null }) {
  assertWriter(user);
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  await repo.transaction(async (trx) => {
    const locked = await lockOwnToday({ user, id, ctx }, trx);
    const before = toEntryView(await repo.findById(locked.id, trx), ctx.tz);
    await repo.removeEntry(locked.id, trx);
    await log({ user, action: 'time_entry.delete', entry: before, before, ip }, trx);
  });
  return getState({ user });
}
