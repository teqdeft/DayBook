// zod schemas for the holiday and leave endpoints (CONTRACT 25, items 6 and 9). Messages are
// written for people and every string has a length check (MySQL 8.4 rejects over-long strings that
// local MariaDB would cut). The rules that need today or the database (the holiday date window,
// 60 holidays a year, the days of a leave, the person) are checked by the services.
import { z } from 'zod';
import { LEAVE_PARTS, LEAVE_TYPES } from './calendar';
import { dateString } from './schemas';

export const HOLIDAY_NAME_MESSAGE = 'Name the holiday (2 to 80 characters).';
export const NOTE_MAX = 300;
export const REASON_MAX = 500;

const ID_RE = /^\d{1,15}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** '' and null read as left out (query strings and cleared form fields). */
const blankToUndefined = (schema) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema);

const idValue = (message) =>
  z.coerce.number({ error: message }).int(message).positive(message).max(1e15, message);

const holidayName = z
  .string({ error: HOLIDAY_NAME_MESSAGE })
  .trim()
  .min(2, HOLIDAY_NAME_MESSAGE)
  .max(80, HOLIDAY_NAME_MESSAGE);

const part = z.enum(LEAVE_PARTS, { error: 'Pick full day, first half or second half.' });
const leaveType = z.enum(LEAVE_TYPES, { error: 'Pick casual, sick or other.' });
const paid = z.boolean({ error: 'Pick paid or unpaid.' });

/** The leave note: trimmed, at most 300 characters, '' and null clear it. */
const note = z
  .string({ error: 'The note must be text.' })
  .trim()
  .max(NOTE_MAX, `Keep the note to ${NOTE_MAX} characters or fewer.`)
  .nullable()
  .transform((value) => (value ? value : null));

/** The reason of a leave change or delete: 2 to 500 characters. */
const reason = z
  .string({ error: 'Add a reason.' })
  .trim()
  .min(2, 'Add a reason.')
  .max(REASON_MAX, `Keep it to ${REASON_MAX} characters or fewer.`);

const limit = z.coerce
  .number({ error: 'The limit must be a number.' })
  .int('The limit must be a whole number.')
  .min(1, 'The limit must be at least 1.')
  .max(100, 'The limit can be at most 100.')
  .default(50);

const offset = z.coerce
  .number({ error: 'The offset must be a number.' })
  .int('The offset must be a whole number.')
  .min(0, 'The offset cannot be negative.')
  .default(0);

/**
 * The numeric :id of a holiday or leave route, or null when it isn't plain digits (the routes
 * answer 404, so ids can't be probed with odd values).
 * @param {Record<string, string>} params
 * @returns {number | null}
 */
export function calendarIdOf(params) {
  const value = String(params?.id ?? '');
  return ID_RE.test(value) && Number(value) > 0 ? Number(value) : null;
}

// ---------- holidays (item 6) ----------

/** GET /api/holidays?year= (a year outside last year to next year reads as the nearest one). */
export const holidayListQuerySchema = z.object({
  year: blankToUndefined(
    z.coerce
      .number({ error: 'Pick a year like 2026.' })
      .int('Pick a year like 2026.')
      .min(2000, 'Pick a year like 2026.')
      .max(2100, 'Pick a year like 2026.')
      .optional(),
  ),
});

/** POST /api/holidays */
export const holidayCreateSchema = z.object({
  date: dateString('Pick a date.'),
  name: holidayName,
});

/** PATCH /api/holidays/:id: the date, the name or both. */
export const holidayUpdateSchema = z
  .object({
    date: dateString('Pick a date.').optional(),
    name: holidayName.optional(),
  })
  .refine((value) => value.date !== undefined || value.name !== undefined, {
    message: 'Change the date or the name.',
    path: ['date'],
  });

// ---------- leave (item 9) ----------

/** GET /api/leave?month=&from=&to=&userId=&limit=&offset= */
export const leaveListQuerySchema = z.object({
  month: blankToUndefined(
    z
      .string({ error: 'Use a month like 2026-11.' })
      .regex(MONTH_RE, 'Use a month like 2026-11.')
      .optional(),
  ),
  from: blankToUndefined(dateString('Pick a date like 2026-11-01.').optional()),
  to: blankToUndefined(dateString('Pick a date like 2026-11-30.').optional()),
  userId: blankToUndefined(idValue('That id is not valid.').optional()),
  limit,
  offset,
});

/** POST /api/leave (part, pay and type default to a full, paid, casual day). */
export const leaveCreateSchema = z.object({
  userId: idValue('Pick a person.'),
  fromDate: dateString('Pick the first day.'),
  toDate: blankToUndefined(dateString('Pick the last day.').optional()),
  part: part.default('full'),
  paid: paid.default(true),
  leaveType: leaveType.default('casual'),
  note: note.optional().transform((value) => value ?? null),
});

/** PATCH /api/leave/:id: what changes (left out = unchanged; a blank note clears it) and why. */
export const leaveUpdateSchema = z.object({
  fromDate: blankToUndefined(dateString('Pick the first day.').optional()),
  toDate: blankToUndefined(dateString('Pick the last day.').optional()),
  part: part.optional(),
  paid: paid.optional(),
  leaveType: leaveType.optional(),
  note: note.optional(),
  reason,
});

/** DELETE /api/leave/:id (a body on DELETE, as push/subscriptions) */
export const leaveDeleteSchema = z.object({ reason });

/** GET /api/leave/preview?userId=&fromDate=&toDate=&part=&excludeId= */
export const leavePreviewQuerySchema = z.object({
  userId: idValue('Pick a person.'),
  fromDate: dateString('Pick the first day.'),
  toDate: blankToUndefined(dateString('Pick the last day.').optional()),
  part: blankToUndefined(part.optional()).transform((value) => value ?? 'full'),
  excludeId: blankToUndefined(idValue('That id is not valid.').optional()),
});
