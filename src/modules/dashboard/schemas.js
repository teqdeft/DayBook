// Query schemas for the dashboard routes (and the pages' search params). Dates are YYYY-MM-DD.
import { z } from 'zod';
import { dayjs } from '@/lib/time';

/** Longest range for the hours endpoints and the export, in days (both ends included). */
export const MAX_RANGE_DAYS = 366;
/** Longest custom range on the employee page (keeps the report history a readable length). */
export const MAX_CUSTOM_DAYS = 92;

const realDate = (value) => typeof value === 'string' && dayjs(value, 'YYYY-MM-DD', true).isValid();

const isoDate = (label) =>
  z
    .string({ error: `Enter the ${label} date as YYYY-MM-DD.` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label} date as YYYY-MM-DD.`)
    .refine(realDate, `Pick a real ${label} date.`);

const optionalDate = (label) =>
  z.preprocess((value) => (value === '' ? undefined : value), isoDate(label).optional());

const userId = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce
    .number({ error: 'Pick a person.' })
    .int('Pick a person.')
    .positive('Pick a person.')
    .max(2 ** 53 - 1, 'Pick a person.')
    .optional(),
);

const spanDays = (from, to) => dayjs(to, 'YYYY-MM-DD').diff(dayjs(from, 'YYYY-MM-DD'), 'day') + 1;
// Range checks only compare two real dates; a bad date already has its own message.
const bothDates = (value) => realDate(value.from) && realDate(value.to);

/** Adds the "from before to" and "not longer than N days" checks. */
function checkRange(schema, maxDays) {
  return schema
    .refine((value) => !bothDates(value) || value.from <= value.to, {
      message: 'The start date must be on or before the end date.',
      path: ['to'],
    })
    .refine((value) => !bothDates(value) || spanDays(value.from, value.to) <= maxDays, {
      message: `Pick a range of ${maxDays} days or fewer.`,
      path: ['to'],
    });
}

/** GET /api/team/today: optional board filter. */
export const teamTodayQuerySchema = z.object({
  filter: z
    .enum(['everyone', 'missing', 'late'], { error: 'Filter must be everyone, missing or late.' })
    .default('everyone'),
});

/** Week or month (hours cards on the Team dashboard and the Company overview). */
export const weekMonthQuerySchema = z.object({
  range: z.enum(['week', 'month'], { error: 'Range must be week or month.' }).default('week'),
});

/** GET /api/overview */
export const overviewQuerySchema = weekMonthQuerySchema;

/** GET /api/stats/hours-by-project?from=&to=&userId=&limit=&offset= */
export const hoursByProjectQuerySchema = checkRange(
  z.object({
    from: isoDate('start'),
    to: isoDate('end'),
    userId,
    limit: z.coerce
      .number({ error: 'Limit must be a number.' })
      .int('Limit must be a whole number.')
      .min(1, 'Limit must be between 1 and 100.')
      .max(100, 'Limit must be between 1 and 100.')
      .default(100),
    offset: z.coerce
      .number({ error: 'Offset must be a number.' })
      .int('Offset must be a whole number.')
      .min(0, 'Offset must be 0 or more.')
      .default(0),
  }),
  MAX_RANGE_DAYS,
);

/** GET /api/team/:userId and the /team/[userId] page: ?range=week|month|custom&from=&to= */
export const employeeDetailQuerySchema = checkRange(
  z.object({
    range: z
      .enum(['week', 'month', 'custom'], { error: 'Range must be week, month or custom.' })
      .default('month'),
    from: optionalDate('start'),
    to: optionalDate('end'),
  }),
  MAX_CUSTOM_DAYS,
).refine((value) => value.range !== 'custom' || (value.from && value.to), {
  message: 'Pick a start and an end date.',
  path: ['from'],
});

/** The :userId route segment. */
// Plain digits only, so '0x2', '2e0' or ' 2' never open person 2 under a second URL.
export const userIdParamSchema = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  z
    .string({ error: "We couldn't find that person." })
    .regex(/^[1-9]\d{0,15}$/, "We couldn't find that person.")
    .transform(Number)
    .refine(Number.isSafeInteger, "We couldn't find that person."),
);

/** GET /api/exports/hours?from=&to=&userId= (defaults to this week). */
export const hoursExportQuerySchema = checkRange(
  z.object({ from: optionalDate('start'), to: optionalDate('end'), userId }),
  MAX_RANGE_DAYS,
).refine((value) => Boolean(value.from) === Boolean(value.to), {
  message: 'Pick both a start and an end date.',
  path: ['from'],
});
