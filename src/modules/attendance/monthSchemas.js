// zod schemas of the month view, the month Excel and the person month (CONTRACT 25, items 4 and
// 8). Messages are written for people. A month is 'YYYY-MM' (the regex of reports/schemas.js
// isoMonth); ids are plain digits.
import { z } from 'zod';

/** The month view's filters (`?filter=`). */
export const MONTH_FILTERS = ['all', 'needs_look', 'late', 'short', 'absent', 'leave', 'missing'];

const MONTH_MESSAGE = 'Use a month like 2026-11.';
const ID_MESSAGE = 'That id is not valid.';

const month = z
  .string({ error: MONTH_MESSAGE })
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, MONTH_MESSAGE);

/** A person's id as plain digits (a query value or a path segment) → a positive number. */
const idText = z
  .string({ error: ID_MESSAGE })
  .trim()
  .regex(/^\d{1,15}$/, ID_MESSAGE)
  .transform(Number)
  .refine((value) => value > 0, ID_MESSAGE);

/** GET /api/attendance/month?month=&filter= and the /attendance/month page. */
export const monthQuerySchema = z.object({
  month: month.optional(),
  filter: z
    .enum(MONTH_FILTERS, {
      error: 'Pick a filter: needs_look, late, short, absent, leave or missing.',
    })
    .optional()
    .default('all'),
});

/** GET /api/attendance/month/export?month=&userId= (userId = one person's file). */
export const monthExportQuerySchema = z.object({
  month: month.optional(),
  userId: idText.optional(),
});

/** GET /api/attendance/people/[userId]/month?month= and the person month page. */
export const personMonthQuerySchema = z.object({
  month: month.optional(),
});

/** The [userId] path segment: plain digits, else the page or route answers 404. */
export const userIdParamSchema = idText;
