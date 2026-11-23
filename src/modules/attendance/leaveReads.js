// The leave reads the screens show (CONTRACT 25, item 9): who is on leave on a date, the leave
// coming up and the person's own leave. Never the note (HR's), and the type and pay only for
// attendance.correct viewers. Empty before migration 018. The writes are F's (leave.js).
import { can } from '@/lib/permissions';
import { users } from '@/modules/users';
import { LEAVE_TYPE_LABELS, PART_LABELS } from './calendar';
import * as calendarRepo from './calendarRepo';
import { loadCalendar, publicPerson } from './calendarReads';
import { guard018Read } from './migration018';
import * as repo from './repo';
import { showsAttendanceOf } from './rules';

/** Active, tracked people of the entries that the viewer may see, by id. */
async function leavePeople(rows, viewer) {
  const people = await users.findByIds([...new Set(rows.map((row) => row.userId))]);
  const shown = people.filter(
    (person) =>
      person.status === 'active' && person.tracksAttendance && showsAttendanceOf(viewer, person),
  );
  return new Map(shown.map((person) => [person.id, person]));
}

/** Type and pay go only to attendance.correct viewers (and system reads without a viewer). */
function withDetail(item, leave, viewer) {
  if (viewer && !can(viewer, 'attendance.correct')) return item;
  return { ...item, leaveType: leave.leaveType, paid: leave.paid !== false };
}

const byName = (a, b) => a.user.name.localeCompare(b.user.name);

/**
 * Who is on leave on a date (a working day for them), by name. Admins only for an Admin viewer.
 * @param {string} date
 * @param {{ viewer?: object }} [options] none = a system read (everyone, with type and pay)
 * @returns {Promise<Array<{ user: object, part: 'full' | 'first_half' | 'second_half',
 *   checkedIn: boolean, leaveType?: string, paid?: boolean }>>} leaveType and paid only for
 *   attendance.correct viewers
 */
export async function listOnLeave(date, { viewer } = {}) {
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listLeave({ from: date, to: date }),
    () => [],
  );
  if (rows.length === 0) return [];
  const [people, calendar, dayRows] = await Promise.all([
    leavePeople(rows, viewer),
    loadCalendar({
      from: date,
      to: date,
      userIds: [...new Set(rows.map((row) => row.userId))],
      leaveDetail: true,
      withWfh: false,
    }),
    repo.listByDate(date),
  ]);
  const checkedIn = new Set(dayRows.map((row) => row.userId));
  const items = [];
  for (const person of people.values()) {
    const day = calendar.dayFor(person, date);
    if (!day.leave) continue;
    const item = {
      user: publicPerson(person),
      part: day.leave.part,
      checkedIn: checkedIn.has(person.id),
    };
    items.push(withDetail(item, day.leave, viewer));
  }
  return items.sort(byName);
}

/**
 * Leave starting from `from` to `to` (inclusive), soonest first, then by name.
 * @param {{ viewer?: object, from: string, to: string, limit?: number }} input
 * @returns {Promise<Array<{ user: object, part: string, checkedIn: boolean, fromDate: string,
 *   toDate: string, leaveType?: string, paid?: boolean }>>} checkedIn is false (days to come)
 */
export async function listUpcomingLeave({ viewer, from, to, limit = 5 }) {
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listLeave({ from, to }),
    () => [],
  );
  const starting = rows.filter((row) => row.fromDate >= from);
  if (starting.length === 0) return [];
  const people = await leavePeople(starting, viewer);
  const items = starting
    .filter((row) => people.has(row.userId))
    .map((row) => {
      const item = {
        user: publicPerson(people.get(row.userId)),
        part: row.part,
        checkedIn: false,
        fromDate: row.fromDate,
        toDate: row.toDate,
      };
      return withDetail(item, row, viewer);
    })
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || byName(a, b));
  return items.slice(0, Math.max(0, limit));
}

/**
 * The person's own leave sharing a day with `from`..`to`, oldest first. Never the note (HR's).
 * @param {{ user: { id: number }, from: string, to: string }} input
 * @returns {Promise<Array<{ id: number, fromDate: string, toDate: string, part: string,
 *   partLabel: string, paid: boolean, leaveType: string, typeLabel: string,
 *   markedBy: { name: string | null } }>>}
 */
export async function getMyLeave({ user, from, to }) {
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listLeave({ from, to, userIds: [user.id], withMarkedBy: true }),
    () => [],
  );
  return rows.map((row) => ({
    id: row.id,
    fromDate: row.fromDate,
    toDate: row.toDate,
    part: row.part,
    partLabel: PART_LABELS[row.part] ?? PART_LABELS.full,
    paid: row.paid !== false,
    leaveType: row.leaveType,
    typeLabel: LEAVE_TYPE_LABELS[row.leaveType] ?? LEAVE_TYPE_LABELS.other,
    markedBy: { name: row.markedByName ?? null },
  }));
}
