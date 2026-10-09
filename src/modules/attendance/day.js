// The Attendance screen's read model for one day: everyone who tracks attendance with their row,
// the five numbers (guide 7.10), the missing check-outs and the Excel export.
import { addDays, isWorkingDay, now, toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import * as repo from './repo';
import { breakMinutesWithin, presentMinutes, todayFor, whereOf } from './rules';
import { dateString } from './schemas';

const MATCHES = {
  all: () => true,
  late: (item) => item.attendance?.lateMinutes > 0,
  wfh: (item) => item.where === 'wfh',
  not_checked_in: (item) => item.where === 'not_checked_in',
  unverified: (item) => item.where === 'unverified',
};

function publicPerson(person) {
  const { id, name, initials, avatarUrl, role, status, designation, departmentName, email } =
    person;
  return { id, name, initials, avatarUrl, role, status, designation, departmentName, email };
}

/** Break and worked minutes of one row (CONTRACT 15); present is null when it isn't known. */
function timeOf(row, breaks, present, { at, tz, allowance }) {
  const breakMinutes = row ? breakMinutesWithin(breaks, row, at, tz) : 0;
  return {
    presentMinutes: present,
    breakMinutes,
    workedMinutes: present === null ? null : Math.max(0, present - breakMinutes),
    overAllowanceMinutes: allowance > 0 ? Math.max(0, breakMinutes - allowance) : 0,
  };
}

/**
 * Everyone who tracks attendance (active, joined by that day), each with their row for the date,
 * in the order they were added to Daybook. Breaks are read with one query for the date.
 * @param {string} workDate
 * @returns {Promise<Array<{ user: object, attendance: AttendanceRow | null,
 *   where: 'office' | 'wfh' | 'unverified' | 'not_checked_in', presentMinutes: number | null,
 *   breakMinutes: number, workedMinutes: number | null, overAllowanceMinutes: number }>>}
 *   presentMinutes and workedMinutes are null without a row or for a missing check-out;
 *   overAllowanceMinutes is how far breaks go past breakAllowanceMinutes (0 when it is 0)
 */
export async function listDay(workDate) {
  const [people, rows, breakRows, current] = await Promise.all([
    users.listActive({ tracksAttendance: true }),
    repo.listByDate(workDate),
    repo.listBreaksByDate(workDate),
    settings.getAll(),
  ]);
  const byUser = new Map(rows.map((row) => [row.userId, row]));
  const breaksByUser = new Map();
  for (const item of breakRows) {
    breaksByUser.set(item.userId, [...(breaksByUser.get(item.userId) ?? []), item]);
  }
  const context = {
    at: now(),
    tz: current.timezone,
    allowance: current.breakAllowanceMinutes,
  };
  return people
    .filter((person) => person.tracksAttendance !== false)
    .filter((person) => !person.joinedOn || person.joinedOn <= workDate || byUser.has(person.id))
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const row = byUser.get(person.id) ?? null;
      const present =
        row && row.checkoutStatus !== 'missing'
          ? presentMinutes(row, context.at, context.tz)
          : null;
      return {
        user: publicPerson(person),
        attendance: row,
        where: whereOf(row),
        ...timeOf(row, breaksByUser.get(person.id) ?? [], present, context),
      };
    });
}

/**
 * Keeps the listDay() items that match a filter ('all' keeps everyone).
 * @param {object[]} items
 * @param {'all' | 'late' | 'wfh' | 'not_checked_in' | 'unverified'} filter
 */
export function filterDay(items, filter = 'all') {
  return items.filter(MATCHES[filter] ?? MATCHES.all);
}

/**
 * The day list filtered (GET /api/attendance), with paging.
 * @param {{ date: string, filter?: 'all' | 'late' | 'wfh' | 'not_checked_in' | 'unverified',
 *   limit?: number, offset?: number }} input
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listForDay({ date, filter = 'all', limit = 100, offset = 0 }) {
  const all = await listDay(date);
  const matching = filterDay(all, filter);
  return { items: matching.slice(offset, offset + limit), total: matching.length };
}

/**
 * The days the "Missing check-out" number covers for a date: from the last working day before it
 * to the day before it. On a Monday that is Friday to Sunday, so weekend work never hides
 * Friday's missing check-outs. Without a working day in the week before, it is the day before.
 * @param {string} workDate
 * @param {number[]} workingDays ISO weekdays (Monday = 1), from settings
 * @returns {{ from: string, to: string }}
 */
export function missingWindow(workDate, workingDays) {
  const to = addDays(workDate, -1);
  for (let back = 1; back <= 7; back += 1) {
    const day = addDays(workDate, -back);
    if (isWorkingDay(day, workingDays)) return { from: day, to };
  }
  return { from: to, to };
}

/**
 * The five numbers and the filter counts for a day, from its list (tracked, active people only).
 * @param {Array<{ attendance: AttendanceRow | null, where: string }>} items from listDay()
 * @param {{ count: number, fromDate: string, days: number }} missing from missingWindow() and
 *   repo.countMissingByDay(): rows still missing, the first day counted, days that have some
 */
export function summarize(items, missing) {
  const present = items.filter((item) => item.attendance);
  const late = present.filter((item) => item.attendance.lateMinutes > 0);
  const lateTotal = late.reduce((sum, item) => sum + item.attendance.lateMinutes, 0);
  const count = (where) => items.filter((item) => item.where === where).length;
  return {
    tracked: items.length,
    present: present.length,
    inOffice: count('office') + count('unverified'),
    wfh: count('wfh'),
    late: late.length,
    lateAverageMinutes: late.length ? Math.round(lateTotal / late.length) : 0,
    notCheckedIn: count('not_checked_in'),
    unverified: count('unverified'),
    missingCheckouts: missing.count,
    missingFromDate: missing.fromDate,
    missingDays: missing.days,
  };
}

/**
 * Numbers for a date (GET /api/attendance/summary and the Attendance KPIs). Missing check-outs
 * are the rows still marked missing from the days missingWindow() covers, among active people who
 * track attendance; missingFromDate is the first of those days with one (or the window's start
 * when there are none) and missingDays how many days have one.
 * @param {string} workDate
 * @param {object[]} [items] listDay(workDate), when the caller already has it
 * @returns {Promise<{ date: string, tracked: number, present: number, inOffice: number,
 *   wfh: number, late: number, lateAverageMinutes: number, notCheckedIn: number,
 *   unverified: number, missingCheckouts: number, missingFromDate: string,
 *   missingDays: number }>}
 */
export async function getDaySummary(workDate, items) {
  const [list, current] = await Promise.all([items ?? listDay(workDate), settings.getAll()]);
  const span = missingWindow(workDate, current.workingDays);
  const perDay = await repo.countMissingByDay(span.from, span.to);
  const missing = {
    count: perDay.reduce((sum, day) => sum + day.count, 0),
    fromDate: perDay[0]?.workDate ?? span.from,
    days: perDay.length,
  };
  return { date: workDate, ...summarize(list, missing) };
}

/**
 * Rows still marked as a missing check-out (not fixed yet) of active people who track
 * attendance, newest first, with the person. `total` counts the same rows, so it never includes
 * one the list can't show.
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ items: Array<AttendanceRow & { user: object }>, total: number }>}
 */
export async function listMissingCheckouts({ limit = 20 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const [rows, total] = await Promise.all([repo.listMissing({ limit: size }), repo.countMissing()]);
  const people = await users.findByIds([...new Set(rows.map((row) => row.userId))]);
  const byId = new Map(people.map((person) => [person.id, person]));
  const items = rows.map((row) => {
    const person = byId.get(row.userId);
    return { ...row, user: person ? publicPerson(person) : { id: row.userId, name: 'Someone' } };
  });
  return { items, total };
}

const WHERE_WORDS = {
  office: 'Office',
  wfh: 'WFH',
  unverified: 'Office (unverified)',
  not_checked_in: 'Not checked in',
};

const CHECKOUT_WORDS = {
  open: 'Open',
  checked_out: 'Checked out',
  missing: 'Missing',
  corrected: 'Corrected',
};

/**
 * The Excel download for a day (GET /api/attendance/export): one sheet, one row per person.
 * @param {string} workDate
 * @returns {Promise<{ filename: string, sheets: object[] }>} input for xlsxResponse()
 */
export async function exportDay(workDate) {
  const [items, current] = await Promise.all([listDay(workDate), settings.getAll()]);
  const tz = current.timezone;
  // 24-hour clocks: "6:34" alone can't be told from 6:34 AM in a spreadsheet.
  const clock = (at) => (at ? toLocal(at, tz).format('HH:mm') : '');
  const hours = (minutes) => (minutes === null ? null : Math.round((minutes / 60) * 100) / 100);
  const rows = items.map((item) => {
    const { user, attendance, where, presentMinutes: present } = item;
    return {
      name: user.name,
      email: user.email ?? '',
      designation: user.designation ?? '',
      department: user.departmentName ?? '',
      where: WHERE_WORDS[where],
      checkIn: clock(attendance?.checkInAt),
      checkOut: clock(attendance?.checkOutAt),
      presentHours: hours(present),
      breakMinutes: present === null ? null : item.breakMinutes,
      workedHours: hours(item.workedMinutes),
      lateMinutes: attendance ? attendance.lateMinutes : null,
      checkout: attendance ? CHECKOUT_WORDS[attendance.checkoutStatus] : '',
      note: attendance?.note ?? '',
    };
  });
  return {
    filename: `attendance-${workDate}.xlsx`,
    sheets: [
      {
        name: `Attendance ${workDate}`,
        columns: [
          { header: 'Name', key: 'name', width: 24 },
          { header: 'Email', key: 'email', width: 28 },
          { header: 'Designation', key: 'designation', width: 22 },
          { header: 'Department', key: 'department', width: 16 },
          { header: 'Where', key: 'where', width: 20 },
          { header: 'Check-in', key: 'checkIn', width: 10 },
          { header: 'Check-out', key: 'checkOut', width: 10 },
          { header: 'Present (hours)', key: 'presentHours', width: 15, numFmt: '0.00' },
          { header: 'Breaks (minutes)', key: 'breakMinutes', width: 16 },
          { header: 'Worked (hours)', key: 'workedHours', width: 15, numFmt: '0.00' },
          { header: 'Late (minutes)', key: 'lateMinutes', width: 14 },
          { header: 'Check-out status', key: 'checkout', width: 16 },
          { header: 'Note', key: 'note', width: 40 },
        ],
        rows,
      },
    ],
  };
}

/**
 * The date a screen asks for, clamped to today (no future days). Anything that isn't a real
 * 'YYYY-MM-DD' calendar date (pages pass the raw ?date= value) falls back to today.
 * @param {string | null | undefined} date
 * @returns {Promise<string>}
 */
export async function resolveDate(date) {
  const today = todayFor(await settings.getAll());
  const parsed = dateString().safeParse(date);
  if (!parsed.success) return today;
  return parsed.data > today ? today : parsed.data;
}
