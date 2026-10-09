// Away time (CONTRACT 15): while a timer runs, idle or locked screen time of at least
// timerAwayMinutes is offered once, "keep this time or remove it?". Only the running entry is
// checked, and only when screen time is recorded with Idle Detection (window-only screen time
// never counts as away; see awaySpans).
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { dayjs, minutesBetween, nowDate, workDate } from '@/lib/time';
import { activity } from '@/modules/activity';
import * as repo from './repo';
import { findAwaySpan, sameSecond, wholeSecond } from './rules';
import { timerAwaySchema } from './schemas';
import { assertTimersOn, assertWriter, clockOf, loadToday, parseInput } from './shared';
import { getState } from './state';

const CHANGED_MESSAGE = 'That away time changed. Refresh and try again.';

/**
 * The away span to ask about for a running entry, or null (tracking off, no Idle Detection screen
 * time, nothing long enough that has ended).
 * @param {{ id: number, userId: number, workDate: string, startedAt: Date,
 *   awayCheckedUntil: Date | null, projectName?: string }} entry the running entry
 * @param {{ settings: object, tz: string }} ctx
 * @param {Date | import('dayjs').Dayjs} at
 * @returns {Promise<{ entryId, from, to, minutes, fromClock, toClock, projectName } | null>}
 *   from/to as Dates
 */
export async function findAway(entry, ctx, at) {
  if (!entry || entry.endedAt || !ctx.settings.activityTrackingEnabled) return null;
  const day = await activity.getDay(entry.userId, entry.workDate);
  const span = findAwaySpan({
    segments: day.segments,
    startedAt: entry.startedAt,
    checkedUntil: entry.awayCheckedUntil,
    at,
    minMinutes: ctx.settings.timerAwayMinutes,
  });
  if (!span) return null;
  return {
    entryId: Number(entry.id),
    from: span.from,
    to: span.to,
    minutes: span.minutes,
    fromClock: clockOf(span.from, ctx.tz),
    toClock: clockOf(span.to, ctx.tz),
    projectName: entry.projectName ?? null,
  };
}

/**
 * findAway for the state: ISO times, and a failure only logs a warning (the state never fails
 * because of screen time).
 */
export async function awayForState(entry, ctx, at) {
  try {
    const away = await findAway(entry, ctx, at);
    if (!away) return null;
    return { ...away, from: away.from.toISOString(), to: away.to.toISOString() };
  } catch (error) {
    logger.warn({ err: error, entryId: entry?.id }, 'away time could not be worked out');
    return null;
  }
}

/**
 * Remove: the running entry ends at `from` and an identical one runs from `to`. When that would
 * leave less than a minute before `from` (away from the timer's first minute), the running entry
 * starts at `to` instead, so no empty entry is left behind.
 */
async function removeAwayTime({ running, away, ctx }, trx) {
  const at = nowDate();
  const to = wholeSecond(away.to);
  if (minutesBetween(running.startedAt, away.from) < 1) {
    const moved = { workDate: workDate(ctx.tz, to), startedAt: to, awayCheckedUntil: to };
    await repo.updateEntry(running.id, { ...moved, updatedAt: at }, trx);
    return;
  }
  await repo.endRunning(
    running.id,
    { endedAt: wholeSecond(away.from), stopReason: 'away', updatedAt: at },
    trx,
  );
  await repo.insertEntry(
    {
      userId: running.userId,
      workDate: workDate(ctx.tz, to),
      projectId: running.projectId,
      projectTaskId: running.projectTaskId ?? null,
      note: running.note ?? null,
      startedAt: to,
      source: running.source,
      awayCheckedUntil: to,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}

/**
 * Answers an away prompt. Keep: the time stays and is not asked about again. Remove: the running
 * timer ends where the away time started (stop reason away) and an identical timer runs from where
 * it ended; away time from the timer's first minute only moves its start. The span sent must be the one the server works out now, to the second.
 * @param {{ user: object, entryId: number, from: string, to: string,
 *   decision: 'keep' | 'remove' }} input from/to as the state sent them (ISO)
 * @returns {Promise<object>} getState
 * @throws FORBIDDEN, TIMERS_OFF, VALIDATION_FAILED, CONFLICT ("That away time changed. Refresh
 *   and try again.": that timer no longer runs, or the span is not the one worked out now)
 */
export async function resolveAway({ user, entryId, from, to, decision }) {
  assertWriter(user);
  const values = parseInput(timerAwaySchema, { entryId, from, to, decision });
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  await repo.transaction(async (trx) => {
    const running = await repo.findRunningForUpdate(user.id, trx);
    const away =
      running && Number(running.id) === values.entryId
        ? await findAway(running, ctx, nowDate())
        : null;
    const matches =
      away && sameSecond(away.from, dayjs(values.from)) && sameSecond(away.to, dayjs(values.to));
    if (!matches) throw new AppError('CONFLICT', { message: CHANGED_MESSAGE });
    if (values.decision === 'keep') {
      await repo.updateEntry(
        running.id,
        { awayCheckedUntil: wholeSecond(away.to), updatedAt: nowDate() },
        trx,
      );
    } else {
      await removeAwayTime({ running, away, ctx }, trx);
    }
  });
  return getState({ user });
}
