// Loaders of the person's day (CONTRACT 25): the calendar of a date range (holidays, leave and
// approved WFH in three queries), one person's day, the company's day (cached 30 s), the last
// working day before a date, and the holiday and leave reads the screens show. Before migration
// 018 holidays and leave read as none (`available: false`) and the weekday rule applies, as 1.09.
// Without `leaveDetail` a day's leave is { id, part } only, so PMs, dashboards and Gemini never
// get the leave type or pay; the note is never read here at all.
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { addDays, eachDay, isWorkingDay, now, workDate as localDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as calendarRepo from './calendarRepo';
import { personDay } from './calendar';
import { guard018Read } from './migration018';

const MAX_RANGE_DAYS = 400;
const LOOK_BACK_DAYS = 14;

/**
 * The `person` a PersonDay needs, from a PublicUser or the session user: leftOn is the company
 * date of deactivatedAt once they left (null while active).
 * @param {object} user
 * @param {string} tz company time zone
 */
export function dayPersonOf(user, tz) {
  if (!user) return null;
  const left = user.leftOn ?? (user.status && user.status !== 'active' && user.deactivatedAt);
  return {
    id: user.id,
    role: user.role,
    tracksAttendance: user.tracksAttendance,
    joinedOn: user.joinedOn ?? null,
    leftOn: typeof left === 'string' ? left : left ? localDate(tz, left) : null,
    shiftStart: user.shiftStart ?? null,
    shiftEnd: user.shiftEnd ?? null,
  };
}

/** The person fields every attendance list shows (no shift, no Slack id). */
export function publicPerson(person) {
  const { id, name, initials, avatarUrl, role, status, designation, departmentName, email } =
    person;
  return { id, name, initials, avatarUrl, role, status, designation, departmentName, email };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) map.set(row[key], [...(map.get(row[key]) ?? []), row]);
  return map;
}

const covers = (entry, date) => entry.fromDate <= date && entry.toDate >= date;

/**
 * The calendar of a date range: one query each for holidays, leave entries (of `userIds` when
 * given) and approved WFH requests, and the settings once.
 * @param {{ from: string, to: string, userIds?: number[], leaveDetail?: boolean,
 *   withWfh?: boolean }} range at most 400 days; leaveDetail adds the leave's paid and leaveType
 *   to each day; withWfh = false skips the WFH query (every day's wfhApproved is then false)
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<Calendar>} { from, to, available, holidays: Map<date, { id, name }>,
 *   isWorkingDay(date), holidayOn(date), dayFor(person, date) → PersonDay,
 *   workingDaysBetween(a, b) } (available is false before migration 018)
 * @throws VALIDATION_FAILED for a range over 400 days or the wrong way round (a programming error)
 */
export async function loadCalendar(
  { from, to, userIds, leaveDetail = false, withWfh = true },
  trx,
) {
  if (!(from <= to) || eachDay(from, to).length > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { message: 'Pick a range of up to 400 days.' });
  }
  const [current, holidayRows, leaveRows, wfhRows] = await Promise.all([
    settings.getAll(),
    guard018Read(
      'calendar',
      () => calendarRepo.listHolidays(from, to, trx),
      () => null,
    ),
    guard018Read(
      'calendar',
      () => calendarRepo.listLeave({ from, to, userIds }, trx),
      () => null,
    ),
    withWfh ? calendarRepo.listApprovedWfh({ from, to, userIds }, trx) : [],
  ]);
  const available = holidayRows !== null && leaveRows !== null;
  const holidays = new Map(
    (holidayRows ?? []).map((row) => [row.date, { id: row.id, name: row.name }]),
  );
  const leaveByUser = groupBy(leaveRows ?? [], 'userId');
  const wfhByUser = groupBy(wfhRows, 'userId');
  const working = (date) => isWorkingDay(date, current.workingDays, holidays);
  return {
    from,
    to,
    available,
    holidays,
    isWorkingDay: working,
    holidayOn: (date) => holidays.get(date) ?? null,
    workingDaysBetween: (a, b) => (b > a ? eachDay(addDays(a, 1), b).filter(working).length : 0),
    dayFor(user, date) {
      const person = dayPersonOf(user, current.timezone);
      return personDay({
        date,
        person,
        settings: current,
        holiday: holidays.get(date) ?? null,
        leave: (leaveByUser.get(person?.id) ?? []).find((entry) => covers(entry, date)) ?? null,
        wfhApproved: (wfhByUser.get(person?.id) ?? []).some((entry) => covers(entry, date)),
        leaveDetail,
      });
    },
  };
}

/**
 * One person's day (two small queries; three with WFH). Check-in, HR edits, corrections, Today
 * and the away question use it. Holidays are read from the table, never the companyDay cache.
 * @param {{ person: object, date: string, withWfh?: boolean, leaveDetail?: boolean }} input
 *   person = a PublicUser or the session user
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<PersonDay>}
 */
export async function getDay({ person, date, withWfh = false, leaveDetail = false }, trx) {
  const range = { from: date, to: date, userIds: [person.id], leaveDetail, withWfh };
  return (await loadCalendar(range, trx)).dayFor(person, date);
}

// ---------- the company's day (cached 30 s per date, per process) ----------

const dayCache = globalThis.__daybookCompanyDayCache ?? new Map();
globalThis.__daybookCompanyDayCache = dayCache;
const DAY_CACHE_MS = env.isTest ? 0 : 30_000;

/**
 * The company's day: the weekday rule and the holiday on that date. Cached in the process for
 * 30 s per date (like settings); holiday writes clear it in the writing process
 * (clearCompanyDayCache), other processes catch up within 30 s.
 * @param {string} date 'YYYY-MM-DD'
 * @returns {Promise<{ date: string, weekday: boolean, holiday: { id: number, name: string } | null,
 *   isWorkingDay: boolean }>}
 */
export async function companyDay(date) {
  const at = now().valueOf();
  const cached = dayCache.get(date);
  if (cached && at - cached.loadedAt < DAY_CACHE_MS) return cached.value;
  const [current, rows] = await Promise.all([
    settings.getAll(),
    guard018Read(
      'calendar',
      () => calendarRepo.listHolidays(date, date),
      () => [],
    ),
  ]);
  const weekday = isWorkingDay(date, current.workingDays);
  const holiday = rows[0] ? { id: rows[0].id, name: rows[0].name } : null;
  const value = { date, weekday, holiday, isWorkingDay: weekday && !holiday };
  if (DAY_CACHE_MS > 0) dayCache.set(date, { value, loadedAt: at });
  return value;
}

/** Forgets every cached companyDay() answer in this process (holiday writes call it). */
export function clearCompanyDayCache() {
  dayCache.clear();
}

/**
 * The holiday dates of the 14 days before `date`, as a Set (missingWindow and
 * lastWorkingDayBefore). Empty before migration 018.
 * @param {string} date
 * @returns {Promise<Set<string>>}
 */
export async function holidaysBefore(date) {
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listHolidays(addDays(date, -LOOK_BACK_DAYS), addDays(date, -1)),
    () => [],
  );
  return new Set(rows.map((row) => row.date));
}

/**
 * The last working day before `date` (holidays and days the company doesn't work skipped),
 * within 14 days; else the day before.
 * @param {string} date
 * @returns {Promise<string>}
 */
export async function lastWorkingDayBefore(date) {
  const [current, holidays] = await Promise.all([settings.getAll(), holidaysBefore(date)]);
  for (let back = 1; back <= LOOK_BACK_DAYS; back += 1) {
    const day = addDays(date, -back);
    if (isWorkingDay(day, current.workingDays, holidays)) return day;
  }
  return addDays(date, -1);
}

/**
 * Company holidays from `from` to `to` (inclusive), oldest first ([] before migration 018).
 * @returns {Promise<Array<{ date: string, name: string }>>}
 */
export async function listHolidaysBetween(from, to) {
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listHolidays(from, to),
    () => [],
  );
  return rows.map(({ date, name }) => ({ date, name }));
}

/**
 * The first holiday on or after `from`, within `withinDays` days (from included).
 * @param {string} from
 * @param {{ withinDays?: number }} [options] default 60
 * @returns {Promise<{ date: string, name: string } | null>}
 */
export async function nextHoliday(from, { withinDays = 60 } = {}) {
  const to = addDays(from, Math.max(0, withinDays - 1));
  const row = await guard018Read(
    'calendar',
    () => calendarRepo.findNextHoliday(from, to),
    () => null,
  );
  return row ? { date: row.date, name: row.name } : null;
}
