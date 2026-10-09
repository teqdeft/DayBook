// Shared set-up for the timer service tests (CONTRACT 15): clocks on the test day in Kolkata time
// and direct inserts for entries, priority tasks, screen-time segments and breaks.
import { db } from '@/lib/db';
import { localToUtc, setNowForTests } from '@/lib/time';

export const TZ = 'Asia/Kolkata';
/** Wednesday, a working day. */
export const TODAY = '2026-09-30';
export const YESTERDAY = '2026-09-29';

/** A local clock ('10:30') on a date as a UTC Date. */
export const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();

/** Pins now to a local clock on a date ('10:30:20' works too). */
export function setClock(clock, date = TODAY) {
  const [hm, seconds = '0'] = [clock.slice(0, 5), clock.slice(6)];
  setNowForTests(
    localToUtc(date, hm, TZ)
      .add(Number(seconds) || 0, 'second')
      .toISOString(),
  );
}

/** A time_entries row straight into the database; `to` null means running. */
export async function insertEntry(user, project, options = {}) {
  const { date = TODAY, from, to = null, ...rest } = options;
  const [id] = await db('timeEntries').insert({
    userId: user.id,
    workDate: date,
    projectId: project.id,
    projectTaskId: null,
    note: null,
    startedAt: at(from, date),
    endedAt: to ? at(to, date) : null,
    source: 'timer',
    stopReason: to ? 'stopped' : null,
    ...rest,
  });
  return id;
}

/** A priority task on a project (open, for anyone, P1 unless overridden). */
export async function addTask(project, creator, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title: 'Fix login timeout',
    priority: 'p1',
    status: 'open',
    assigneeId: null,
    createdBy: creator.id,
    updatedBy: creator.id,
    ...overrides,
  });
  return id;
}

/** One screen-time segment between two local clocks (Idle Detection unless `source` says). */
export async function addSegment(user, state, from, to, date = TODAY, source = 'system') {
  await db('activitySegments').insert({
    userId: user.id,
    workDate: date,
    state,
    source,
    startedAt: at(from, date),
    endedAt: at(to, date),
  });
}

/** A BreakRow-shaped object for stubbing the attendance break reads. */
export function breakRow(user, from, to = null, date = TODAY) {
  return {
    id: 1,
    userId: user.id,
    attendanceId: 1,
    workDate: date,
    startedAt: at(from, date),
    endedAt: to ? at(to, date) : null,
    endReason: to ? 'self' : null,
    pausedEntryId: null,
  };
}

/** The person's time_entries rows, oldest id first. */
export function entriesOf(user) {
  return db('timeEntries').where({ userId: user.id }).orderBy('id');
}

/** The rejection of a promise (fails the test when it resolves). */
export async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to fail');
}
