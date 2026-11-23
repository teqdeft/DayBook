// One month function every month reader reuses (CONTRACT 25, items 4, 8 and 10): summarizeRange
// loads a period for everyone (or some people) in about 8 queries plus one per 500 attendance
// rows (the audit chunks), with no per-day loop, and counts it with monthRules.js. getMonth is the
// month view (/attendance/month and GET /api/attendance/month): filters, counts and totals.
// Admins are counted only for an Admin viewer (company rule). Never report content, screen time
// or an attendance IP.
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { eachDay, isWorkingDay, localToUtc, now, workDate as localDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { dayPersonOf, loadCalendar, publicPerson } from './calendarReads';
import { isPastLastSeen } from './checkoutEntered';
import { guard018Read } from './migration018';
import * as monthRepo from './monthRepo';
import { classifyDay, isListedDay, summarizePerson } from './monthRules';
import { MONTH_FILTERS } from './monthSchemas';
import { resolvePayrollMonth } from './payroll';
import { showsAttendanceOf } from './rules';

const MAX_PEOPLE = 500;
const HISTORY_ACTIONS = ['attendance.mark_missing', 'attendance.auto_checkout'];

/**
 * Tracked people of the period the viewer may see (active, or deactivated on or after `from`;
 * joined by `to`), in id order, at most 500 (with one warning).
 * @param {{ from: string, to: string, viewer?: object | null, userIds?: number[] }} input
 * @returns {Promise<object[]>} PublicUser with deactivatedAt
 */
export async function peopleFor({ from, to, viewer, userIds }) {
  const wanted = userIds ? new Set(userIds.map(Number)) : null;
  const people = (await users.listTrackedForRange({ from, to }))
    .filter((person) => showsAttendanceOf(viewer, person))
    .filter((person) => !wanted || wanted.has(person.id))
    .sort((a, b) => a.id - b.id);
  if (people.length <= MAX_PEOPLE) return people;
  logger.warn({ people: people.length, from, to }, 'month summary cut to the first 500 people');
  return people.slice(0, MAX_PEOPLE);
}

/** The rows' mark_missing and auto_checkout audit rows (one query per 500 rows). */
async function historyOf(rows) {
  const entries = await audit.listForEntities({
    entityType: 'attendance',
    entityIds: rows.map((row) => row.id),
    actions: HISTORY_ACTIONS,
  });
  const history = new Map();
  for (const entry of entries) {
    const item = history.get(entry.entityId) ?? { missing: false, auto: false };
    if (entry.action === 'attendance.mark_missing') item.missing = true;
    else item.auto = true;
    history.set(entry.entityId, item);
  }
  return history;
}

/** Who entered a row's missing check-out, from the row's own columns (null before 018). */
function enteredOf(row) {
  if (!row.checkoutEnteredBy) return null;
  const self = row.checkoutEnteredBy === row.userId;
  const suggestedAt = row.checkoutSuggestedAt ?? null;
  return {
    id: row.checkoutEnteredBy,
    name: row.checkoutEnteredByName ?? '',
    at: row.checkoutEnteredAt ?? null,
    self,
    suggestedAt,
    pastLastSeen: isPastLastSeen({ self, checkOutAt: row.checkOutAt, suggestedAt }),
  };
}

function keyed(list, keyOf) {
  const map = new Map();
  for (const item of list) {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

/**
 * Loads a period for some people (the reads of summarizeRange, without the people query).
 * @param {{ people: object[], from: string, to: string, withNotes?: boolean }} input
 *   withNotes = also read the leave entries with their notes (the Excel and the person month)
 */
export async function loadPeriod({ people, from, to, withNotes = false }) {
  const current = await settings.getAll();
  const today = localDate(current.timezone);
  const through = to < today ? to : today;
  const ids = people.map((person) => person.id);
  const range = { userIds: ids, from, to };
  const [rows, breaks, submitted, calendar, leaveEntries] = await Promise.all([
    monthRepo.listRowsByRange(range),
    monthRepo.listBreaksByRange(range),
    reports.listSubmittedDays({ userIds: ids, from, to: through }),
    loadCalendar({ from, to, userIds: ids, leaveDetail: true }),
    withNotes
      ? guard018Read(
          'calendar',
          () => monthRepo.listLeaveEntries(range),
          () => [],
        )
      : [],
  ]);
  const history = await historyOf(rows);
  return {
    current,
    today,
    through,
    rows,
    rowsByUser: keyed(rows, (row) => row.userId),
    breaksByKey: keyed(breaks, (item) => `${item.userId}:${item.workDate}`),
    submitted,
    calendar,
    history,
    notes: new Map(leaveEntries.map((entry) => [entry.id, entry.note ?? null])),
    leaveEntries,
  };
}

/**
 * One person's MonthDays of the whole period and their MonthPerson.
 * @param {object} person PublicUser with deactivatedAt
 * @param {object} loaded loadPeriod()
 * @param {{ from: string, to: string, viewer?: object }} options the viewer never sees their own
 *   leave notes
 * @returns {{ summary: MonthPerson, days: MonthDay[] }} days = every date of the period
 */
export function summarizeOne(person, loaded, { from, to, viewer }) {
  const { current, today, through, calendar } = loaded;
  const tz = current.timezone;
  const at = now();
  const rows = new Map((loaded.rowsByUser.get(person.id) ?? []).map((row) => [row.workDate, row]));
  const submitted = new Set(loaded.submitted[person.id] ?? []);
  const own = viewer?.id === person.id;
  const reportSelf = can({ role: person.role }, 'report.self');
  const ctx = {
    today,
    through,
    at,
    tz,
    settings: current,
    reportSelf,
    reportDue: !at.isBefore(localToUtc(today, current.reportReminderAt, tz)),
  };
  const days = eachDay(from, to).map((date) => {
    const row = rows.get(date) ?? null;
    const day = calendar.dayFor(person, date);
    return classifyDay({
      date,
      day,
      row,
      breaks: loaded.breaksByKey.get(`${person.id}:${date}`) ?? [],
      history: (row && loaded.history.get(row.id)) || undefined,
      entered: row ? enteredOf(row) : null,
      submitted: submitted.has(date),
      leaveNote: day.leave && !own ? (loaded.notes.get(day.leave.id) ?? null) : null,
      ctx,
    });
  });
  const { leftOn } = dayPersonOf(person, tz);
  const summary = summarizePerson({
    person: { user: publicPerson(person), joinedOn: person.joinedOn ?? null, leftOn },
    days,
    ctx: { through, threshold: current.lateAlertDays, reportSelf },
  });
  return { summary, days };
}

/** A MonthDay as readers get it (without the internal counts). */
export function publicDay({ counts, ...item }) {
  return item;
}

/**
 * Everyone's month (CONTRACT 25, item 4): tracked people of the period (active, or deactivated on
 * or after `from`; joined by `to`) the viewer may see, in id order, at most 500.
 * @param {{ from: string, to: string, viewer?: { role: string } | null, userIds?: number[],
 *   withDays?: boolean }} input viewer = none for a system read (everyone); withDays adds each
 *   person's listed MonthDays (up to `through`) and the leave notes
 * @returns {Promise<{ from: string, to: string, through: string, today: string,
 *   holidays: Array<{ date: string, name: string }>, available: { holidays: boolean,
 *   leave: boolean }, people: MonthPerson[] }>}
 */
export async function summarizeRange({ from, to, viewer, userIds, withDays = false }) {
  const people = await peopleFor({ from, to, viewer, userIds });
  return summarizePeople({ people, from, to, viewer, withDays });
}

/**
 * summarizeRange() for people the caller already picked (the month Excel, one person's month).
 * @param {{ people: object[], from: string, to: string, viewer?: object | null,
 *   withDays?: boolean }} input
 */
export async function summarizePeople({ people, from, to, viewer, withDays = false }) {
  const loaded = await loadPeriod({ people, from, to, withNotes: withDays });
  const list = people.map((person) => {
    const { summary, days } = summarizeOne(person, loaded, { from, to, viewer });
    if (!withDays) return summary;
    const listed = days.filter((item) => isListedDay(item, loaded.through)).map(publicDay);
    return { ...summary, days: listed };
  });
  const { calendar } = loaded;
  return {
    from,
    to,
    through: loaded.through,
    today: loaded.today,
    holidays: [...calendar.holidays.entries()]
      .map(([date, holiday]) => ({ date, name: holiday.name }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    available: { holidays: calendar.available, leave: calendar.available },
    people: list,
  };
}

const MATCHES = {
  all: () => true,
  needs_look: (person) => person.needsLook.length > 0,
  late: (person) => person.lateDays > 0,
  short: (person) => person.halfDays + person.shortDays > 0,
  absent: (person) => person.absentDays > 0,
  leave: (person) => person.leave.total > 0,
  missing: (person) => person.missingCheckouts > 0,
};

const total = (people, pick) => people.reduce((sum, person) => sum + (pick(person) || 0), 0);

/** The company's numbers of the period (the five KPIs). */
function monthTotals(summary, workingDays) {
  const { people } = summary;
  const holidaySet = new Set(summary.holidays.map((holiday) => holiday.date));
  const dates = eachDay(summary.from, summary.to);
  const working = dates.filter((date) => isWorkingDay(date, workingDays, holidaySet));
  const lateDays = total(people, (person) => person.lateDays);
  const lateMinutes = total(people, (person) => person.lateMinutes);
  return {
    workingDays: working.length,
    workingDaysSoFar: working.filter((date) => date <= summary.through).length,
    holidays: summary.holidays.filter((holiday) => isWorkingDay(holiday.date, workingDays)).length,
    lateDays,
    latePeople: people.filter(MATCHES.late).length,
    lateAverageMinutes: lateDays ? Math.round(lateMinutes / lateDays) : 0,
    shortDays: total(people, (person) => person.halfDays + person.shortDays),
    leftEarlyDays: total(people, (person) => person.leftEarlyDays),
    leaveDays: total(people, (person) => person.leave.total),
    unpaidLeaveDays: total(people, (person) => person.leave.unpaid),
    absentDays: total(people, (person) => person.absentDays),
    absentPeople: people.filter(MATCHES.absent).length,
  };
}

/**
 * The month view: everyone's payroll month (Admins only for an Admin viewer), one filter.
 * @param {{ viewer: object, month?: string, filter?: string }} input month 'YYYY-MM' (a later
 *   one reads as the current one; none opens the previous one on the first 3 days of a period)
 * @returns {Promise<{ period: object, filter: string, counts: Record<string, number>,
 *   totals: object, rules: { halfDayUnderMinutes: number, shortDayUnderMinutes: number,
 *   leftEarlyGraceMinutes: number, lateAlertDays: number }, available: { holidays: boolean,
 *   leave: boolean }, through: string, today: string, people: MonthPerson[] }>} period =
 *   resolvePayrollMonth()
 */
export async function getMonth({ viewer, month, filter } = {}) {
  const current = await settings.getAll();
  const period = resolvePayrollMonth(month, current);
  const summary = await summarizeRange({ from: period.from, to: period.to, viewer });
  const chosen = MONTH_FILTERS.includes(filter) ? filter : 'all';
  const counts = Object.fromEntries(
    MONTH_FILTERS.map((key) => [key, summary.people.filter(MATCHES[key]).length]),
  );
  return {
    period,
    filter: chosen,
    counts,
    totals: monthTotals(summary, current.workingDays),
    rules: {
      halfDayUnderMinutes: current.halfDayUnderMinutes,
      shortDayUnderMinutes: current.shortDayUnderMinutes,
      leftEarlyGraceMinutes: current.leftEarlyGraceMinutes,
      lateAlertDays: current.lateAlertDays,
    },
    available: summary.available,
    through: summary.through,
    today: summary.today,
    people: summary.people.filter(MATCHES[chosen]),
  };
}
