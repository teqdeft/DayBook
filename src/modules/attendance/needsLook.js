// "4th this month" on the day page and Needs a look this month (CONTRACT 25, item 10). Both count
// effective late days the way the month summary does (monthRules.js), so the day page, the month
// view and the late alert always agree. Needs a look is the current payroll month through today,
// kept per process for 5 minutes (the day page refreshes every 60 s); a leave or holiday write
// clears it in that process (clearNeedsLookCache).
import { env } from '@/lib/env';
import { now, workDate as localDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { loadCalendar } from './calendarReads';
import { effectiveLateMinutes } from './calendar';
import { summarizeRange } from './month';
import * as monthRepo from './monthRepo';
import { ordinal } from './monthRules';
import { payrollMonthOf, payrollPeriod } from './payroll';
import { hidesAdmins } from './rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_MS = env.isTest ? 0 : 5 * 60_000;
const cache = globalThis.__daybookNeedsLookCache ?? new Map();
globalThis.__daybookNeedsLookCache = cache;

/** The payroll month a date belongs to, with its dates and labels. */
function periodOf(date, current) {
  const startDay = current.payrollMonthStartDay;
  return payrollPeriod(payrollMonthOf(date, startDay), startDay);
}

/** "4th late day in November 2026", with "(26 Oct to 25 Nov)" when the start day isn't 1. */
function lateTitle(nth, period) {
  const range = period.rangeLabel ? ` (${period.rangeLabel})` : '';
  return `${ordinal(nth)} late day in ${period.label}${range}`;
}

/**
 * "4th this month" for the people late on a date: their effective late days in the payroll month
 * of `date`, from its first day up to `date`, this day included. One query plus the calendar.
 * @param {{ date: string, userIds: number[] }} input
 * @returns {Promise<Record<number, { nth: number, label: string, title: string,
 *   alert: boolean }>>} only people late that day; alert = at or over late_alert_days
 */
export async function lateCountsFor({ date, userIds } = {}) {
  const ids = [...new Set((userIds ?? []).map(Number))].filter((id) => id > 0);
  if (ids.length === 0 || !DATE.test(String(date))) return {};
  const current = await settings.getAll();
  const period = periodOf(date, current);
  const range = { from: period.from, to: date, userIds: ids };
  const [rows, calendar] = await Promise.all([
    monthRepo.listLateDays(range),
    loadCalendar({ ...range, withWfh: false }),
  ]);
  const late = new Map();
  for (const row of rows) {
    const person = { id: row.userId, ...row };
    if (effectiveLateMinutes({ row, day: calendar.dayFor(person, row.workDate) }) <= 0) continue;
    late.set(row.userId, [...(late.get(row.userId) ?? []), row.workDate]);
  }
  const result = {};
  for (const [userId, dates] of late) {
    if (!dates.includes(date)) continue;
    const nth = dates.length;
    result[userId] = {
      nth,
      label: `${ordinal(nth)} this month`,
      title: lateTitle(nth, period),
      alert: nth >= current.lateAlertDays,
    };
  }
  return result;
}

const reasonTotal = (item) => item.reasons.reduce((sum, reason) => sum + reason.count, 0);

async function loadNeedsLook(viewer, current, period) {
  const summary = await summarizeRange({ from: period.from, to: period.to, viewer });
  const items = summary.people
    .filter((person) => person.needsLook.length > 0)
    .map((person) => ({
      user: person.user,
      href: `/attendance/people/${person.user.id}?month=${period.month}`,
      reasons: person.needsLook,
    }))
    .sort((a, b) => reasonTotal(b) - reasonTotal(a) || a.user.name.localeCompare(b.user.name));
  return {
    period: {
      ...period,
      subtitle: `${period.rangeLabel ?? period.label} so far`,
      monthHref: `/attendance/month?month=${period.month}&filter=needs_look`,
    },
    threshold: current.lateAlertDays,
    total: items.length,
    items,
  };
}

/**
 * Needs a look this month: everyone whose current payroll month so far has at least
 * late_alert_days late days, short days (half and short together) or missing reports. Sorted by
 * the sum of the counts, then name. Admins only for an Admin viewer. Kept per process for 5
 * minutes, by payroll month and whether the viewer is an Admin.
 * @param {{ viewer?: { role: string } | null }} [input]
 * @returns {Promise<{ period: { month: string, from: string, to: string, label: string,
 *   rangeLabel: string | null, subtitle: string, monthHref: string }, threshold: number,
 *   total: number, items: Array<{ user: object, href: string, reasons: Array<{ key: string,
 *   count: number, label: string }> }> }>}
 */
export async function getNeedsLook({ viewer } = {}) {
  const current = await settings.getAll();
  const period = periodOf(localDate(current.timezone), current);
  const admins = !hidesAdmins(viewer);
  const key = [period.month, current.payrollMonthStartDay, current.lateAlertDays, admins].join(':');
  const at = now().valueOf();
  const cached = cache.get(key);
  if (cached && at - cached.loadedAt < CACHE_MS) return cached.value;
  const value = await loadNeedsLook(viewer, current, period);
  if (CACHE_MS > 0) {
    if (cache.size > 8) cache.clear();
    cache.set(key, { value, loadedAt: at });
  }
  return value;
}

/** Forgets the cached Needs a look answers in this process (holiday and leave writes call it). */
export function clearNeedsLookCache() {
  cache.clear();
}
