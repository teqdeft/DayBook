// Put back (CONTRACT 25 A): the person's undo of a Remove, from Today. The away break goes and
// the time goes back on the timer when that is still safe (putBackPlan); the person says they
// were working, as Keep would have. Lock order: the attendance row (today), the away break, then
// every entry of the day. No notice.
import { AppError } from '@/lib/errors';
import { minutesBetween, now, nowDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { audit } from '@/modules/audit';
import { putBackPlan } from './awayRules';
import * as repo from './repo';
import { assertTimersOn, assertWriter, loadToday, toId } from './shared';
import { forgetAway, getState } from './state';

const notFound = () =>
  new AppError('NOT_FOUND', { message: "We couldn't find that removed time." });

/** What the audit log keeps of the break. */
const auditBreak = (item) => ({
  breakId: Number(item.id),
  startedAt: item.startedAt,
  endedAt: item.endedAt,
  endReason: item.endReason,
  source: item.source,
});

async function putBackLocked({ user, breakId, ctx }, trx) {
  await attendance.lockDay({ userId: user.id, workDate: ctx.date }, trx);
  const item = await attendance.lockAwayBreak({ userId: user.id, breakId }, trx);
  if (!item || !item.endedAt || item.workDate !== ctx.date) throw notFound();
  if (item.changedById) {
    throw new AppError('CONFLICT', {
      message: 'HR changed this break. Ask HR if it needs fixing.',
    });
  }
  const entries = await repo.lockForUserDate(user.id, ctx.date, trx);
  const plan = putBackPlan({ item, entries, at: now() });
  if (plan) {
    await repo.updateEntry(plan.entryId, { ...plan.changes, updatedAt: nowDate() }, trx);
  }
  await attendance.deleteAwayBreak(item.id, trx);
  await audit.log(
    {
      actorId: user.id,
      action: 'attendance.away_put_back',
      entityType: 'attendance',
      entityId: item.attendanceId,
      before: auditBreak(item),
      after: { breakId: Number(item.id), restored: Boolean(plan) },
    },
    trx,
  );
  const entry = entries.find((row) => Number(row.id) === Number(item.awayEntryId));
  return {
    restored: Boolean(plan),
    minutes: minutesBetween(item.startedAt, item.endedAt),
    projectId: entry ? Number(entry.projectId) : null,
  };
}

/**
 * Puts removed away time back: deletes one of the person's away breaks of today that nobody else
 * changed and, when its entry can safely take the time back, restores the entry to the break's
 * start and end, to the second (the time isn't asked about again).
 * @param {{ user: object, breakId: number | string }} input
 * @returns {Promise<object>} getState plus `answer: { restored, minutes, projectName }`
 *   (restored: false when the entry is gone or was changed by hand, or another entry overlaps)
 * @throws FORBIDDEN, TIMERS_OFF, NOT_FOUND ("We couldn't find that removed time."), CONFLICT
 *   ("HR changed this break. Ask HR if it needs fixing."), UPDATE_NEEDED (before migration 018)
 */
export async function putBackAway({ user, breakId }) {
  assertWriter(user);
  const ctx = await loadToday(user.id);
  assertTimersOn(ctx);
  const id = toId(breakId);
  if (!id) throw notFound();
  const done = await repo.transaction((trx) => putBackLocked({ user, breakId: id, ctx }, trx));
  forgetAway(user.id);
  const state = await getState({ user });
  const project = state.entries.find((entry) => entry.projectId === done.projectId);
  return {
    ...state,
    answer: {
      restored: done.restored,
      minutes: done.minutes,
      projectName: project?.projectName ?? null,
    },
  };
}
