// "I had left, check me out at 6:42 PM" (CONTRACT 25 A): the away question about time after the
// person's day end offers to check them out where the away time started. The timers module calls
// this inside its transaction (after attendance.lockDay and the open break), then ends the timer.
import { AppError } from '@/lib/errors';
import { dayjs, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { lockDay } from './breaks';
import { auditView } from './hr';
import * as repo from './repo';
import { isOpenRow } from './rules';

const CHANGED_MESSAGE = 'That away time changed. Refresh and try again.';

const changed = () => new AppError('CONFLICT', { message: CHANGED_MESSAGE });

/** Ends a break still open today at `at` (as check-out does), never before its start. */
async function endOpenBreakAt({ userId, workDate, at }, trx) {
  const open = await repo.findOpenBreak(userId, trx, { forUpdate: true });
  if (!open || open.workDate !== workDate) return;
  const endedAt = dayjs(at).isBefore(open.startedAt) ? open.startedAt : at;
  await repo.endBreakRow(open.id, { endedAt, endReason: 'checkout', updatedAt: nowDate() }, trx);
}

/**
 * Checks the person out at `at`: closes their open row of that date there ('checked_out', the
 * request's IP), or moves their own check-out back to it. A break still open ends there too.
 * Audited as attendance.away_checkout (the person is the actor). Inside the caller's transaction.
 * @param {{ userId: number, workDate: string, at: Date, ip?: string | null }} input at: whole
 *   seconds, the away span's start
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<AttendanceRow>} the row after the change
 * @throws CONFLICT ("That away time changed. Refresh and try again.") when the row is gone, was
 *   closed by anyone but the person's own check-out, or the check-out is before `at`
 */
export async function checkOutAtLeft({ userId, workDate, at, ip = null }, trx) {
  const row = await lockDay({ userId, workDate }, trx);
  if (!row || dayjs(at).isBefore(row.checkInAt)) throw changed();
  const stamp = nowDate();
  if (isOpenRow(row)) {
    const closed = await repo.closeOpenRow(
      row.id,
      {
        checkOutAt: at,
        checkOutIp: ip ? String(ip).slice(0, 45) : null,
        checkoutStatus: 'checked_out',
        updatedAt: stamp,
      },
      trx,
    );
    if (closed === 0) throw changed();
  } else {
    const own = row.checkoutStatus === 'checked_out' && row.checkOutAt;
    if (!own || dayjs(row.checkOutAt).isBefore(at)) throw changed();
    await repo.updateRow(row.id, { checkOutAt: at, updatedAt: stamp }, trx);
  }
  await endOpenBreakAt({ userId, workDate, at }, trx);
  const after = await repo.findById(row.id, trx);
  await audit.log(
    {
      actorId: userId,
      action: 'attendance.away_checkout',
      entityType: 'attendance',
      entityId: row.id,
      before: auditView(row),
      after: auditView(after),
      ip,
    },
    trx,
  );
  return after;
}
