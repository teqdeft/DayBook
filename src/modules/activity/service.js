// The activity module (screen time, CONTRACT section 11): turns heartbeats from the Daybook app
// into active / idle / locked segments and reads them back per person, per day and for the team.
// Only tracked people with activity.self are recorded; nothing about apps or sites is stored.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';
import { dayjs, monthOf, monthRange, nowDate, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import * as repo from './repo';
import { heartbeatSchema, MAX_RANGE_DAYS } from './schemas';
import {
  currentStateOf,
  latestSegment,
  minutesFromSeconds,
  planHeartbeat,
  summarizeSegments,
  wholeSecond,
} from './segments';

const RETRY_ERRNOS = new Set([1213, 1205]); // deadlock, lock wait timeout

/** zod result -> VALIDATION_FAILED with a message per field. */
function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/** Two devices reporting at the same moment can deadlock on the latest row: try again. */
async function withRetry(run, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !RETRY_ERRNOS.has(error?.errno)) throw error;
    }
  }
}

const toSegment = ({ state, source, startedAt, endedAt }) => ({
  state,
  source,
  startedAt,
  endedAt,
});

async function applyPlan(plan, { userId, state }, trx) {
  if (plan.action === 'extend') {
    await repo.setEndedAt(plan.id, plan.endedAt, trx);
    return { state, segmentId: plan.id };
  }
  if (plan.action === 'keep') return { state: plan.state, segmentId: plan.id };
  if (plan.close) await repo.setEndedAt(plan.close.id, plan.close.endedAt, trx);
  const segmentId = await repo.insertSegment({ userId, ...plan.segment }, trx);
  return { state: plan.segment.state, segmentId };
}

/**
 * Records one report from the Daybook app (server time decides the segment's start and end; see
 * planHeartbeat for the rules). A no-op when screen time is turned off in Settings.
 * @param {{ user: { id: number, role: string, status?: string, tracksAttendance: boolean },
 *   state: 'active' | 'idle' | 'locked', source?: 'system' | 'window' }} input
 * @returns {Promise<{ state: 'active' | 'idle' | 'locked' | 'off', segmentId: number | null }>}
 *   state: what was recorded (another device's busier state can win), 'off' when tracking is off
 * @throws FORBIDDEN unless the person has activity.self and is tracked (never PMs),
 *   VALIDATION_FAILED for an unknown state or source
 */
export async function recordHeartbeat({ user, state, source }) {
  if (!user || !can(user, 'activity.self') || !user.tracksAttendance) {
    throw new AppError('FORBIDDEN', {
      message: 'Screen time is only recorded for people who check in.',
    });
  }
  const input = parseInput(heartbeatSchema, { state, source });
  const current = await settings.getAll();
  if (!current.activityTrackingEnabled) return { state: 'off', segmentId: null };
  const at = wholeSecond(nowDate());
  const result = await withRetry(() =>
    db.transaction(async (trx) => {
      const latest = await repo.findLatestForUpdate(user.id, trx);
      const plan = planHeartbeat({ latest, ...input, at, tz: current.timezone });
      return {
        action: plan.action,
        ...(await applyPlan(plan, { userId: user.id, ...input }, trx)),
      };
    }),
  );
  logger.debug({ userId: user.id, ...input, action: result.action }, 'activity heartbeat');
  return { state: result.state, segmentId: result.segmentId };
}

/**
 * One person's screen time on one work date.
 * @param {number} userId
 * @param {string} date 'YYYY-MM-DD' (company date)
 * @returns {Promise<{ workDate: string, activeMinutes: number, idleMinutes: number,
 *   lockedMinutes: number, firstActiveAt: Date | null, lastActiveAt: Date | null,
 *   lastSeenAt: Date | null, source: 'system' | 'window' | null,
 *   segments: Array<{ state: string, source: string, startedAt: Date, endedAt: Date }> }>}
 *   segments in time order; source is the latest segment's
 */
export async function getDay(userId, date) {
  const segments = (await repo.listForUserDate(userId, date)).map(toSegment);
  return { workDate: date, ...summarizeSegments(segments), segments };
}

function dayFromRows(date, rows) {
  const seconds = { active: 0, idle: 0, locked: 0 };
  let firstActiveAt = null;
  let lastSeenAt = null;
  for (const row of rows) {
    if (row.state in seconds) seconds[row.state] += Number(row.seconds) || 0;
    if (row.state === 'active') firstActiveAt = row.firstStartedAt;
    if (!lastSeenAt || new Date(row.lastEndedAt) > new Date(lastSeenAt)) {
      lastSeenAt = row.lastEndedAt;
    }
  }
  return {
    workDate: date,
    activeMinutes: minutesFromSeconds(seconds.active),
    idleMinutes: minutesFromSeconds(seconds.idle),
    lockedMinutes: minutesFromSeconds(seconds.locked),
    firstActiveAt,
    lastSeenAt,
  };
}

/**
 * One person's screen time per day over a range (one query).
 * @param {number} userId
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD', inclusive
 * @returns {Promise<{ days: Array<{ workDate: string, activeMinutes: number, idleMinutes: number,
 *   lockedMinutes: number, firstActiveAt: Date | null, lastSeenAt: Date | null }>,
 *   totals: { activeMinutes: number, idleMinutes: number, lockedMinutes: number,
 *   daysWithData: number } }>} days: only days with data, oldest first
 */
export async function getRange(userId, from, to) {
  const totals = { activeMinutes: 0, idleMinutes: 0, lockedMinutes: 0, daysWithData: 0 };
  if (!from || !to || from > to) return { days: [], totals };
  const byDay = new Map();
  for (const row of await repo.sumByDayAndState(userId, from, to)) {
    if (!byDay.has(row.workDate)) byDay.set(row.workDate, []);
    byDay.get(row.workDate).push(row);
  }
  const days = [...byDay].map(([date, rows]) => dayFromRows(date, rows));
  for (const day of days) {
    totals.activeMinutes += day.activeMinutes;
    totals.idleMinutes += day.idleMinutes;
    totals.lockedMinutes += day.lockedMinutes;
  }
  totals.daysWithData = days.length;
  return { days, totals };
}

function teamUser(row) {
  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    designation: row.designation ?? '',
    departmentName: row.departmentName ?? null,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatarUrl ?? null,
    initials: initials(row.name),
  };
}

/**
 * Every active tracked person's screen time on one work date, by name (one query).
 * @param {string} date 'YYYY-MM-DD'
 * @returns {Promise<Array<{ user: { id: number, name: string, email: string, designation: string,
 *   departmentName: string | null, role: string, status: string, avatarUrl: string | null,
 *   initials: string }, currentState: 'active' | 'idle' | 'locked' | 'offline',
 *   lastSeenAt: Date | null, activeMinutes: number, idleMinutes: number, lockedMinutes: number,
 *   firstActiveAt: Date | null, lastActiveAt: Date | null, source: 'system' | 'window' | null,
 *   segments: Array<{ state: string, source: string, startedAt: Date, endedAt: Date }> }>>}
 *   currentState is 'offline' when the last report is older than 150 s or `date` isn't today
 */
export async function getTeamDay(date) {
  const [rows, current] = await Promise.all([repo.listTeamDay(date), settings.getAll()]);
  const at = nowDate();
  const today = workDate(current.timezone, at);
  const people = new Map();
  for (const row of rows) {
    if (!people.has(row.userId)) people.set(row.userId, { user: teamUser(row), segments: [] });
    if (row.segmentId) people.get(row.userId).segments.push(toSegment(row));
  }
  return [...people.values()].map(({ user, segments }) => {
    const latest = latestSegment(segments);
    const summary = summarizeSegments(segments);
    return {
      user,
      currentState: currentStateOf(latest && { ...latest, workDate: date }, { at, today }),
      ...summary,
      segments,
    };
  });
}

/**
 * Deletes screen time of work dates before `date` (the cleanup job passes today minus
 * settings.activityRetentionDays).
 * @param {string} date 'YYYY-MM-DD'
 * @returns {Promise<number>} rows deleted
 */
export function deleteOlderThan(date) {
  return repo.deleteBefore(date);
}

/**
 * Fills in a missing date with today's company date.
 * @param {string | undefined} date
 * @returns {Promise<string>} 'YYYY-MM-DD'
 */
export async function resolveDate(date) {
  if (date) return date;
  return workDate((await settings.getAll()).timezone);
}

/**
 * Fills in a range: `to` defaults to today, `from` to the first day of `to`'s month.
 * @param {{ from?: string, to?: string }} range
 * @returns {Promise<{ from: string, to: string }>}
 * @throws VALIDATION_FAILED when from is after to or the range is longer than 366 days
 */
export async function resolveRange({ from, to } = {}) {
  const end = to ?? workDate((await settings.getAll()).timezone);
  const start = from ?? monthRange(monthOf(end)).from;
  if (start > end) {
    const message = 'The start date must be on or before the end date.';
    throw validationError({ from: message }, message);
  }
  if (dayjs(end, 'YYYY-MM-DD').diff(dayjs(start, 'YYYY-MM-DD'), 'day') >= MAX_RANGE_DAYS) {
    const message = `Pick at most ${MAX_RANGE_DAYS} days.`;
    throw validationError({ to: message }, message);
  }
  return { from: start, to: end };
}

/**
 * The signed-in person's own screen time (GET /api/activity/me).
 * @param {{ user: { id: number }, from?: string, to?: string }} input
 * @returns {Promise<{ from: string, to: string } & Awaited<ReturnType<typeof getRange>>>}
 * @throws VALIDATION_FAILED for a bad range
 */
export async function getMyRange({ user, from, to }) {
  const range = await resolveRange({ from, to });
  return { ...range, ...(await getRange(user.id, range.from, range.to)) };
}

/**
 * Someone's screen time for PMs and Admin (GET /api/activity/users/[id]).
 * @param {{ userId: number, from?: string, to?: string }} input
 * @returns {Promise<{ user: { id: number, name: string, designation: string,
 *   departmentName: string | null, role: string, status: string, tracksAttendance: boolean,
 *   initials: string }, from: string, to: string } & Awaited<ReturnType<typeof getRange>>>}
 * @throws NOT_FOUND for an unknown person, VALIDATION_FAILED for a bad range
 */
export async function getUserRange({ userId, from, to }) {
  const person = await users.findById(userId);
  if (!person) throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  const range = await resolveRange({ from, to });
  const { id, name, designation, departmentName, role, status, tracksAttendance } = person;
  return {
    user: {
      id,
      name,
      designation,
      departmentName,
      role,
      status,
      tracksAttendance,
      initials: person.initials,
    },
    ...range,
    ...(await getRange(person.id, range.from, range.to)),
  };
}
