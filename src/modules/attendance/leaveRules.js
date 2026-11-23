// The checks of a leave write and preview (CONTRACT 25, item 9, Limits), and the words a leave
// change is told in. The person is checked in a fixed order (exists and active, the actor may see
// them, not the actor, tracks attendance), so HR learns nothing about an Admin from which error
// comes back. Only the working days inside a leave are leave days (leaveDaysIn).
import { AppError, validationError } from '@/lib/errors';
import { dayjs, eachDay } from '@/lib/time';
import { users } from '@/modules/users';
import { LEAVE_PARTS, LEAVE_TYPE_LABELS, LEAVE_TYPES, PART_LABELS, personDay } from './calendar';
import { showsAttendanceOf } from './rules';
import { formatDayRange } from './wording';

/** The most days one leave entry may cover. */
export const MAX_LEAVE_DAYS = 366;
const NOTE_MAX = 300;
const REASON_MAX = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

const validDate = (value) =>
  typeof value === 'string' && DATE_RE.test(value) && dayjs(value, 'YYYY-MM-DD', true).isValid();

/**
 * The days of a leave: the first day, the last (the first when left out), at most 366 days, and
 * a half day on one day only.
 * @param {{ fromDate: string, toDate?: string | null, part?: string }} input
 * @returns {{ fromDate: string, toDate: string, part: 'full' | 'first_half' | 'second_half' }}
 * @throws VALIDATION_FAILED on fromDate, toDate or part
 */
export function checkLeaveDays({ fromDate, toDate, part = 'full' }) {
  if (!validDate(fromDate)) throw fieldError('fromDate', 'Pick the first day.');
  const last = toDate || fromDate;
  if (!validDate(last)) throw fieldError('toDate', 'Pick the last day.');
  if (last < fromDate) throw fieldError('toDate', "The last day can't be before the first day.");
  if (dayjs(last).diff(dayjs(fromDate), 'day') + 1 > MAX_LEAVE_DAYS) {
    throw fieldError('toDate', 'Mark up to a year at a time.');
  }
  if (!LEAVE_PARTS.includes(part)) {
    throw fieldError('part', 'Pick full day, first half or second half.');
  }
  if (part !== 'full' && last !== fromDate) {
    throw fieldError('part', 'Half days are for one day. Pick the same first and last day.');
  }
  return { fromDate, toDate: last, part };
}

/**
 * Pay, type and note of a leave (each from its list, the note at most 300 characters).
 * @param {{ paid?: boolean, leaveType?: string, note?: string | null }} input
 * @returns {{ paid: boolean, leaveType: string, note: string | null }}
 */
export function checkLeaveDetails({ paid = true, leaveType = 'casual', note = null }) {
  if (typeof paid !== 'boolean') throw fieldError('paid', 'Pick paid or unpaid.');
  if (!LEAVE_TYPES.includes(leaveType))
    throw fieldError('leaveType', 'Pick casual, sick or other.');
  const text = note === null || note === undefined ? '' : String(note).trim();
  if (text.length > NOTE_MAX) {
    throw fieldError('note', `Keep the note to ${NOTE_MAX} characters or fewer.`);
  }
  return { paid, leaveType, note: text || null };
}

/** The reason of a leave change or delete (2 to 500 characters). */
export function checkLeaveReason(reason) {
  const text = String(reason ?? '').trim();
  if (text.length < 2) throw fieldError('reason', 'Add a reason.');
  if (text.length > REASON_MAX) {
    throw fieldError('reason', `Keep it to ${REASON_MAX} characters or fewer.`);
  }
  return text;
}

const NO_PERSON = "We couldn't find that person.";

/**
 * The person a leave is for, checked in this order: exists and active (NOT_FOUND), the actor may
 * see them (an Admin's leave is the Admins'), not the actor, tracks attendance.
 * @param {{ actor: { id: number, role: string }, userId: number,
 *   hidden?: { code: string, message: string } }} input hidden = the answer for a person the
 *   actor may not see (FORBIDDEN "Only an Admin can mark an Admin's leave." by default; the
 *   preview answers NOT_FOUND, and an entry by id "That leave no longer exists.")
 * @returns {Promise<object>} the PublicUser
 * @throws NOT_FOUND, FORBIDDEN, CONFLICT
 */
export async function checkLeavePerson({ actor, userId, hidden }) {
  const person = await users.findById(userId);
  if (!person || person.status !== 'active') {
    throw new AppError('NOT_FOUND', { message: NO_PERSON });
  }
  if (!showsAttendanceOf(actor, person)) {
    const answer = hidden ?? {
      code: 'FORBIDDEN',
      message: "Only an Admin can mark an Admin's leave.",
    };
    throw new AppError(answer.code, { message: answer.message });
  }
  if (Number(actor.id) === Number(person.id)) {
    throw new AppError('FORBIDDEN', {
      message: "You can't mark your own leave. Ask another HR person or an Admin.",
    });
  }
  if (!person.tracksAttendance) {
    throw new AppError('CONFLICT', {
      message: `${person.name} doesn't check in, so there's no leave to mark.`,
    });
  }
  return person;
}

/** The preview's answer for someone the actor may not see (so it can't read an Admin's days). */
export const HIDDEN_FROM_PREVIEW = { code: 'NOT_FOUND', message: NO_PERSON };
/** An entry by id of someone the actor may not see. */
export const HIDDEN_ENTRY = { code: 'NOT_FOUND', message: 'That leave no longer exists.' };

/**
 * The leave days of an entry between `from` and `to` (inclusive): its working days for the
 * person (holidays, days the company doesn't work, and days before joining or after leaving left
 * out), each 1, or 0.5 for a half day.
 * @param {{ entry: { fromDate: string, toDate: string, part: string }, person: object,
 *   settings: object, holidays: Map<string, { id: number, name: string }>, from?: string,
 *   to?: string }} input person as dayPersonOf(); from and to default to the entry's own days
 * @returns {{ days: number, dates: string[] }} dates = the working days counted
 */
export function leaveDaysIn({ entry, person, settings, holidays, from, to }) {
  const start = from && from > entry.fromDate ? from : entry.fromDate;
  const end = to && to < entry.toDate ? to : entry.toDate;
  const dates = [];
  if (start <= end) {
    for (const date of eachDay(start, end)) {
      const day = personDay({ date, person, settings, holiday: holidays.get(date) ?? null });
      if (day.isWorkingDay && day.employed) dates.push(date);
    }
  }
  return { days: dates.length * (entry.part === 'full' ? 1 : 0.5), dates };
}

/** "Mon, 23 – Wed, 25 Nov", or "Fri, 20 Nov, second half" for a half day. */
export function leaveDaysText({ fromDate, toDate, part }) {
  const range = formatDayRange(fromDate, toDate);
  return part && part !== 'full' ? `${range}, ${PART_LABELS[part].toLowerCase()}` : range;
}

/** "Casual, paid." (never the note). */
export function leaveKindText({ leaveType, paid }) {
  const type = LEAVE_TYPE_LABELS[leaveType] ?? LEAVE_TYPE_LABELS.other;
  return `${type}, ${paid ? 'paid' : 'unpaid'}.`;
}

/** What the audit keeps of an entry: { userId, fromDate, toDate, part, paid, leaveType, note }. */
export function leaveSnapshot(entry) {
  const { userId, fromDate, toDate, part, paid, leaveType, note } = entry;
  return { userId, fromDate, toDate, part, paid: paid !== false, leaveType, note: note ?? null };
}
