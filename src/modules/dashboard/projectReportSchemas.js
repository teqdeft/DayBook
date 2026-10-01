// Query schemas for the project report (GET /api/projects/:id/report and its export, and the
// /projects/[id] page's search params). Dates are YYYY-MM-DD.
import { z } from 'zod';
import { dayjs } from '@/lib/time';

export const PROJECT_REPORT_RANGES = ['week', 'month', 'all', 'custom'];
/** Longest custom range in days (both ends included): ten years, more than any project. */
export const PROJECT_REPORT_MAX_DAYS = 3660;
/** Daily log rows per page. */
export const PROJECT_REPORT_PAGE_SIZE = 20;

const realDate = (value) => typeof value === 'string' && dayjs(value, 'YYYY-MM-DD', true).isValid();

const optionalDate = (label) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string({ error: `Enter the ${label} date as YYYY-MM-DD.` })
      .trim()
      .max(10, `Enter the ${label} date as YYYY-MM-DD.`)
      .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label} date as YYYY-MM-DD.`)
      .refine(realDate, `Pick a real ${label} date.`)
      .optional(),
  );

const spanDays = (from, to) => dayjs(to, 'YYYY-MM-DD').diff(dayjs(from, 'YYYY-MM-DD'), 'day') + 1;

const rangeFields = {
  range: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .enum(PROJECT_REPORT_RANGES, { error: 'Range must be week, month, all or custom.' })
      .optional(),
  ),
  from: optionalDate('start'),
  to: optionalDate('end'),
};

/**
 * No range with dates means custom; no range and no dates means all time. A custom range needs
 * both dates, in order, at most PROJECT_REPORT_MAX_DAYS long.
 */
function withRangeRules(schema) {
  return schema
    .transform((value) => ({
      ...value,
      range: value.range ?? (value.from || value.to ? 'custom' : 'all'),
    }))
    .refine((value) => value.range !== 'custom' || (value.from && value.to), {
      message: 'Pick a start and an end date.',
      path: ['from'],
    })
    .refine(
      (value) => value.range !== 'custom' || !value.from || !value.to || value.from <= value.to,
      {
        message: 'The start date must be on or before the end date.',
        path: ['to'],
      },
    )
    .refine(
      (value) =>
        value.range !== 'custom' ||
        !value.from ||
        !value.to ||
        spanDays(value.from, value.to) <= PROJECT_REPORT_MAX_DAYS,
      { message: 'Pick a range of ten years or less.', path: ['to'] },
    );
}

/** The page's search params and the export: ?range=week|month|all|custom&from=&to= */
export const projectReportRangeSchema = withRangeRules(z.object(rangeFields));

/**
 * GET /api/projects/:id/report?range=&from=&to=&limit=&offset=&section=
 * `limit`/`offset` page the daily log; section=entries returns only the daily log page.
 */
export const projectReportQuerySchema = withRangeRules(
  z.object({
    ...rangeFields,
    limit: z.coerce
      .number({ error: 'Limit must be a number.' })
      .int('Limit must be a whole number.')
      .min(1, 'Limit must be between 1 and 100.')
      .max(100, 'Limit must be between 1 and 100.')
      .default(PROJECT_REPORT_PAGE_SIZE),
    offset: z.coerce
      .number({ error: 'Offset must be a number.' })
      .int('Offset must be a whole number.')
      .min(0, 'Offset must be 0 or more.')
      .max(1_000_000, 'Offset is too large.')
      .default(0),
    section: z
      .enum(['all', 'entries'], { error: 'Section must be all or entries.' })
      .default('all'),
  }),
);

const NO_PROJECT = "We couldn't find that project.";

/**
 * The :id route segment: plain digits only, so '0x2', '2e0' or ' 2' never open project 2 under a
 * second URL.
 */
export const projectIdParamSchema = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  z
    .string({ error: NO_PROJECT })
    .regex(/^[1-9]\d{0,15}$/, NO_PROJECT)
    .transform(Number)
    .refine(Number.isSafeInteger, NO_PROJECT),
);
