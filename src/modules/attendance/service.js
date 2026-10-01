// Attendance rules for the person: reading rows, check-in (guide 7.2), check-out (7.3) and the
// nightly missing check-out job. HR's side lives in hr.js and corrections.js; the day view in
// day.js.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { emit } from '@/lib/events';
import { logger } from '@/lib/logger';
import { formatDayShort, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { hrRecipients, loadRecipientPools, pickRecipients } from './recipients';
import * as repo from './repo';
import { computeLateMinutes, presentMinutes, todayFor, workingDayFlag } from './rules';

export { presentMinutes };

/**
 * One person's attendance row for a work date.
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<AttendanceRow | null>} AttendanceRow = { id, userId, workDate, checkInAt,
 *   checkOutAt, location, officeVerified, checkInIp, checkOutIp, note, lateMinutes, isWorkingDay,
 *   checkoutStatus, source }
 */
export async function getForUserOnDate(userId, workDate) {
  return (await repo.findByUserAndDate(userId, workDate)) ?? null;
}

/**
 * One person's rows from `from` to `to` (inclusive), oldest first.
 * @returns {Promise<AttendanceRow[]>}
 */
export function listForUserRange(userId, from, to) {
  return repo.listByUserRange(userId, from, to);
}

/**
 * Every row for a work date (all people, whatever their status), by user id.
 * @returns {Promise<AttendanceRow[]>}
 */
export function listForDate(workDate) {
  return repo.listByDate(workDate);
}

/**
 * Today's state for the signed-in person (GET /api/attendance/me/today and the Today page).
 * @param {{ user: { id: number }, ip?: string | null }} input
 * @returns {Promise<{ workDate: string, row: AttendanceRow | null, onOfficeNetwork: boolean,
 *   allowUnverifiedOffice: boolean, presentMinutes: number }>}
 */
export async function getMyToday({ user, ip }) {
  const current = await settings.getAll();
  const workDate = todayFor(current);
  const [row, onOfficeNetwork] = await Promise.all([
    getForUserOnDate(user.id, workDate),
    settings.isOfficeIp(ip),
  ]);
  return {
    workDate,
    row,
    onOfficeNetwork,
    allowUnverifiedOffice: current.allowUnverifiedOffice,
    presentMinutes: presentMinutes(row, undefined, current.timezone),
  };
}

/** Where a check-in is saved, from the network and what the person picked (guide 7.2.2-3). */
function decideLocation({ onOfficeNetwork, location, unverifiedOffice, allowUnverifiedOffice }) {
  if (onOfficeNetwork) return { location: 'office', officeVerified: true };
  if (location !== 'office') return { location: 'wfh', officeVerified: true };
  if (!unverifiedOffice) throw new AppError('OFFICE_NETWORK_REQUIRED');
  if (!allowUnverifiedOffice) throw new AppError('UNVERIFIED_OFFICE_DISABLED');
  return { location: 'office', officeVerified: false };
}

/**
 * Checks the person in for today at the server's time.
 * On the office network the only option is Office (verified). Elsewhere the default is WFH;
 * Office needs unverifiedOffice = true and the allow_unverified_office setting, is saved with
 * office_verified = 0 and notifies HR. Late minutes follow the person's shift start or late_after
 * on working days.
 * @param {{ user: { id: number, name: string, shiftStart?: string | null }, ip?: string | null,
 *   location?: 'office' | 'wfh', unverifiedOffice?: boolean, note?: string | null }} input
 * @returns {Promise<AttendanceRow>}
 * @throws ALREADY_CHECKED_IN, OFFICE_NETWORK_REQUIRED, UNVERIFIED_OFFICE_DISABLED
 */
export async function checkIn({ user, ip, location, unverifiedOffice = false, note = null }) {
  const current = await settings.getAll();
  const workDate = todayFor(current);
  if (await repo.findByUserAndDate(user.id, workDate)) throw new AppError('ALREADY_CHECKED_IN');
  const placed = decideLocation({
    onOfficeNetwork: await settings.isOfficeIp(ip),
    location,
    unverifiedOffice,
    allowUnverifiedOffice: current.allowUnverifiedOffice,
  });
  const at = nowDate();
  const cleanNote = note ? String(note).trim().slice(0, 255) || null : null;
  const row = {
    userId: user.id,
    workDate,
    checkInAt: at,
    location: placed.location,
    officeVerified: placed.officeVerified,
    checkInIp: ip ? String(ip).slice(0, 45) : null,
    note: cleanNote,
    lateMinutes: computeLateMinutes({
      checkInAt: at,
      workDate,
      shiftStart: user.shiftStart,
      settings: current,
    }),
    isWorkingDay: workingDayFlag(workDate, current),
    checkoutStatus: 'open',
    source: 'self',
    createdAt: at,
    updatedAt: at,
  };
  let id;
  try {
    id = await db.transaction(async (trx) => {
      const newId = await repo.insertRow(row, trx);
      if (!placed.officeVerified) await reportUnverifiedOffice({ user, id: newId, row, ip }, trx);
      return newId;
    });
  } catch (error) {
    // Two taps at once: the unique key (user_id, work_date) stops the second one.
    if (error?.errno === 1062) throw new AppError('ALREADY_CHECKED_IN');
    throw error;
  }
  const saved = await repo.findById(id);
  await emit('attendance.checked_in', { row: saved, userId: user.id });
  return saved;
}

async function reportUnverifiedOffice({ user, id, row, ip }, trx) {
  const hr = await hrRecipients(user.id);
  await notifications.notify(
    {
      userIds: hr.map((person) => person.id),
      type: 'attendance.unverified_office',
      title: `${user.name} checked in at the office, unverified`,
      body: row.note,
      link: '/attendance?filter=unverified',
    },
    trx,
  );
  await audit.log(
    {
      actorId: user.id,
      action: 'attendance.unverified_office',
      entityType: 'attendance',
      entityId: id,
      after: { location: 'office', officeVerified: false, workDate: row.workDate },
      reason: row.note,
      ip,
    },
    trx,
  );
}

/**
 * Checks the person out of today's open check-in at the server's time. Always checks out; the
 * result says whether today's report is still to write and how far present time and logged hours
 * are apart (a warning only, guide 7.3).
 * @param {{ user: { id: number }, ip?: string | null }} input
 * @returns {Promise<{ row: AttendanceRow, reportPending: boolean, reportStatus: string,
 *   presentMinutes: number, loggedMinutes: number, gapMinutes: number, gapWarning: boolean }>}
 *   gapMinutes = |present - logged| (logged = today's report, draft or submitted); gapWarning
 *   when it is above gap_warning_minutes (guide 7.3.3: it warns, never blocks)
 * @throws NOT_CHECKED_IN, ALREADY_CHECKED_OUT
 */
export async function checkOut({ user, ip }) {
  const current = await settings.getAll();
  const workDate = todayFor(current);
  const row = await repo.findByUserAndDate(user.id, workDate);
  if (!row) throw new AppError('NOT_CHECKED_IN');
  if (row.checkOutAt || row.checkoutStatus !== 'open') throw new AppError('ALREADY_CHECKED_OUT');
  const at = nowDate();
  const changed = await repo.closeOpenRow(row.id, {
    checkOutAt: at,
    checkOutIp: ip ? String(ip).slice(0, 45) : null,
    checkoutStatus: 'checked_out',
    updatedAt: at,
  });
  if (changed === 0) throw new AppError('ALREADY_CHECKED_OUT');
  const saved = await repo.findById(row.id);
  const day = await reports.getDayStatus(user.id, workDate);
  const present = presentMinutes(saved, at, current.timezone);
  const logged = Number(day?.totalMinutes) || 0;
  const reportStatus = day?.status ?? 'none';
  const gapMinutes = Math.abs(present - logged);
  await emit('attendance.checked_out', { row: saved, userId: user.id });
  return {
    row: saved,
    reportPending: reportStatus !== 'submitted',
    reportStatus,
    presentMinutes: present,
    loggedMinutes: logged,
    gapMinutes,
    gapWarning: gapMinutes > current.gapWarningMinutes,
  };
}

/**
 * Worker job (00:05): marks every check-in still open from an earlier day as missing (audited)
 * and tells HR and the person. Only people the Attendance screen shows (active, tracking
 * attendance) are announced: a leaver deactivated after checking in, or someone who doesn't
 * track attendance, has nowhere to fix it, so their row is marked quietly. Does nothing when
 * auto_mark_missing_checkout is off.
 * @returns {Promise<{ marked: number }>}
 */
export async function markMissingCheckouts() {
  const current = await settings.getAll();
  if (!current.autoMarkMissingCheckout) return { marked: 0 };
  const today = todayFor(current);
  const marked = await db.transaction(async (trx) => {
    const rows = await repo.listOpenBefore(today, trx);
    if (rows.length === 0) return [];
    const count = await repo.markMissing(
      rows.map((row) => row.id),
      nowDate(),
      trx,
    );
    if (count !== rows.length)
      logger.warn({ count, rows: rows.length }, 'missing check-outs raced');
    const [people, pools] = await Promise.all([
      users.findByIds(rows.map((row) => row.userId)),
      loadRecipientPools(),
    ]);
    const byId = new Map(people.map((person) => [person.id, person]));
    for (const row of rows) {
      const person = byId.get(row.userId);
      const shown = person?.status === 'active' && person.tracksAttendance;
      const hr = shown ? pickRecipients(pools, row.userId) : [];
      await notifyMissing({ row, person: shown ? person : null, hr }, trx);
    }
    return rows;
  });
  if (marked.length > 0) logger.info({ marked: marked.length }, 'missing check-outs marked');
  return { marked: marked.length };
}

/** Audits one marked row; tells HR and the person when `person` is given. */
async function notifyMissing({ row, person, hr }, trx) {
  if (person) {
    const day = formatDayShort(row.workDate);
    await notifications.notify(
      {
        userIds: hr.map((recipient) => recipient.id),
        type: 'attendance.missing_checkout',
        title: `${person.name} didn't check out on ${day}`,
        body: 'Marked as a missing check-out at midnight.',
        link: '/attendance',
      },
      trx,
    );
    await notifications.notify(
      {
        userIds: [row.userId],
        type: 'attendance.missing_checkout',
        title: `You didn't check out on ${day}`,
        body: 'Send HR the time you left from Today, under "Request a correction".',
        link: '/today',
      },
      trx,
    );
  }
  await audit.log(
    {
      actorId: null,
      action: 'attendance.mark_missing',
      entityType: 'attendance',
      entityId: row.id,
      before: { checkoutStatus: 'open' },
      after: { checkoutStatus: 'missing' },
    },
    trx,
  );
}

/**
 * How many correction requests wait for HR (the Attendance nav badge).
 * @returns {Promise<number>}
 */
export function countPendingCorrections() {
  return repo.countCorrections({ status: 'pending' });
}
