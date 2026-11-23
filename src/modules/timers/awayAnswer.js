// Answers to the away question (CONTRACT 25 A): Keep, Remove (saved as an away break in the same
// transaction) and "I had left" (check-out where the away time started). Lock order (CONTRACT
// 15): the attendance row of the timer's own date, then the entry by id (read again under the
// lock, so a Stop or Switch that committed in between is seen). Remove and Keep are not audited.
import { AppError } from '@/lib/errors';
import { emit } from '@/lib/events';
import { dayjs, minutesBetween, now, nowDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { findAway, leftFor } from './away';
import { planRemoval } from './awayRules';
import * as repo from './repo';
import { sameSecond, wholeSecond } from './rules';
import { timerAwaySchema } from './schemas';
import {
  TODAY_ONLY_MESSAGE,
  assertTimersOn,
  assertWriter,
  isOpenRow,
  loadToday,
  parseInput,
} from './shared';
import { forgetAway, getState } from './state';

const CHANGED_MESSAGE = 'That away time changed. Refresh and try again.';

const changed = () => new AppError('CONFLICT', { message: CHANGED_MESSAGE });

/** The entry must be the person's own timer entry of today. @throws BAD_REQUEST */
function assertOwnToday(entry, { user, ctx }) {
  const own = Number(entry.userId) === Number(user.id) && entry.source === 'timer';
  if (!own || entry.workDate !== ctx.date) {
    throw new AppError('BAD_REQUEST', { message: TODAY_ONLY_MESSAGE });
  }
}

/**
 * The split: the entry ends at `from` (stop reason away) and a copy (project, task, note, source)
 * starts at `to`, running when the entry ran (ended first: the running index is unique), else
 * ending at the old end with the old stop reason. The head's updated_at and the copy's
 * created_at come from one `at`, so migration 018's backfill finds a split made before it.
 */
async function split(entry, { from, to }, trx) {
  const at = wholeSecond(nowDate());
  await repo.updateEntry(
    entry.id,
    { endedAt: from, stopReason: 'away', awayCheckedUntil: from, updatedAt: at },
    trx,
  );
  await repo.insertEntry(
    {
      userId: entry.userId,
      workDate: entry.workDate,
      projectId: entry.projectId,
      projectTaskId: entry.projectTaskId ?? null,
      note: entry.note ?? null,
      startedAt: to,
      endedAt: entry.endedAt ?? null,
      source: entry.source,
      stopReason: entry.endedAt ? entry.stopReason : null,
      awayCheckedUntil: to,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}

/** The timer change of a Remove (planRemoval). */
async function changeTimer(entry, plan, { from, to }, trx) {
  const at = nowDate();
  if (plan.kind === 'split') return split(entry, { from, to }, trx);
  if (plan.kind === 'move') {
    return repo.updateEntry(entry.id, { startedAt: to, awayCheckedUntil: to, updatedAt: at }, trx);
  }
  if (plan.kind === 'trim') {
    return repo.updateEntry(
      entry.id,
      { endedAt: from, awayCheckedUntil: from, updatedAt: at },
      trx,
    );
  }
  return repo.removeEntry(entry.id, trx);
}

/**
 * Remove: the time the timer loses is saved as an away break first, then the timer changes.
 * Before migration 018 the break isn't saved: a Remove on a finished entry (1.09 only ever asked
 * about the running one) is refused with UPDATE_NEEDED and nothing changes; on the running entry
 * (always a split or a move) it goes ahead as 1.09. Under the row lock it works out whether the
 * break took today over the allowance (the notice is sent after commit).
 */
async function remove({ entry, row, from, to }, trx) {
  if (!row) throw changed();
  const plan = planRemoval({ entry, from, to });
  const saved = await attendance.saveAwayBreak(
    {
      userId: entry.userId,
      attendanceId: row.id,
      workDate: entry.workDate,
      startedAt: plan.lost.from,
      endedAt: plan.lost.to,
      awayEntryId: plan.kind === 'drop' ? null : entry.id,
    },
    trx,
  );
  if (!saved && entry.endedAt) {
    throw new AppError('UPDATE_NEEDED', {
      status: 503,
      message: 'This needs the latest database update. Ask an Admin.',
    });
  }
  await changeTimer(entry, plan, { from, to }, trx);
  const totals = saved
    ? await attendance.breakTotalsIn(
        { userId: entry.userId, workDate: entry.workDate, breakId: saved.id },
        trx,
      )
    : null;
  return {
    minutes: minutesBetween(plan.lost.from, plan.lost.to),
    savedAsBreak: Boolean(saved),
    breakId: saved ? Number(saved.id) : null,
    totals,
  };
}

/**
 * "I had left": the person is checked out at `from` (attendance.checkOutAtLeft) and the entry
 * ends there (stop reason checkout). No break is saved. An entry left with no time is deleted.
 */
async function leave({ entry, from, ip }, trx) {
  const row = await attendance.checkOutAtLeft(
    { userId: entry.userId, workDate: entry.workDate, at: from, ip },
    trx,
  );
  const at = nowDate();
  if (minutesBetween(entry.startedAt, from) < 1) await repo.removeEntry(entry.id, trx);
  else {
    await repo.updateEntry(
      entry.id,
      { endedAt: from, stopReason: 'checkout', awayCheckedUntil: from, updatedAt: at },
      trx,
    );
  }
  return { checkedOutAt: row.checkOutAt };
}

/** Works the span out again under the locks; it must be the one sent, to the second. */
async function spanAgain({ entry, user, ctx, values }) {
  const found = await findAway({
    entries: [entry],
    userId: user.id,
    workDate: entry.workDate,
    settings: ctx.settings,
    at: now(),
  });
  const same =
    found &&
    sameSecond(found.span.from, dayjs(values.from)) &&
    sameSecond(found.span.to, dayjs(values.to));
  if (!same) throw changed();
  return found;
}

/** One answer inside the transaction. @returns {Promise<object>} the answer's details */
async function answerLocked({ user, ctx, values, ip }, trx) {
  const first = await repo.findById(values.entryId, trx);
  if (!first) throw changed();
  assertOwnToday(first, { user, ctx });
  const row = await attendance.lockDay({ userId: user.id, workDate: first.workDate }, trx);
  if (values.decision === 'left') await attendance.getOpenBreak(user.id, trx, { forUpdate: true });
  const entry = await repo.lockById(values.entryId, trx);
  if (!entry || Number(entry.id) !== values.entryId) throw changed();
  assertOwnToday(entry, { user, ctx });
  const found = await spanAgain({ entry, user, ctx: { ...ctx, row }, values });
  const { from, to } = { from: wholeSecond(found.span.from), to: wholeSecond(found.span.to) };
  if (values.decision === 'keep') {
    await repo.updateEntry(entry.id, { awayCheckedUntil: to, updatedAt: nowDate() }, trx);
    return { minutes: found.span.minutes, wasOpen: isOpenRow(row) };
  }
  if (values.decision === 'remove') return { ...(await remove({ entry, row, from, to }, trx)) };
  const entries = await repo.lockForUserDate(user.id, entry.workDate, trx);
  const offer = await leftFor({ found, entries, user, ctx: { ...ctx, row } });
  if (!offer) throw changed();
  return { ...(await leave({ entry, from, ip }, trx)), wasOpen: isOpenRow(row) };
}

/**
 * Answers the away question the state offered. Keep: the time stays and isn't asked about again.
 * Remove: the time the timer loses is saved as an away break (source 'away') and the timer is
 * split, moved, trimmed or dropped (planRemoval). Left (only when the state offered it): the
 * person is checked out where the away time started and the timer ends there. The span sent must
 * be the one the server works out now, to the second.
 * @param {{ user: object, entryId: number, from: string, to: string,
 *   decision: 'keep' | 'remove' | 'left', ip?: string | null }} input from/to as the state sent
 *   them (ISO)
 * @returns {Promise<object>} getState plus `answer: { decision, minutes, projectName,
 *   savedAsBreak, breakId, checkedOutAt }`
 * @throws FORBIDDEN, TIMERS_OFF, VALIDATION_FAILED, BAD_REQUEST ("Only today's timers can be
 *   changed."), CONFLICT ("That away time changed. Refresh and try again."; "That time overlaps a
 *   break. Keep it, or ask HR."), UPDATE_NEEDED (a Remove on a finished entry before migration
 *   018)
 */
export async function resolveAway({ user, entryId, from, to, decision, ip = null }) {
  assertWriter(user);
  const values = parseInput(timerAwaySchema, { entryId, from, to, decision });
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  const projectName = (await repo.findById(values.entryId))?.projectName ?? null;
  const done = await repo.transaction((trx) => answerLocked({ user, ctx, values, ip }, trx));
  forgetAway(user.id);
  if (done.totals) {
    await attendance.noticeOverAllowance({
      userId: user.id,
      crossed: done.totals.crossed,
      total: done.totals.total,
    });
  }
  if (values.decision === 'left' && done.wasOpen) {
    const row = await attendance.getForUserOnDate(user.id, ctx.date);
    await emit('attendance.checked_out', { row, userId: user.id });
  }
  return {
    ...(await getState({ user })),
    answer: {
      decision: values.decision,
      minutes: done.minutes ?? minutesBetween(values.from, values.to),
      projectName,
      savedAsBreak: Boolean(done.savedAsBreak),
      breakId: done.breakId ?? null,
      checkedOutAt: done.checkedOutAt ? dayjs(done.checkedOutAt).toISOString() : null,
    },
  };
}
