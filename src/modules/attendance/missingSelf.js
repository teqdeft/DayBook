// The person's own missing check-outs on Today (CONTRACT 25, item B; the owner's rule overrides
// build guide 7.8): a pop-up lists the last 30 days' missing rows without a pending check_out
// correction, and the person enters the time they left. Within the self-fix limit it is saved
// straight away ("By Priya" for HR, audited); a later time goes to HR as a correction request,
// inside the same transaction that holds the row lock. Before migration 018 the list is empty and
// the writes answer UPDATE_NEEDED.
import { AppError, validationError } from '@/lib/errors';
import { addDays, formatDayShort, formatTimeAmPm, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { getDay, loadCalendar } from './calendarReads';
import { isPastLastSeen } from './checkoutEntered';
import { suggestCheckoutTimes } from './checkoutSuggest';
import { requestCorrection } from './corrections';
import { assertOrder, auditView, resolveTimes } from './hr';
import { guard018Read, guard018Write } from './migration018';
import * as missingRepo from './missingRepo';
import { clockAt, isOverLimit, selfFixLimit } from './missingRules';
import { payrollMonthOf, payrollPeriod } from './payroll';
import { recipientsAbout } from './recipients';
import * as repo from './repo';
import { todayFor } from './rules';

const WINDOW_DAYS = 30;
const MAX_ROWS = 30;
const NONE = { items: [], autoOpen: false };

/** The pop-up's dates: today minus 30 days to yesterday. */
function windowOf(today) {
  return { from: addDays(today, -WINDOW_DAYS), to: addDays(today, -1) };
}

function notFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that missing check-out." });
}

function justFixed() {
  return new AppError('CONFLICT', { message: 'This check-out was just fixed. Refresh to see it.' });
}

/** One pop-up row: the times as Dates and as 'HH:mm' company clocks. */
function popupItem(row, { suggestedAt, limit, tz }) {
  return {
    attendanceId: row.id,
    workDate: row.workDate,
    checkInAt: row.checkInAt,
    location: row.location,
    suggestedAt,
    limitAt: limit.limitAt,
    basis: limit.basis,
    checkInClock: clockAt(row.checkInAt, tz),
    suggestedClock: clockAt(suggestedAt, tz),
    limitClock: clockAt(limit.limitAt, tz),
  };
}

/**
 * The signed-in person's missing check-outs for Today's pop-up: their own rows still marked
 * missing from today minus 30 days to yesterday, without a pending check_out correction (those
 * show under "Waiting for HR"), newest first, at most 30, each with the suggestion and the
 * self-fix limit. `autoOpen` is true when one of them wasn't hidden today ("Not now").
 * @param {{ user: object }} input the session user
 * @returns {Promise<{ items: Array<{ attendanceId: number, workDate: string, checkInAt: Date,
 *   location: string, suggestedAt: Date | null, limitAt: Date | null,
 *   basis: 'shift_end' | 'suggestion' | 'none', checkInClock: string,
 *   suggestedClock: string | null, limitClock: string | null }>, autoOpen: boolean }>}
 *   empty for someone who doesn't track attendance, and before migration 018
 */
export async function listMyMissingCheckouts({ user }) {
  if (!user?.tracksAttendance) return NONE;
  const current = await settings.getAll();
  const today = todayFor(current);
  const { from, to } = windowOf(today);
  const rows = await guard018Read(
    'checkouts',
    () => missingRepo.listOwnMissing({ userId: user.id, from, to, limit: MAX_ROWS }),
    () => null,
  );
  if (!rows || rows.length === 0) return NONE;
  const dates = rows.map((row) => row.workDate).sort();
  const [suggestions, calendar] = await Promise.all([
    suggestCheckoutTimes(rows),
    loadCalendar({ from: dates[0], to: dates.at(-1), userIds: [user.id], withWfh: false }),
  ]);
  const tz = current.timezone;
  const items = rows.map((row) => {
    const suggestedAt = suggestions.get(Number(row.id)) ?? null;
    const day = calendar.dayFor(user, row.workDate);
    return popupItem(row, { suggestedAt, limit: selfFixLimit({ row, day, suggestedAt, tz }), tz });
  });
  return { items, autoOpen: rows.some((row) => row.checkoutPromptHiddenOn !== today) };
}

/** The person's own missing row of the last 30 days, locked by primary key (§15's first lock). */
async function lockOwnMissing({ user, attendanceId, today }, trx) {
  const row = await repo.findById(attendanceId, trx, { forUpdate: true });
  const { from, to } = windowOf(today);
  const own = row && Number(row.userId) === Number(user.id);
  if (!own || row.workDate < from || row.workDate > to) throw notFound();
  if (row.checkoutStatus !== 'missing') throw justFixed();
  const pending = await repo.findPendingCorrection(
    { userId: user.id, workDate: row.workDate, type: 'check_out' },
    trx,
  );
  if (pending) throw new AppError('REQUEST_ALREADY_PENDING');
  return row;
}

/** Within the limit: saves the check-out with who entered it, and audits it. */
async function saveOwn({ user, row, checkOutAt, suggestedAt, limitAt, tz, ip }, trx) {
  const at = nowDate();
  const changes = {
    checkOutAt,
    checkoutStatus: 'corrected',
    checkoutEnteredBy: user.id,
    checkoutEnteredAt: at,
    checkoutSuggestedAt: suggestedAt,
    updatedAt: at,
  };
  const changed = await guard018Write('checkouts', () =>
    missingRepo.closeMissingRow(row.id, changes, trx),
  );
  if (changed === 0) throw justFixed();
  const saved = await repo.findById(row.id, trx);
  await audit.log(
    {
      actorId: user.id,
      action: 'attendance.self_checkout',
      entityType: 'attendance',
      entityId: row.id,
      before: auditView(row),
      after: {
        ...auditView(saved),
        suggestedClock: clockAt(suggestedAt, tz),
        limitClock: clockAt(limitAt, tz),
        pastLastSeen: isPastLastSeen({ self: true, checkOutAt, suggestedAt }),
      },
      reason: 'Entered from Today',
      ip,
    },
    trx,
  );
  return saved;
}

/** The whole fix under the row lock; returns what happened. */
async function fixUnderLock({ user, attendanceId, checkOut, reason, ip, current, today }, trx) {
  const row = await lockOwnMissing({ user, attendanceId, today }, trx);
  // Before migration 018 the whole Save answers UPDATE_NEEDED, "Send to HR" too (Deploy before
  // migrate): until then only 1.09's "Request a correction" sends HR a request.
  await guard018Write('checkouts', () => missingRepo.findPromptHiddenOn(row.id, trx));
  const { checkOutAt } = resolveTimes({ workDate: row.workDate, checkOut, current });
  assertOrder(row.checkInAt, checkOutAt);
  const tz = current.timezone;
  // The suggestion and the limit are worked out again here, never trusted from the page.
  const suggestedAt = (await suggestCheckoutTimes([row])).get(Number(row.id)) ?? null;
  const day = await getDay({ person: user, date: row.workDate }, trx);
  const { limitAt } = selfFixLimit({ row, day, suggestedAt, tz });
  if (!isOverLimit(checkOutAt, limitAt)) {
    const saved = await saveOwn({ user, row, checkOutAt, suggestedAt, limitAt, tz, ip }, trx);
    return { outcome: 'saved', row: saved };
  }
  const why = String(reason ?? '').trim();
  if (why.length < 2)
    throw validationError({ reason: 'Add a reason for HR.' }, 'Add a reason for HR.');
  const correction = await requestCorrection(
    { user, type: 'check_out', workDate: row.workDate, checkOut, reason: why },
    trx,
  );
  return { outcome: 'sent', correction };
}

/**
 * A save for a day in an earlier payroll month tells HR (bell only, after commit): "Priya Sharma
 * entered a check-out for Fri, 23 Oct", "6:30 PM. That day is in the October 2026 payroll month."
 */
async function tellHrIfPastMonth({ user, row, current, today }) {
  const startDay = current.payrollMonthStartDay;
  const opened = payrollPeriod(payrollMonthOf(today, startDay), startDay).from;
  if (row.workDate >= opened) return;
  const month = payrollMonthOf(row.workDate, startDay);
  const hr = await recipientsAbout(user);
  await notifications.notify({
    userIds: hr.map((person) => person.id),
    type: 'attendance.self_checkout_past',
    title: `${user.name} entered a check-out for ${formatDayShort(row.workDate)}`,
    body:
      `${formatTimeAmPm(row.checkOutAt, current.timezone)}. ` +
      `That day is in the ${payrollPeriod(month, startDay).label} payroll month.`,
    link: `/attendance/people/${user.id}?month=${month}`,
  });
}

/**
 * The person enters the time they left for one of their own missing check-outs
 * (POST /api/attendance/me/missing-checkouts/:id/fix). `checkOut` is 'HH:mm' on the row's work
 * date (never in the future, after the check-in). At or before the self-fix limit it is saved:
 * checkout_status 'corrected' with checkout_entered_by, checkout_entered_at and
 * checkout_suggested_at, audited as attendance.self_checkout (no notification, except to HR for a
 * day in an earlier payroll month). After the limit it needs a reason and becomes a check_out
 * correction request for HR; the row stays missing and leaves the pop-up.
 * @param {{ user: object, attendanceId: number, checkOut: string, reason?: string | null,
 *   ip?: string | null }} input
 * @returns {Promise<({ outcome: 'saved', row: AttendanceRow } |
 *   { outcome: 'sent', correction: object }) & { missing: object }>} missing = the fresh
 *   listMyMissingCheckouts()
 * @throws NOT_FOUND (not their own row, or older than 30 days), CONFLICT (no longer missing),
 *   REQUEST_ALREADY_PENDING, VALIDATION_FAILED (checkOut, reason), UPDATE_NEEDED (before 018)
 */
export async function fixMyMissingCheckout({ user, attendanceId, checkOut, reason, ip = null }) {
  const current = await settings.getAll();
  const today = todayFor(current);
  const input = { user, attendanceId, checkOut, reason, ip, current, today };
  const result = await repo.transaction((trx) => fixUnderLock(input, trx));
  if (result.outcome === 'saved')
    await tellHrIfPastMonth({ user, row: result.row, current, today });
  return { ...result, missing: await listMyMissingCheckouts({ user }) };
}

/**
 * "Not now" on the pop-up (POST /api/attendance/me/missing-checkouts/hide): hides every listed
 * row for today. The rows come back tomorrow; a new missing day comes up the morning after it is
 * marked.
 * @param {{ user: object }} input
 * @returns {Promise<{ hiddenOn: string }>}
 * @throws UPDATE_NEEDED (before 018)
 */
export async function hideMissingCheckoutPrompt({ user }) {
  const today = todayFor(await settings.getAll());
  const { from, to } = windowOf(today);
  await guard018Write('checkouts', () =>
    missingRepo.hideOwnPrompt({ userId: user.id, from, to, hiddenOn: today }),
  );
  return { hiddenOn: today };
}
