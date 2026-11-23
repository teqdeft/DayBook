// "Changes this month" on HR's person month (CONTRACT 25, item 8): the audit rows of the month's
// attendance rows and leave, as a title and detail lines. Pure: no database (personMonth.js does
// the reads). Only the allow-listed actions show (never mark_missing and auto_checkout, which are
// tags on the day, nor unverified_office, whose reason is the person's own check-in note), and
// never the audit IP. A day is written "Fri, 13 Nov", a time "6:41 PM".
import { formatClock, formatDayShort, formatDuration, formatTimeAmPm } from '@/lib/time';
import { LEAVE_TYPE_LABELS, PART_LABELS } from './calendar';
import { formatDayRange } from './wording';

/** The attendance actions the person month lists, oldest kinds first. */
export const CHANGE_ACTIONS = [
  'attendance.create',
  'attendance.edit',
  'attendance.correct',
  'attendance.confirm_office',
  'attendance.self_checkout',
  'attendance.fix_missing',
  'attendance.break_change',
  'attendance.break_delete',
  'attendance.away_checkout',
  'attendance.away_put_back',
  'attendance.day_rules',
  'attendance.away_backfill',
];

export const LEAVE_ACTIONS = ['leave.create', 'leave.update', 'leave.delete'];

const PLACES = { office: 'Office', wfh: 'WFH' };

const timeOf = (at, tz) => (at ? formatTimeAmPm(at, tz) : 'none');

/** '18:41' → '6:41 PM'; a moment → its company time. */
function clockText(value, tz) {
  if (!value) return null;
  return /^\d{1,2}:\d{2}$/.test(String(value)) ? formatClock(value) : formatTimeAmPm(value, tz);
}

/** "Check-in 9:58 AM to 9:30 AM", "Check-out none to 7:10 PM", "Place WFH to Office". */
function rowDetails(before, after, tz) {
  const lines = [];
  const was = before ?? {};
  const now = after ?? {};
  if (timeOf(was.checkInAt, tz) !== timeOf(now.checkInAt, tz)) {
    lines.push(`Check-in ${timeOf(was.checkInAt, tz)} to ${timeOf(now.checkInAt, tz)}`);
  }
  if (timeOf(was.checkOutAt, tz) !== timeOf(now.checkOutAt, tz)) {
    lines.push(`Check-out ${timeOf(was.checkOutAt, tz)} to ${timeOf(now.checkOutAt, tz)}`);
  }
  if (was.location && now.location && was.location !== now.location) {
    lines.push(
      `Place ${PLACES[was.location] ?? was.location} to ${PLACES[now.location] ?? now.location}`,
    );
  }
  return lines;
}

/** "Break 1:10 PM to 1:45 PM" (a break still open: "Break from 1:10 PM"). */
function breakSpan(item, tz) {
  if (!item?.startedAt) return 'Break';
  if (!item.endedAt) return `Break from ${formatTimeAmPm(item.startedAt, tz)}`;
  return `Break ${formatTimeAmPm(item.startedAt, tz)} to ${formatTimeAmPm(item.endedAt, tz)}`;
}

function selfCheckoutDetail(after, tz) {
  const out = `Check-out ${timeOf(after?.checkOutAt, tz)}`;
  if (!after?.pastLastSeen) return out;
  const seen = clockText(after.suggestedClock, tz);
  return seen
    ? `${out}, Daybook last saw them at ${seen}`
    : `${out}, no sign of work after the check-in`;
}

/** "Late 22m to none", "Working day to not a working day", "Because: Holiday added: Diwali". */
function dayRulesDetails(entry) {
  const was = entry.before ?? {};
  const now = entry.after ?? {};
  const late = (minutes) => (minutes > 0 ? formatDuration(minutes) : 'none');
  const lines = [];
  if ((was.lateMinutes ?? 0) !== (now.lateMinutes ?? 0)) {
    lines.push(`Late ${late(was.lateMinutes ?? 0)} to ${late(now.lateMinutes ?? 0)}`);
  }
  if (Boolean(was.isWorkingDay) !== Boolean(now.isWorkingDay)) {
    lines.push(
      now.isWorkingDay ? 'Not a working day to working day' : 'Working day to not a working day',
    );
  }
  if (entry.reason) lines.push(`Because: ${entry.reason}`);
  return lines;
}

/** Title and details of an attendance audit row about one day. */
function attendanceText(entry, { who, day, tz }) {
  const { before, after } = entry;
  switch (entry.action) {
    case 'attendance.create': {
      const parts = [`In ${timeOf(after?.checkInAt, tz)}`];
      if (after?.checkOutAt) parts.push(`out ${timeOf(after.checkOutAt, tz)}`);
      if (after?.location) parts.push(PLACES[after.location] ?? after.location);
      return { title: `${who} added ${day}`, details: [parts.join(', ')] };
    }
    case 'attendance.edit':
      return { title: `${who} changed ${day}`, details: rowDetails(before, after, tz) };
    case 'attendance.correct':
      return {
        title: `${who} approved a correction for ${day}`,
        details: rowDetails(before, after, tz),
        note: after?.handlerNote ?? null,
      };
    case 'attendance.confirm_office':
      return { title: `${who} confirmed the office check-in on ${day}`, details: [] };
    case 'attendance.self_checkout':
      return {
        title: `${who} entered the check-out for ${day}`,
        details: [selfCheckoutDetail(after, tz)],
      };
    case 'attendance.fix_missing':
      return {
        title: `${who} entered the check-out for ${day}`,
        details: [
          `Check-out ${timeOf(after?.checkOutAt, tz)}${after?.suggested ? ', suggested' : ''}`,
        ],
      };
    case 'attendance.break_change':
      return {
        title: `${who} changed a break on ${day}`,
        details: [
          `Break from ${timeOf(before?.startedAt, tz)}, end ${timeOf(before?.endedAt, tz)} to ${timeOf(after?.endedAt, tz)}`,
        ],
      };
    case 'attendance.break_delete':
      return { title: `${who} deleted a break on ${day}`, details: [breakSpan(before, tz)] };
    case 'attendance.away_checkout':
      return {
        title: `${who} checked out from the timer question on ${day}`,
        details: rowDetails(
          { checkOutAt: before?.checkOutAt },
          { checkOutAt: after?.checkOutAt },
          tz,
        ),
      };
    case 'attendance.away_put_back':
      return {
        title: `${who} put back time removed from a timer on ${day}`,
        details: [`${breakSpan(before, tz)} removed`],
      };
    case 'attendance.day_rules':
      return {
        title: `Late mark updated on ${day}`,
        details: dayRulesDetails(entry),
        byLine: true,
      };
    case 'attendance.away_backfill':
      return {
        title: `Daybook counted time removed from a timer as a break on ${day}`,
        details: [breakSpan(after, tz)],
        byLine: true,
      };
    default:
      return null; // a future action never shows untitled
  }
}

/** "Casual, paid, full day". */
function leaveKind(leave) {
  const type = LEAVE_TYPE_LABELS[leave?.leaveType] ?? LEAVE_TYPE_LABELS.casual;
  const pay = leave?.paid === false ? 'unpaid' : 'paid';
  const part = (PART_LABELS[leave?.part] ?? PART_LABELS.full).toLowerCase();
  return `${type}, ${pay}, ${part}`;
}

const LEAVE_VERBS = {
  'leave.create': 'marked leave for',
  'leave.update': 'changed leave for',
  'leave.delete': 'removed leave for',
};

function leaveText(entry, { who }) {
  const leave = entry.action === 'leave.delete' ? entry.before : (entry.after ?? entry.before);
  const verb = LEAVE_VERBS[entry.action];
  if (!verb || !leave?.fromDate) return null;
  return {
    title: `${who} ${verb} ${formatDayRange(leave.fromDate, leave.toDate ?? leave.fromDate)}`,
    details: [leaveKind(leave)],
    note: leave.note ?? null,
  };
}

/**
 * One change as the person month shows it, or null for an action it doesn't list.
 * @param {{ id: number, actorId: number | null, action: string, entityType: string,
 *   entityId: number, before: object | null, after: object | null, reason: string | null,
 *   createdAt: Date }} entry an audit row (listForEntities)
 * @param {{ actors: Map<number, { id: number, name: string }>, rowDates: Map<number, string>,
 *   tz: string, own: boolean }} ctx own = the viewer is the person (no notes)
 * @returns {{ id: string, at: Date, actor: { id: number, name: string } | null, action: string,
 *   title: string, details: string[], reason: string | null, note: string | null,
 *   byLine: boolean } | null} byLine = the time line names who did it ("by Neha Kapoor, …")
 */
export function changeView(entry, { actors, rowDates, tz, own }) {
  const actor = entry.actorId ? (actors.get(Number(entry.actorId)) ?? null) : null;
  const who = actor?.name ?? 'Daybook';
  let text = null;
  if (entry.entityType === 'leave') text = leaveText(entry, { who });
  else {
    const workDate = rowDates.get(Number(entry.entityId)) ?? entry.after?.workDate;
    if (workDate) text = attendanceText(entry, { who, day: formatDayShort(workDate), tz });
  }
  if (!text) return null;
  const inDetails = entry.action === 'attendance.day_rules';
  return {
    id: `${entry.entityType}:${entry.id}`,
    at: entry.createdAt,
    actor: actor ? { id: actor.id, name: actor.name } : null,
    action: entry.action,
    title: text.title,
    details: text.details.filter(Boolean),
    reason: inDetails ? null : (entry.reason ?? null),
    note: own ? null : (text.note ?? null),
    byLine: Boolean(text.byLine),
  };
}

/**
 * A leave entry with no audit row of its own (marked before audits existed, or by the demo data)
 * as a "marked leave" change.
 * @param {{ id: number, fromDate: string, toDate: string, part: string, paid: boolean,
 *   leaveType: string, note: string | null, createdBy: number | null, createdByName?: string,
 *   createdAt: Date }} entry
 * @param {{ own: boolean }} ctx
 */
export function leaveEntryChange(entry, { own }) {
  const who = entry.createdByName ?? 'HR';
  return {
    id: `leave-entry:${entry.id}`,
    at: entry.createdAt,
    actor: entry.createdBy ? { id: entry.createdBy, name: who } : null,
    action: 'leave.create',
    title: `${who} marked leave for ${formatDayRange(entry.fromDate, entry.toDate)}`,
    details: [leaveKind(entry)],
    reason: null,
    note: own ? null : (entry.note ?? null),
    byLine: false,
  };
}
