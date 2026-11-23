// When a remind applies (CONTRACT 25, item 5), pure. One person, one kind: check_in (not checked
// in once their own late mark has passed, until their day end), break (on a break now and over
// the day's allowance), check_out (still checked in after the day end, not a break case) and
// missing_checkout (an unfixed missing check-out without a pending check_out correction, while
// today is a working day for them without full-day leave). Holidays, days off and full-day leave
// never qualify, and someone on second-half leave isn't asked after the split (PersonDay.dayEnd).
// The skip messages are the ones HR reads in the toast.
import { clockToMinutes, toLocal } from '@/lib/time';

export const REMIND_KINDS = ['check_in', 'break', 'check_out', 'missing_checkout'];

/** At most one remind per person per kind in this many minutes, Daybook's own included. */
export const REMIND_EVERY_MINUTES = 30;

// The order the day table offers them in on today's view.
const TODAY_ORDER = ['break', 'check_out', 'check_in'];

/** Minutes after local midnight, now, in company time. */
function nowMinutes(ctx) {
  const local = toLocal(ctx.now, ctx.settings.timezone);
  return local.hour() * 60 + local.minute();
}

function isClosed(row) {
  return Boolean(row) && (Boolean(row.checkOutAt) || row.checkoutStatus !== 'open');
}

/** Today's PersonDay of the item's person: the item's own day on today's view. */
function todayDayOf(item, ctx) {
  if (ctx.date === ctx.today) return item.day ?? null;
  return ctx.todayDays?.get(Number(item.user.id)) ?? null;
}

function checkInSkip(item, ctx, name) {
  if (item.attendance) return `${name} has checked in.`;
  if (item.where === 'on_leave') return `${name} is on leave today.`;
  if (item.where !== 'not_checked_in' || !item.day?.lateMark) return "Today isn't a working day.";
  const at = nowMinutes(ctx);
  if (at < clockToMinutes(item.day.lateMark)) return `${name} isn't late yet.`;
  if (at >= clockToMinutes(item.day.dayEnd)) return `${name}'s day has ended.`;
  return null;
}

function breakSkip(item, ctx, name) {
  if (isClosed(item.attendance)) return `${name} has checked out.`;
  const over = ctx.settings.breakAllowanceMinutes > 0 && item.overAllowanceMinutes > 0;
  if (!item.onBreakSince || !over) return `${name} isn't over the break allowance now.`;
  return null;
}

function checkOutSkip(item, ctx, name) {
  if (!item.attendance) return `${name} hasn't checked in.`;
  if (isClosed(item.attendance)) return `${name} has checked out.`;
  if (!breakSkip(item, ctx, name)) return `${name} is on a break now.`;
  if (nowMinutes(ctx) < clockToMinutes(item.day.dayEnd)) return `${name}'s day hasn't ended yet.`;
  return null;
}

function missingSkip(item, ctx, name) {
  const rows = ctx.missing?.get(Number(item.user.id)) ?? [];
  if (rows.length === 0) return `${name} has no missing check-outs now.`;
  const today = todayDayOf(item, ctx);
  if (!today?.isWorkingDay || !today.employed) return "Today isn't a working day.";
  if (today.leave?.part === 'full') return `${name} is on leave today.`;
  return null;
}

const SKIPS = {
  check_in: checkInSkip,
  break: breakSkip,
  check_out: checkOutSkip,
  missing_checkout: missingSkip,
};

/**
 * Why a remind of `kind` doesn't apply to the person now, or null when it does. The item is a
 * listDay() item of today (remind() and the day table on today), or of an earlier date for
 * missing_checkout (then `ctx.todayDays` holds the person's PersonDay of today).
 * @param {'check_in' | 'break' | 'check_out' | 'missing_checkout'} kind
 * @param {{ user: { id: number, name: string }, attendance: object | null, day: object,
 *   where: string, onBreakSince: Date | null, overAllowanceMinutes: number }} item
 * @param {{ now: Date | string, today: string, date: string, settings: { timezone: string,
 *   breakAllowanceMinutes: number }, missing?: Map<number, Array<{ attendanceId: number,
 *   workDate: string }>> | null, todayDays?: Map<number, object> | null }} ctx missing =
 *   missingCheckoutsFor() (unfixed rows without a pending check_out correction)
 * @returns {string | null} the skip message ("Priya Sharma has checked in.")
 */
export function remindSkipFor(kind, item, ctx) {
  const skip = SKIPS[kind];
  if (!skip) return 'Pick what to remind them about.';
  return skip(item, ctx, item.user.name);
}

/**
 * The remind the day table offers for a row now, or null. On today's view: break first, then
 * check_out, then check_in. On an earlier date: missing_checkout for a row still missing that
 * has no pending check_out correction (it is in `ctx.missing`), while today is a working day for
 * the person without full-day leave.
 * @param {object} item a listDay() item (with item.day)
 * @param {object} ctx see remindSkipFor()
 * @returns {'check_in' | 'break' | 'check_out' | 'missing_checkout' | null}
 */
export function remindKindFor(item, ctx) {
  if (!item?.user) return null;
  if (ctx.date !== ctx.today) {
    const row = item.attendance;
    if (row?.checkoutStatus !== 'missing') return null;
    const rows = ctx.missing?.get(Number(item.user.id)) ?? [];
    if (!rows.some((entry) => Number(entry.attendanceId) === Number(row.id))) return null;
    return remindSkipFor('missing_checkout', item, ctx) ? null : 'missing_checkout';
  }
  return TODAY_ORDER.find((kind) => !remindSkipFor(kind, item, ctx)) ?? null;
}

/**
 * When the person can be reminded about the same kind again.
 * @param {Date | string} sentAt the latest reminder of that kind
 * @returns {Date}
 */
export function nextRemindAt(sentAt) {
  return new Date(new Date(sentAt).getTime() + REMIND_EVERY_MINUTES * 60_000);
}
