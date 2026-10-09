// Check-out (guide 7.3, CONTRACT 15): one transaction closes today's row, ends an open break and
// stops a running timer at the same moment. `timers` is only used inside functions (import cycle).
import { AppError } from '@/lib/errors';
import { emit } from '@/lib/events';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { endOpenBreak } from './breaks';
import * as repo from './repo';
import { breakMinutesWithin, nowToSecond, presentMinutes, todayFor } from './rules';

/**
 * Checks the person out of today's open check-in at the server's time. Always checks out; the
 * result says whether today's report is still to write and how far worked time and logged hours
 * are apart (a warning only, guide 7.3). An open break ends ('checkout', at the check-out time)
 * and a running timer stops (timers.stopRunning, reason 'checkout') in the same transaction.
 * @param {{ user: { id: number }, ip?: string | null }} input
 * @returns {Promise<{ row: AttendanceRow, reportPending: boolean, reportStatus: string,
 *   presentMinutes: number, breakMinutes: number, workedMinutes: number, loggedMinutes: number,
 *   gapMinutes: number, gapWarning: boolean }>} workedMinutes = present - breaks;
 *   gapMinutes = |worked - logged| (logged = today's report, draft or submitted); gapWarning
 *   when it is above gap_warning_minutes (guide 7.3.3: it warns, never blocks)
 * @throws NOT_CHECKED_IN, ALREADY_CHECKED_OUT
 */
export async function checkOut({ user, ip }) {
  const current = await settings.getAll();
  const workDate = todayFor(current);
  const row = await repo.findByUserAndDate(user.id, workDate);
  if (!row) throw new AppError('NOT_CHECKED_IN');
  if (row.checkOutAt || row.checkoutStatus !== 'open') throw new AppError('ALREADY_CHECKED_OUT');
  const at = nowToSecond();
  await repo.transaction(async (trx) => {
    const changed = await repo.closeOpenRow(
      row.id,
      {
        checkOutAt: at,
        checkOutIp: ip ? String(ip).slice(0, 45) : null,
        checkoutStatus: 'checked_out',
        updatedAt: at,
      },
      trx,
    );
    if (changed === 0) throw new AppError('ALREADY_CHECKED_OUT');
    await endOpenBreak({ userId: user.id, at, reason: 'checkout' }, trx);
    await timers.stopRunning({ userId: user.id, at, reason: 'checkout' }, trx);
  });
  const [saved, breaks, day] = await Promise.all([
    repo.findById(row.id),
    repo.listBreaksByUserDate(user.id, workDate),
    reports.getDayStatus(user.id, workDate),
  ]);
  const present = presentMinutes(saved, at, current.timezone);
  const breakMinutes = breakMinutesWithin(breaks, saved, at, current.timezone);
  const worked = Math.max(0, present - breakMinutes);
  const logged = Number(day?.totalMinutes) || 0;
  const reportStatus = day?.status ?? 'none';
  const gapMinutes = Math.abs(worked - logged);
  await emit('attendance.checked_out', { row: saved, userId: user.id });
  return {
    row: saved,
    reportPending: reportStatus !== 'submitted',
    reportStatus,
    presentMinutes: present,
    breakMinutes,
    workedMinutes: worked,
    loggedMinutes: logged,
    gapMinutes,
    gapWarning: gapMinutes > current.gapWarningMinutes,
  };
}
