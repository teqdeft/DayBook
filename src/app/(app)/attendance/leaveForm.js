// The Mark leave dialog's model (CONTRACT 25, item 9), pure so LeaveDialog and the unit tests
// share it: the form's starting values, Last day following First day until the person picks one
// of its own (the WFH dialog's rule), the halves disabled while the days differ, the preview's
// query and its lines, and the body sent to the API. Client-safe: @/lib/time and the pure
// calendar constants only.
import { dayjs, formatClockShort, formatDayShort } from '@/lib/time';
import { LEAVE_TYPE_LABELS, PART_LABELS } from '@/modules/attendance/calendar';

export const NOTE_MAX = 300;
export const REASON_MAX = 500;
/** The field names the API's errors may name; anything else is toasted. */
export const LEAVE_FIELDS = new Set([
  'userId',
  'fromDate',
  'toDate',
  'part',
  'paid',
  'leaveType',
  'note',
  'reason',
]);

export const TYPE_OPTIONS = Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
export const PAY_ITEMS = [
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid', label: 'Unpaid' },
];

const MAX_OFF_NOTES = 3;
export const WAITING_LINE = 'Counting working days…';
export const ERROR_LINE = "Couldn't check these dates. Saving checks them again.";

/**
 * The days of a range as rows show them ("Tue, 14 Oct", "Tue, 14 – Thu, 16 Oct", "Fri, 30 Oct –
 * Mon, 2 Nov", with the years across a year end), as the server's formatDayRange.
 */
export function dayRange(from, to = from) {
  if (!to || to === from) return formatDayShort(from);
  const [first, last] = [dayjs(from, 'YYYY-MM-DD'), dayjs(to, 'YYYY-MM-DD')];
  if (first.year() !== last.year()) {
    return `${first.format('ddd, D MMM YYYY')} – ${last.format('ddd, D MMM YYYY')}`;
  }
  if (first.month() !== last.month()) return `${formatDayShort(from)} – ${formatDayShort(to)}`;
  return `${first.format('ddd, D')} – ${formatDayShort(to)}`;
}

/** "Mon, 23 – Wed, 25 Nov", or "Fri, 20 Nov, second half" for a half day. */
export function leaveDaysLabel({ fromDate, toDate, part }) {
  const range = dayRange(fromDate, toDate);
  return part && part !== 'full' ? `${range}, ${PART_LABELS[part].toLowerCase()}` : range;
}

/**
 * The form a dialog opens with.
 * @param {{ entry?: object | null, userId?: number | null, date?: string | null }} input entry =
 *   a LeaveEntry to edit; otherwise the person (preset from a row) and the day both dates start
 *   at (the row's date, or today from the Leave page and the card)
 */
export function initialLeaveForm({ entry, userId, date }) {
  if (entry) {
    return {
      userId: String(entry.user.id),
      fromDate: entry.fromDate,
      toDate: entry.toDate,
      toTouched: entry.toDate !== entry.fromDate,
      part: entry.part,
      pay: entry.paid === false ? 'unpaid' : 'paid',
      leaveType: entry.leaveType,
      note: entry.note ?? '',
      reason: '',
    };
  }
  return {
    userId: userId ? String(userId) : '',
    fromDate: date ?? '',
    toDate: date ?? '',
    toTouched: false,
    part: 'full',
    pay: 'paid',
    leaveType: 'casual',
    note: '',
    reason: '',
  };
}

/** True when the form covers one day (a half day is possible). */
export function isOneDay(form) {
  return Boolean(form.fromDate) && (!form.toDate || form.toDate === form.fromDate);
}

/** A half day falls back to a full day once the days differ. */
function keepPart(form) {
  return isOneDay(form) || form.part === 'full' ? form : { ...form, part: 'full' };
}

/** First day changes: Last day follows it until picked by hand, and never stays before it. */
export function withFromDate(form, fromDate) {
  const follows = !form.toTouched || !form.toDate || (fromDate && form.toDate < fromDate);
  return keepPart({ ...form, fromDate, toDate: follows ? fromDate : form.toDate });
}

/** Last day changes: from now on it no longer follows First day. */
export function withToDate(form, toDate) {
  return keepPart({ ...form, toDate, toTouched: true });
}

/** The "Part of the day" items: the halves are disabled while the days differ. */
export function partItems(form) {
  const oneDay = isOneDay(form);
  return Object.entries(PART_LABELS).map(([value, label]) => ({
    value,
    label,
    disabled: value !== 'full' && !oneDay,
  }));
}

/**
 * The help under "Part of the day": "Half days are for one day." while the days differ, else the
 * person's split once the preview has told it ("First half: until 2:00. Second half: from 2:00.").
 * @param {object} form
 * @param {string | null} split 'HH:mm'
 * @returns {string | null}
 */
export function partHelp(form, split) {
  if (!isOneDay(form)) return 'Half days are for one day.';
  if (!split) return null;
  const clock = formatClockShort(split);
  return `First half: until ${clock}. Second half: from ${clock}.`;
}

/**
 * The preview's query string, or null while the form can't be previewed (no person, no first
 * day, or Last day before First day).
 * @param {object} form
 * @param {{ excludeId?: number | null }} [options] the entry being edited
 * @returns {string | null}
 */
export function previewQuery(form, { excludeId } = {}) {
  const toDate = form.toDate || form.fromDate;
  if (!form.userId || !form.fromDate || toDate < form.fromDate) return null;
  const params = new URLSearchParams({
    userId: form.userId,
    fromDate: form.fromDate,
    toDate,
    part: form.part,
  });
  if (excludeId) params.set('excludeId', String(excludeId));
  return params.toString();
}

function mainLine(preview, form) {
  const days = preview.workingDays;
  if (form.part !== 'full') return 'Half a working day.';
  if (days === 1) return '1 working day.';
  return `${days} working days: ${dayRange(form.fromDate, form.toDate || form.fromDate)}.`;
}

function offLines(offDays) {
  const lines = offDays
    .slice(0, MAX_OFF_NOTES)
    .map((day) =>
      day.why === 'holiday'
        ? `${formatDayShort(day.date)} is a holiday (${day.name}) and isn't counted.`
        : `${formatDayShort(day.date)} isn't a working day and isn't counted.`,
    );
  const more = offDays.length - MAX_OFF_NOTES;
  if (more > 0) lines.push(`and ${more} more ${more === 1 ? 'day' : 'days'} off`);
  return lines;
}

function checkInLine(dates, firstName) {
  if (dates.length === 0) return null;
  if (dates.length === 1) {
    return `${firstName} checked in on ${formatDayShort(dates[0])}. The check-in stays.`;
  }
  if (dates.length === 2) {
    const [a, b] = dates.map(formatDayShort);
    return `${firstName} checked in on ${a} and ${b}. The check-ins stay.`;
  }
  return `${firstName} checked in on ${dates.length} of these days. The check-ins stay.`;
}

/**
 * The live preview's lines (role="status"): the main line, then one muted note per day not
 * counted (at most 3), the check-ins (marigold), an overlap and no working days (red). While it
 * waits or after an error a single muted line; Save stays enabled then (saving checks again).
 * @param {{ status: 'idle' | 'waiting' | 'ready' | 'error', preview?: object | null,
 *   form: object, personName?: string }} input
 * @returns {{ lines: Array<{ text: string, tone: 'main' | 'muted' | 'warn' | 'bad' }>,
 *   blocked: boolean }} blocked = Save is disabled (an overlap, or no working days)
 */
export function previewLines({ status, preview, form, personName = '' }) {
  if (status === 'waiting')
    return { lines: [{ text: WAITING_LINE, tone: 'muted' }], blocked: false };
  if (status === 'error') return { lines: [{ text: ERROR_LINE, tone: 'muted' }], blocked: false };
  if (status !== 'ready' || !preview) return { lines: [], blocked: false };
  const firstName = String(personName).trim().split(/\s+/)[0] || 'They';
  const lines = [];
  if (preview.workingDays > 0) lines.push({ text: mainLine(preview, form), tone: 'main' });
  for (const text of offLines(preview.offDays ?? [])) lines.push({ text, tone: 'muted' });
  const checkIns = checkInLine(preview.checkIns ?? [], firstName);
  if (checkIns) lines.push({ text: checkIns, tone: 'warn' });
  if (preview.overlap) {
    const day = formatDayShort(preview.overlap.firstDay ?? preview.overlap.fromDate);
    lines.push({ text: `${firstName} already has leave on ${day}.`, tone: 'bad' });
  }
  if (preview.workingDays === 0) {
    lines.push({ text: 'No working days in these dates.', tone: 'bad' });
  }
  return { lines, blocked: Boolean(preview.overlap) || preview.workingDays === 0 };
}

/**
 * The API body: POST /api/leave for a new entry, PATCH /api/leave/:id (with the reason) when
 * editing. A blank note is sent as null (it clears the note).
 * @param {object} form
 * @param {{ editing?: boolean }} [options]
 */
export function leaveBody(form, { editing = false } = {}) {
  const body = {
    fromDate: form.fromDate,
    toDate: form.toDate || form.fromDate,
    part: form.part,
    paid: form.pay !== 'unpaid',
    leaveType: form.leaveType,
    note: form.note.trim() || null,
  };
  if (editing) return { ...body, reason: form.reason };
  return { userId: Number(form.userId), ...body };
}
