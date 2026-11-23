// The Leave page's reads (CONTRACT 25, item 9): the leave entries touching a payroll month, each
// with its leave days inside that month (and in all), the days of it the person checked in anyway,
// who marked it, and the note only for HR and Admins and never for the person it is about (not
// even when they are HR). Also the people HR may pick. Admins' leave only for Admins.
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';
import { eachDay } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { LEAVE_TYPE_LABELS, PART_LABELS } from './calendar';
import * as calendarRepo from './calendarRepo';
import { dayPersonOf } from './calendarReads';
import * as writeRepo from './calendarWriteRepo';
import { leaveDaysIn } from './leaveRules';
import { guard018Read } from './migration018';
import { payrollPeriod, resolvePayrollMonth } from './payroll';
import { hidesAdmins, showsAttendanceOf } from './rules';
import { formatDayRange } from './wording';

const MAX_RANGE_DAYS = 400;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NO_SUMMARY = { people: 0, workingDays: 0 };

/**
 * The dates a list covers: `from`..`to` when both are given, else the payroll month asked for
 * (months to come too: leave is planned ahead), else the current one (or the one that just
 * closed, on the first 3 days of a period: resolvePayrollMonth).
 */
function periodOf({ month, from, to }, current) {
  if (from && to) {
    if (from > to || eachDay(from, to).length > MAX_RANGE_DAYS) {
      throw new AppError('VALIDATION_FAILED', { message: 'Pick a range of up to 400 days.' });
    }
    return { from, to, month: null, label: null, rangeLabel: null };
  }
  if (typeof month === 'string' && MONTH_RE.test(month)) {
    return payrollPeriod(month, current.payrollMonthStartDay);
  }
  return resolvePayrollMonth(undefined, current);
}

/** The holidays of every day the entries cover, as a Map by date. */
async function holidaysFor(rows) {
  if (rows.length === 0) return new Map();
  const from = rows.reduce(
    (min, row) => (row.fromDate < min ? row.fromDate : min),
    rows[0].fromDate,
  );
  const to = rows.reduce((max, row) => (row.toDate > max ? row.toDate : max), rows[0].toDate);
  const list = await calendarRepo.listHolidays(from, to);
  return new Map(list.map((row) => [row.date, { id: row.id, name: row.name }]));
}

const who = (id, name) => (id ? { id, name: name ?? null } : null);

/** One row as the API shows it (LeaveEntry). */
function toEntry(row, { viewer, inPeriod, whole, checkedInDays }) {
  const showNote = !viewer || (can(viewer, 'attendance.correct') && viewer.id !== row.userId);
  return {
    id: row.id,
    user: {
      id: row.userId,
      name: row.userName,
      initials: initials(row.userName),
      designation: row.userDesignation ?? '',
      role: row.userRole,
      status: row.userStatus,
      avatarUrl: row.userAvatarUrl ?? null,
    },
    fromDate: row.fromDate,
    toDate: row.toDate,
    days: formatDayRange(row.fromDate, row.toDate),
    part: row.part,
    partLabel: PART_LABELS[row.part] ?? PART_LABELS.full,
    paid: row.paid !== false,
    leaveType: row.leaveType,
    typeLabel: LEAVE_TYPE_LABELS[row.leaveType] ?? LEAVE_TYPE_LABELS.other,
    note: showNote ? (row.note ?? null) : null,
    workingDays: inPeriod.days,
    entryWorkingDays: whole.days,
    checkedInDays,
    createdBy: who(row.createdBy, row.createdByName),
    createdAt: row.createdAt,
    updatedBy: who(row.updatedBy, row.updatedByName),
    updatedAt: row.updatedAt,
  };
}

/** The rows as LeaveEntry items, their days counted between `from` and `to`. */
async function toEntries(rows, { viewer, current, from, to }) {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const [people, holidays, checkIns] = await Promise.all([
    users.findByIds(userIds),
    holidaysFor(rows),
    from && to ? writeRepo.listCheckInDays({ userIds, from, to }) : [],
  ]);
  const persons = new Map(people.map((user) => [user.id, dayPersonOf(user, current.timezone)]));
  const checkedIn = new Set(checkIns.map((row) => `${row.userId}|${row.workDate}`));
  return rows.map((row) => {
    const person = persons.get(row.userId) ?? null;
    const base = { entry: row, person, settings: current, holidays };
    const inPeriod = leaveDaysIn({ ...base, from, to });
    const whole = from || to ? leaveDaysIn(base) : inPeriod;
    // A check-in on a full-day leave day wins (present, not leave); on a half day it is expected.
    const checkedInDays =
      row.part === 'full'
        ? inPeriod.dates.filter((date) => checkedIn.has(`${row.userId}|${date}`)).length
        : 0;
    return toEntry(row, { viewer, inPeriod, whole, checkedInDays });
  });
}

/**
 * Leave entries touching a payroll month (the Leave page, GET /api/leave), newest first by first
 * day. An entry shows in every month it touches.
 * @param {{ viewer?: object, month?: string, from?: string, to?: string, userId?: number,
 *   limit?: number, offset?: number }} input month = 'YYYY-MM', a payroll month (months to
 *   come too); none = the current one, or the one that just closed on the first 3 days of a
 *   period (resolvePayrollMonth); from and to (both) list those dates instead
 * @returns {Promise<{ items: LeaveEntry[], total: number, available: boolean,
 *   period: object, summary: { people: number, workingDays: number } }>} LeaveEntry = { id, user:
 *   { id, name, initials, designation, role, status, avatarUrl }, fromDate, toDate, days, part,
 *   partLabel, paid, leaveType, typeLabel, note, workingDays, entryWorkingDays, checkedInDays,
 *   createdBy: { id, name } | null, createdAt, updatedBy, updatedAt }; workingDays = its leave
 *   days inside the period, entryWorkingDays = in all; note is null for the viewer's own entry;
 *   summary covers every entry listed (not only this page); available is false before 018
 * @throws VALIDATION_FAILED (from after to, or more than 400 days)
 */
export async function listLeave({ viewer, month, from, to, userId, limit = 50, offset = 0 } = {}) {
  const current = await settings.getAll();
  const period = periodOf({ month, from, to }, current);
  const rows = await guard018Read(
    'calendar',
    () =>
      writeRepo.listLeaveEntries({
        from: period.from,
        to: period.to,
        userId,
        hideAdmins: hidesAdmins(viewer),
      }),
    () => null,
  );
  if (!rows) return { items: [], total: 0, available: false, period, summary: NO_SUMMARY };
  const items = await toEntries(rows, { viewer, current, from: period.from, to: period.to });
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const start = Math.max(Number(offset) || 0, 0);
  const summary = {
    people: new Set(items.map((item) => item.user.id)).size,
    workingDays: items.reduce((sum, item) => sum + item.workingDays, 0),
  };
  return {
    items: items.slice(start, start + size),
    total: items.length,
    available: true,
    period,
    summary,
  };
}

/**
 * One leave entry (after a write), its days counted over the whole entry.
 * @param {number} id
 * @param {{ viewer?: object }} [options]
 * @returns {Promise<LeaveEntry | null>}
 */
export async function getLeaveEntry(id, { viewer } = {}) {
  const rows = await writeRepo.listLeaveEntries({ id, hideAdmins: hidesAdmins(viewer) });
  if (rows.length === 0) return null;
  const [entry] = await toEntries(rows, { viewer, current: await settings.getAll() });
  return entry;
}

/**
 * The people for the Leave page's Person filter and the Mark leave dialog: active people who
 * track attendance and whom the viewer may see (never an Admin for a non-Admin), by name.
 * @param {{ viewer: object, forChange?: boolean }} input forChange (the dialog) also leaves out
 *   the viewer (nobody marks their own leave)
 * @returns {Promise<Array<{ id: number, name: string, designation: string }>>}
 */
export async function listLeavePeople({ viewer, forChange = true }) {
  const people = await users.listActive({ tracksAttendance: true });
  return people
    .filter((person) => showsAttendanceOf(viewer, person))
    .filter((person) => !forChange || person.id !== viewer.id)
    .map((person) => ({ id: person.id, name: person.name, designation: person.designation }));
}
