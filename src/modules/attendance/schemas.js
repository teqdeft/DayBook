// zod schemas for the attendance endpoints. Messages are written for people. Every string has a
// length check: MySQL 8.4 rejects over-long strings that local MariaDB would silently cut.
import { z } from 'zod';
import { dayjs } from '@/lib/time';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** 'YYYY-MM-DD' that is a real calendar date. */
export const dateString = (message = 'Pick a date.') =>
  z
    .string({ error: message })
    .trim()
    .regex(DATE_RE, message)
    .refine((value) => dayjs(value, 'YYYY-MM-DD', true).isValid(), message);

/** '9:30', '09:30' or '09:30:00' -> '09:30' (company time). */
export const clockString = (message = 'Enter a time like 09:30.') =>
  z
    .string({ error: message })
    .trim()
    .regex(CLOCK_RE, message)
    .transform((value) => {
      const [h, m] = value.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    });

const reasonText = (label, max) =>
  z
    .string({ error: `Add ${label}.` })
    .trim()
    .min(1, `Add ${label}.`)
    .max(max, `Keep it to ${max} characters or fewer.`);

const optionalNote = (max) =>
  z
    .string({ error: 'The note must be text.' })
    .trim()
    .max(max, `Keep the note to ${max} characters or fewer.`)
    .nullish()
    .transform((value) => (value ? value : null));

const location = z.enum(['office', 'wfh'], { error: 'Pick Office or WFH.' });

const id = z.coerce
  .number({ error: 'That id is not valid.' })
  .int('That id is not valid.')
  .positive('That id is not valid.');

const limit = z.coerce
  .number({ error: 'The limit must be a number.' })
  .int('The limit must be a whole number.')
  .min(1, 'The limit must be at least 1.')
  .max(100, 'The limit can be at most 100.')
  .default(100);

const offset = z.coerce
  .number({ error: 'The offset must be a number.' })
  .int('The offset must be a whole number.')
  .min(0, 'The offset cannot be negative.')
  .default(0);

export const FILTERS = ['all', 'late', 'wfh', 'not_checked_in', 'unverified'];

/** POST /api/attendance/check-in */
export const checkInSchema = z
  .object({
    location: location.optional(),
    unverifiedOffice: z.boolean({ error: 'unverifiedOffice must be true or false.' }).optional(),
    note: optionalNote(255),
  })
  .default({});

/** POST /api/attendance/check-out */
export const checkOutSchema = z.object({}).default({});

/** POST /api/attendance/break/start and /api/attendance/break/end (no fields) */
export const breakSchema = z.object({}).default({});

/** GET /api/attendance */
export const listQuerySchema = z.object({
  date: dateString('Pick a date like 2026-09-30.').optional(),
  filter: z
    .enum(FILTERS, { error: 'Pick a filter: late, wfh, not_checked_in or unverified.' })
    .optional()
    .default('all'),
  limit,
  offset,
});

/** GET /api/attendance/summary and /api/attendance/export */
export const dateQuerySchema = z.object({
  date: dateString('Pick a date like 2026-09-30.').optional(),
});

/** POST /api/attendance (HR adds a row for someone who forgot) */
export const createRowSchema = z.object({
  userId: id,
  workDate: dateString(),
  checkIn: clockString('Enter the check-in time.'),
  checkOut: clockString('Enter the check-out time.').nullish(),
  location,
  reason: reasonText('a reason', 500),
});

/** PATCH /api/attendance/:id */
export const updateRowSchema = z
  .object({
    checkIn: clockString('Enter the check-in time.').optional(),
    checkOut: clockString('Enter the check-out time.').optional(),
    location: location.optional(),
    reason: reasonText('a reason', 500),
  })
  .refine((value) => value.checkIn || value.checkOut || value.location, {
    message: 'Change the check-in, the check-out or the place.',
    path: ['checkIn'],
  });

/** POST /api/attendance/:id/confirm-office */
export const confirmOfficeSchema = z.object({ reason: reasonText('a reason', 500) });

/** POST /api/attendance-corrections */
export const correctionRequestSchema = z
  .object({
    type: z.enum(['check_in', 'check_out', 'missing_day'], {
      error: 'Pick what needs fixing.',
    }),
    workDate: dateString(),
    checkIn: clockString('Enter the check-in time.').optional(),
    checkOut: clockString('Enter the check-out time.').optional(),
    location: location.optional(),
    reason: reasonText('a reason for HR', 500),
  })
  .superRefine((value, ctx) => {
    const need = (field, message) => {
      if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message });
    };
    if (value.type === 'check_in' || value.type === 'missing_day') {
      need('checkIn', 'Enter the check-in time.');
    }
    if (value.type === 'check_out' || value.type === 'missing_day') {
      need('checkOut', 'Enter the check-out time.');
    }
    if (value.type === 'missing_day') need('location', 'Pick Office or WFH.');
  });

/** GET /api/attendance-corrections */
export const correctionListSchema = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected'], { error: 'Pick pending, approved or rejected.' })
    .optional()
    .default('pending'),
  limit,
  offset,
});

/** POST /api/attendance-corrections/:id/approve */
export const approveSchema = z.object({ note: optionalNote(300) }).default({});

/** POST /api/attendance-corrections/:id/reject */
export const rejectSchema = z.object({ note: reasonText('a note for them', 300) });

/** Route params { id } for /api/attendance/:id and /api/attendance-corrections/:id. */
export const idParamSchema = z.object({ id });
