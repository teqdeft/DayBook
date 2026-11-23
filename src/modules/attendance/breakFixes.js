// HR's break list and break fixes (CONTRACT 25, item 2): everyone with attendance.view_all reads
// a row's breaks; HR and Admins (attendance.correct) change a break's end or delete it, with a
// reason, audited on the attendance row, and the person is told. Never someone's own row, and an
// Admin's row looks missing to anyone but an Admin. A fix never touches a timer (an open break
// that HR ends doesn't resume the timer it paused) and never sends the allowance notice.
import { AppError, validationError } from '@/lib/errors';
import { emit } from '@/lib/events';
import { can } from '@/lib/permissions';
import {
  dayjs,
  formatDayShort,
  formatTime,
  formatTimeAmPm,
  minutesBetween,
  now,
  toLocal,
} from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { users } from '@/modules/users';
import * as breakRepo from './breakRepo';
import { breakListDescription, clockWords, toBreakView } from './breakView';
import { assertNotSelf, requireReason } from './hr';
import { guard018Write } from './migration018';
import * as repo from './repo';
import {
  breakMinutesWithin,
  clockOn,
  isOpenRow,
  nowToSecond,
  showsAttendanceOf,
  todayFor,
} from './rules';
import { tellPerson } from './tellPerson';

/** At most this many breaks in one list (Limits). */
export const MAX_BREAKS = 50;

const fail = (message) => validationError({ endClock: message }, message);
const minuteOf = (value) => Math.floor(dayjs(value).valueOf() / 60_000);
const clockOf = (at, tz) => toLocal(at, tz).format('HH:mm');

function rowNotFound() {
  return new AppError('NOT_FOUND', { message: 'That attendance row no longer exists.' });
}

/** @throws FORBIDDEN unless the actor may change attendance (HR, Admin) */
function assertCorrector(actor) {
  if (!can(actor, 'attendance.correct')) throw new AppError('FORBIDDEN');
}

/** The people who changed these breaks, by id. */
async function changers(items) {
  const ids = [...new Set(items.map((item) => Number(item.changedById)).filter(Boolean))];
  if (ids.length === 0) return new Map();
  return new Map((await users.findByIds(ids)).map((person) => [Number(person.id), person]));
}

/**
 * The BreakList of a row, as the viewer sees it.
 * @returns {Promise<object>} see listBreaksForRow
 */
async function breakList({ viewer, row, person }) {
  const [current, read] = await Promise.all([
    settings.getAll(),
    breakRepo.readWithBreakColumns((columns) =>
      breakRepo.listByUserDate(columns, {
        userId: row.userId,
        workDate: row.workDate,
        limit: MAX_BREAKS,
      }),
    ),
  ]);
  const items = read.rows.filter((item) => Number(item.attendanceId) === Number(row.id));
  const names = await changers(items);
  const at = now();
  const tz = current.timezone;
  const isToday = row.workDate === todayFor(current);
  const breakMinutes = breakMinutesWithin(items, row, at, tz);
  const allowance = Number(current.breakAllowanceMinutes) || 0;
  const overAllowanceMinutes = allowance > 0 ? Math.max(0, breakMinutes - allowance) : 0;
  const open = items.find((item) => !item.endedAt);
  const since = isToday && isOpenRow(row) && open ? open.startedAt : null;
  const ownRow = Number(viewer.id) === Number(row.userId);
  const canCorrect = can(viewer, 'attendance.correct');
  const dayLabel = formatDayShort(row.workDate);
  return {
    attendanceId: Number(row.id),
    workDate: row.workDate,
    dayLabel,
    isToday,
    person: { id: Number(person.id), name: person.name },
    breakMinutes,
    overAllowanceMinutes,
    onBreakSince: since ? dayjs(since).toISOString() : null,
    description: breakListDescription({
      dayLabel,
      sinceClock: since ? formatTime(since, tz) : null,
      breakMinutes,
      overAllowanceMinutes,
      count: items.length,
    }),
    canCorrect,
    canChange: canCorrect && !ownRow && read.available,
    ownRow,
    needsUpdate: !read.available,
    breaks: items.map((item) =>
      toBreakView(item, { tz, at, changedBy: names.get(Number(item.changedById)) ?? null }),
    ),
  };
}

/**
 * Every break of one attendance row, oldest first (at most 50), for anyone who sees Attendance.
 * @param {{ viewer: object, attendanceId: number }} input
 * @returns {Promise<{ attendanceId, workDate, dayLabel, isToday, person: { id, name },
 *   breakMinutes, overAllowanceMinutes, onBreakSince: string | null, description: string,
 *   canCorrect, canChange, ownRow, needsUpdate, breaks: Array<{ id, startedAt, endedAt,
 *   startClock, endClock, minutes, open, source, endReason, label, note,
 *   changedBy: { id, name } | null }> }>} canChange: HR or Admin, not their own row, after 018;
 *   needsUpdate: before migration 018 (every break reads as the person's own)
 * @throws NOT_FOUND (no row, or an Admin's row for a non-Admin)
 */
export async function listBreaksForRow({ viewer, attendanceId }) {
  const row = await repo.findById(attendanceId);
  const person = row && (await users.findById(row.userId));
  if (!row || !person || !showsAttendanceOf(viewer, person)) throw rowNotFound();
  return breakList({ viewer, row, person });
}

/**
 * Locks the row by primary key, then the break, then reads the day's other breaks.
 * @throws NOT_FOUND, FORBIDDEN (own row), UPDATE_NEEDED (before 018)
 */
async function lockForFix({ actor, attendanceId, breakId }, trx) {
  const row = await repo.findById(attendanceId, trx, { forUpdate: true });
  const person = row && (await users.findById(row.userId));
  if (!row || !person || !showsAttendanceOf(actor, person)) throw rowNotFound();
  assertNotSelf(actor, row.userId);
  const item = await guard018Write('breaks', () => breakRepo.lockDetail(breakId, trx));
  if (!item || Number(item.attendanceId) !== Number(row.id)) {
    throw new AppError('NOT_FOUND', { message: 'That break no longer exists.' });
  }
  const others = (await repo.listBreaksByUserDate(row.userId, row.workDate, trx)).filter(
    (other) => Number(other.id) !== Number(item.id),
  );
  return { row, person, item, others };
}

/** "That overlaps another break (2:00 to 2:15 PM)." for the first one the new end runs into. */
function checkOverlap({ item, end, others, at, tz }) {
  const from = minuteOf(item.startedAt);
  const to = minuteOf(end);
  const found = others.find(
    (other) => from < minuteOf(other.endedAt ?? at) && to > minuteOf(other.startedAt),
  );
  if (!found) return;
  const words = found.endedAt
    ? clockWords(clockOf(found.startedAt, tz), clockOf(found.endedAt, tz))
    : `since ${formatTimeAmPm(found.startedAt, tz)}`;
  throw fail(`That overlaps another break (${words}).`);
}

/** A break never runs into tracked work: the first timer that starts after the break's start. */
function checkTimers({ item, end, entries, tz }) {
  const later = entries
    .filter((entry) => dayjs(entry.startedAt).isAfter(item.startedAt))
    .sort((a, b) => dayjs(a.startedAt).valueOf() - dayjs(b.startedAt).valueOf())[0];
  if (later && minuteOf(end) > minuteOf(later.startedAt)) {
    const clock = formatTimeAmPm(later.startedAt, tz);
    throw fail(`A timer started at ${clock}. Pick ${clock} or earlier.`);
  }
}

/** The new end as a Date, checked. @throws VALIDATION_FAILED on endClock */
function checkNewEnd({ row, item, others, entries, endClock, current }) {
  const tz = current.timezone;
  const at = now();
  const end = clockOn(row.workDate, endClock, current);
  if (!dayjs(end).isAfter(item.startedAt)) throw fail('End must be after the start.');
  if (minutesBetween(item.startedAt, end) < 1) throw fail('Add at least 1 minute.');
  if (dayjs(end).isAfter(at)) throw fail("That time hasn't come yet.");
  if (row.checkOutAt && dayjs(end).isAfter(row.checkOutAt)) {
    throw fail(`The break must end by the check-out (${formatTimeAmPm(row.checkOutAt, tz)}).`);
  }
  if (item.endedAt && clockOf(item.endedAt, tz) === endClock) {
    throw fail("That's already the end time.");
  }
  checkOverlap({ item, end, others, at, tz });
  checkTimers({ item, end, entries, tz });
  return end;
}

/** What the audit log keeps of a break. */
const auditBreak = (item) =>
  item && {
    breakId: Number(item.id),
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    endReason: item.endReason,
    source: item.source,
  };

async function logFix({ actor, action, row, before, after, reason, ip }, trx) {
  await audit.log(
    {
      actorId: actor.id,
      action,
      entityType: 'attendance',
      entityId: row.id,
      before: auditBreak(before),
      after: auditBreak(after),
      reason,
      ip,
    },
    trx,
  );
}

/** After commit: other caches of that person's day (the timer state, suggested check-outs). */
async function afterFix(row) {
  timers.forgetAway(Number(row.userId));
  await emit('attendance.break_fixed', {
    attendanceId: Number(row.id),
    userId: Number(row.userId),
    workDate: row.workDate,
  });
}

/**
 * HR changes a break's end ("Change end", or "End break" for one still open: this is how a
 * forgotten break is ended; its paused timer is not resumed).
 * @param {{ actor: object, attendanceId: number, breakId: number, endClock: string,
 *   reason: string, ip?: string | null }} input endClock 'HH:mm' on the row's work date
 * @returns {Promise<object>} the BreakList (listBreaksForRow) after the change
 * @throws FORBIDDEN (not HR or Admin, or their own row), NOT_FOUND, UPDATE_NEEDED (before 018),
 *   VALIDATION_FAILED (reason; endClock: "End must be after the start.", "Add at least 1
 *   minute.", "That time hasn't come yet.", "The break must end by the check-out (6:30 PM).",
 *   "That's already the end time.", "That overlaps another break (2:00 to 2:15 PM).", "A timer
 *   started at 2:00 PM. Pick 2:00 PM or earlier.")
 */
export async function changeBreakEnd({
  actor,
  attendanceId,
  breakId,
  endClock,
  reason,
  ip = null,
}) {
  const why = requireReason(reason);
  assertCorrector(actor);
  const current = await settings.getAll();
  const done = await repo.transaction(async (trx) => {
    const { row, person, item, others } = await lockForFix({ actor, attendanceId, breakId }, trx);
    const entries = await timers.listEntriesFor(row.userId, row.workDate);
    const end = checkNewEnd({ row, item, others, entries, endClock, current });
    const changedAt = nowToSecond();
    await breakRepo.setEndByHr(item.id, { endedAt: end, changedById: actor.id, changedAt }, trx);
    const after = { ...item, endedAt: end, endReason: 'hr' };
    await logFix(
      { actor, action: 'attendance.break_change', row, before: item, after, reason: why, ip },
      trx,
    );
    await tellPerson(
      { userId: row.userId, actor, workDate: row.workDate, what: 'changed a break in' },
      trx,
    );
    return { row, person };
  });
  await afterFix(done.row);
  return breakList({ viewer: actor, row: await repo.findById(done.row.id), person: done.person });
}

/**
 * HR deletes a break (an open one too); its time counts as worked again.
 * @param {{ actor: object, attendanceId: number, breakId: number, reason: string,
 *   ip?: string | null }} input
 * @returns {Promise<object>} the BreakList after the change
 * @throws FORBIDDEN, NOT_FOUND, UPDATE_NEEDED, VALIDATION_FAILED (reason)
 */
export async function deleteBreak({ actor, attendanceId, breakId, reason, ip = null }) {
  const why = requireReason(reason);
  assertCorrector(actor);
  const done = await repo.transaction(async (trx) => {
    const { row, person, item } = await lockForFix({ actor, attendanceId, breakId }, trx);
    await breakRepo.deleteBreak(item.id, trx);
    await logFix(
      { actor, action: 'attendance.break_delete', row, before: item, after: null, reason: why, ip },
      trx,
    );
    await tellPerson(
      { userId: row.userId, actor, workDate: row.workDate, what: 'deleted a break from' },
      trx,
    );
    return { row, person };
  });
  await afterFix(done.row);
  return breakList({ viewer: actor, row: await repo.findById(done.row.id), person: done.person });
}
