// One person's attendance month for HR (CONTRACT 25, item 8): the month's numbers (the month
// view's MonthPerson), each listed day up to today, the calendar's tones and the changes HR,
// Admins and the person made. An Admin's month is NOT_FOUND for anyone but an Admin (company
// rule). The person's own month is viewable without actions and without leave notes. Never an
// attendance IP, report content or screen time.
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { addDays, formatClock } from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { dayPersonOf } from './calendarReads';
import { loadPeriod, publicDay, summarizeOne } from './month';
import { isListedDay, toneOfDay } from './monthRules';
import { resolvePayrollMonth } from './payroll';
import { CHANGE_ACTIONS, LEAVE_ACTIONS, changeView, leaveEntryChange } from './personChanges';
import { showsAttendanceOf } from './rules';

const CHANGES_SHOWN = 50;
/** Leave rows of entries that left the month are looked for from 400 days before it starts. */
const LEAVE_LOOKBACK_DAYS = 400;

const newestFirst = (a, b) =>
  new Date(b.at).valueOf() - new Date(a.at).valueOf() || String(b.id).localeCompare(String(a.id));

/** Whether a leave snapshot (an audit row's before or after) is the person's and touches the span. */
function touches(leave, { userId, from, to }) {
  if (!leave?.fromDate || Number(leave.userId) !== userId) return false;
  return leave.fromDate <= to && (leave.toDate ?? leave.fromDate) >= from;
}

/**
 * The month's leave audit rows: every row of the entries touching it, plus the rows of entries
 * that left it (deleted, or moved to another month) whose before or after is the person's and
 * touches it, so a removed leave still shows with its reason. Merged by audit id.
 */
async function loadLeaveAudits({ leaveEntries, span }) {
  const since = new Date(`${addDays(span.from, -LEAVE_LOOKBACK_DAYS)}T00:00:00Z`);
  const [ofEntries, recent] = await Promise.all([
    audit.listForEntities({
      entityType: 'leave',
      entityIds: leaveEntries.map((entry) => entry.id),
      actions: LEAVE_ACTIONS,
    }),
    audit.listForType({ entityType: 'leave', since, actions: LEAVE_ACTIONS }),
  ]);
  const seen = new Set(ofEntries.map((entry) => entry.id));
  const left = recent.filter(
    (entry) => !seen.has(entry.id) && (touches(entry.before, span) || touches(entry.after, span)),
  );
  return [...ofEntries, ...left];
}

/** The month's changes, newest first, at most 50 (and whether there were more). */
async function loadChanges({ rows, leaveEntries, span, tz, own }) {
  const [rowAudits, leaveAudits] = await Promise.all([
    audit.listForEntities({
      entityType: 'attendance',
      entityIds: rows.map((row) => row.id),
      actions: CHANGE_ACTIONS,
      limit: CHANGES_SHOWN + 1,
    }),
    loadLeaveAudits({ leaveEntries, span }),
  ]);
  const entries = [...rowAudits, ...leaveAudits];
  const actorIds = entries.map((entry) => entry.actorId).filter(Boolean);
  const actors = new Map((await users.findByIds(actorIds)).map((user) => [user.id, user]));
  const ctx = { actors, rowDates: new Map(rows.map((row) => [row.id, row.workDate])), tz, own };
  const audited = new Set(leaveAudits.map((entry) => Number(entry.entityId)));
  const changes = [
    ...entries.map((entry) => changeView(entry, ctx)),
    ...leaveEntries
      .filter((entry) => !audited.has(entry.id))
      .map((entry) => leaveEntryChange(entry, { own })),
  ]
    .filter(Boolean)
    .sort(newestFirst);
  return { changes: changes.slice(0, CHANGES_SHOWN), changesMore: changes.length > CHANGES_SHOWN };
}

/** The profile card's person ("Shift 9:30 AM to 6:30 PM": their own shift, else office hours). */
function personView(person, current) {
  const start = person.shiftStart || current.officeStart;
  const end = person.shiftEnd || current.officeEnd;
  return {
    id: person.id,
    name: person.name,
    initials: person.initials,
    avatarUrl: person.avatarUrl,
    email: person.email,
    designation: person.designation,
    departmentName: person.departmentName,
    role: person.role,
    status: person.status,
    tracksAttendance: person.tracksAttendance,
    joinedOn: person.joinedOn ?? null,
    leftOn: dayPersonOf(person, current.timezone).leftOn,
    shift: `Shift ${formatClock(start)} to ${formatClock(end)}`,
  };
}

/**
 * One person's payroll month for HR and Admins.
 * @param {{ viewer: object, userId: number, month?: string }} input month 'YYYY-MM' (the month
 *   view's rules: a later one reads as the current one; none opens the previous period on its
 *   first 3 days)
 * @returns {Promise<{ period: object, person: object, totals: MonthPerson, days: MonthDay[],
 *   tones: Record<string, string>, changes: object[], changesMore: boolean, canChange: boolean,
 *   untracked: boolean, available: { holidays: boolean, leave: boolean }, through: string,
 *   today: string }>} days = the listed days up to today, oldest first; tones = every date of
 *   the period; untracked = doesn't track attendance and has no row in the month
 * @throws NOT_FOUND "We couldn't find that person." (unknown, or an Admin for a non-Admin)
 */
export async function getPersonMonth({ viewer, userId, month } = {}) {
  const person = await users.findById(userId);
  if (!person || !showsAttendanceOf(viewer, person)) {
    throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  }
  const current = await settings.getAll();
  const period = resolvePayrollMonth(month, current);
  const range = { from: period.from, to: period.to };
  const loaded = await loadPeriod({ people: [person], ...range, withNotes: true });
  const { summary, days } = summarizeOne(person, loaded, { ...range, viewer });
  const own = viewer?.id === person.id;
  const { changes, changesMore } = await loadChanges({
    rows: loaded.rows,
    leaveEntries: loaded.leaveEntries,
    span: { userId: Number(person.id), ...range },
    tz: current.timezone,
    own,
  });
  return {
    period,
    person: personView(person, current),
    totals: summary,
    days: days.filter((item) => isListedDay(item, loaded.through)).map(publicDay),
    tones: Object.fromEntries(days.map((item) => [item.date, toneOfDay(item, loaded.today)])),
    changes,
    changesMore,
    canChange: can(viewer, 'attendance.correct') && !own,
    untracked: !person.tracksAttendance && loaded.rows.length === 0,
    available: { holidays: loaded.calendar.available, leave: loaded.calendar.available },
    through: loaded.through,
    today: loaded.today,
  };
}
