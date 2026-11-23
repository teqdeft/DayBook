// zod schemas for the missing check-out endpoints (CONTRACT 25, items B and 7) and the Remind
// endpoint's body (item 5). Messages are written for people; every string has a length check.
import { z } from 'zod';
import { validationError } from '@/lib/errors';
import { clockString } from './schemas';

const BULK_MAX = 50;
const REMIND_MAX = 50;

const id = z.coerce
  .number({ error: 'That id is not valid.' })
  .int('That id is not valid.')
  .positive('That id is not valid.');

/** POST /api/attendance/me/missing-checkouts/:id/fix */
export const selfFixSchema = z.object({
  checkOut: clockString('Enter the time you left.'),
  // Needed only over the self-fix limit (the service says "Add a reason for HR.").
  reason: z
    .string({ error: 'Add a reason for HR.' })
    .trim()
    .max(500, 'Keep it to 500 characters or fewer.')
    .nullish()
    .transform((value) => value || null),
});

/** POST /api/attendance/me/missing-checkouts/hide (no fields) */
export const hidePromptSchema = z.object({}).default({});

/**
 * POST /api/attendance/missing-checkouts/fix. A row without a time (or not a time) fails on its
 * own with "Add a time." (the service checks each), so the others still save.
 */
export const bulkFixSchema = z.object({
  items: z
    .array(
      z.object({
        attendanceId: id,
        checkOut: z.string({ error: 'Add a time.' }).trim().max(8, 'Add a time.').nullish(),
      }),
      { error: 'Pick the check-outs to fix.' },
    )
    .min(1, 'Pick the check-outs to fix.')
    .max(BULK_MAX, `Fix up to ${BULK_MAX} check-outs at a time.`),
  reason: z
    .string({ error: 'Add a reason.' })
    .trim()
    .min(2, 'Add a reason.')
    .max(500, 'Keep it to 500 characters or fewer.'),
});

/** POST /api/attendance/reminders (builder D's route): one kind, 1 to 50 distinct people. */
export const reminderSchema = z.object({
  kind: z.enum(['check_in', 'break', 'check_out', 'missing_checkout'], {
    error: 'Pick what to remind them about.',
  }),
  userIds: z
    .array(id, { error: 'Pick who to remind.' })
    .min(1, 'Pick who to remind.')
    .max(REMIND_MAX, `Remind up to ${REMIND_MAX} people at a time.`)
    .transform((ids) => [...new Set(ids)]),
});

/** Route params { id }: plain digits only, anything else is NOT_FOUND (ids can't be probed). */
export function isPlainId(value) {
  return typeof value === 'string' && /^\d{1,18}$/.test(value);
}

/**
 * Parses a body a route read itself (the bulk fix reads its own, capped at 16 KB).
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} value
 * @returns {T}
 * @throws VALIDATION_FAILED with the first message per field
 */
export function parseBody(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!(path in fields)) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}
