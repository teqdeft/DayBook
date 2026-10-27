import { z } from 'zod';
import { dayjs, parseDuration } from '@/lib/time';

export const TASK_STATUSES = ['done', 'in_progress', 'blocked'];
/** Hard limits that keep one report a sensible size (and inside the column types). */
export const MAX_ENTRIES = 20;
export const MAX_TASKS_PER_ENTRY = 50;
export const MAX_TASK_LENGTH = 500;
/** A task line's timer note (report_tasks.timer_note): as long as a timer note can be. */
export const MAX_TIMER_NOTE_LENGTH = 200;
/** An entry may hold at most one day of hours while drafting; submit allows 16 in total. */
export const MAX_ENTRY_HOURS = 24;
export const MAX_ENTRY_MINUTES = MAX_ENTRY_HOURS * 60;
/** The report page's own words for time it can't read (under the hours box). */
export const TIME_FORMAT_MESSAGE = 'Enter time like 2h 15m';

/** A real calendar date 'YYYY-MM-DD' (rejects 2026-02-31). */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayjs(value, 'YYYY-MM-DD', true).isValid();
}

const isoDate = (message = 'Use a date like 2026-09-30.') =>
  z.string({ error: message }).trim().refine(isIsoDate, message);

const isoMonth = z
  .string({ error: 'Use a month like 2026-09.' })
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09.');

const id = z.coerce.number().int().positive();

/** Optional numeric id (null, undefined and '' mean "none"). */
const optionalId = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number({ error: 'That id is not valid.' }).int().positive().optional(),
);

const limit = z.coerce
  .number({ error: 'Limit must be a number from 1 to 100.' })
  .int('Limit must be a whole number.')
  .min(1, 'Limit must be 1 to 100.')
  .max(100, 'Limit must be 1 to 100.')
  .default(50);
const offset = z.coerce
  .number({ error: 'Offset must be a number.' })
  .int('Offset must be a whole number.')
  .min(0, 'Offset must be 0 or more.')
  .default(0);

/**
 * Hours text -> a number of hours, read exactly like the report page's box (parseDuration):
 * '2h 15m', '2:15', '1.5', '1,5'; NaN for anything else, including decimals off the 0.25-hour
 * steps ('8.30' may mean 8h 30m, so it is refused rather than saved as 8h 18m).
 */
function hoursFromText(text) {
  const minutes = parseDuration(text, { max: Infinity });
  return minutes === null ? Number.NaN : minutes / 60;
}

/**
 * Hours: a number of any precision (company request: exact minutes), or text as the person typed
 * it, read like the report page's box ('2h 15m', '2:15', '6.5'; hoursFromText); '' counts as 0.
 * Must be 0 or more, at most 24. The entry turns them into whole minutes.
 */
const hours = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.trim() === '' ? 0 : hoursFromText(value.trim());
    return value;
  },
  z
    .number({ error: TIME_FORMAT_MESSAGE })
    .refine(Number.isFinite, TIME_FORMAT_MESSAGE)
    .min(0, "Hours can't be below 0.")
    .max(MAX_ENTRY_HOURS, `Hours must be ${MAX_ENTRY_HOURS} or less.`),
);

/**
 * An entry's time in whole minutes, 0 to 1440 (what the report page sends). A number or a
 * numeric string; null, undefined and '' mean "not sent" (then `hours` counts).
 */
const minutes = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.trim() === '' ? undefined : Number(value.trim());
    return value;
  },
  z
    .number({ error: 'Send the minutes as a whole number.' })
    .int('Send the minutes as a whole number.')
    .min(0, "Hours can't be below 0.")
    .max(MAX_ENTRY_MINUTES, `Hours must be ${MAX_ENTRY_HOURS} or less.`)
    .optional(),
);

/**
 * An entry's whole minutes: `minutes` when set, else `hours` x 60 rounded to the minute. Works on
 * parsed entries and on entries services get straight from tests or other callers.
 * @param {{ minutes?: number | null, hours?: number | null }} entry
 * @returns {number}
 */
export function entryMinutes(entry) {
  const value = Number(entry?.minutes);
  if (entry?.minutes !== null && entry?.minutes !== undefined && Number.isFinite(value)) {
    return Math.round(value);
  }
  return Math.round((Number(entry?.hours) || 0) * 60);
}

/**
 * The priority task a task line is linked to (CONTRACT section 13): a plain-digit id, or
 * null / undefined / '' for none. Numbers must be whole and positive.
 */
const projectTaskId = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : value;
    return value;
  },
  z
    .string({ error: 'That priority task is not valid.' })
    .regex(/^[1-9]\d{0,15}$/, 'That priority task is not valid.')
    .transform(Number)
    .optional(),
);

/**
 * The timer note a task line was filled from (CONTRACT 21, "Timer lines remember their note"):
 * trimmed; '', null or missing mean none (null). Only "Fill report from timers" sets it, and it
 * never shows, so a reworded line still stands for its note.
 */
const timerNote = z
  .string({ error: 'Send the timer note as text.' })
  .trim()
  .max(
    MAX_TIMER_NOTE_LENGTH,
    `Keep the timer note to ${MAX_TIMER_NOTE_LENGTH} characters or fewer.`,
  )
  .nullish()
  .transform((value) => value || null);

export const taskInputSchema = z.object({
  id: optionalId,
  title: z
    .string({ error: 'Write the task as text.' })
    .max(MAX_TASK_LENGTH, `Keep the task under ${MAX_TASK_LENGTH} characters.`)
    .default(''),
  status: z.enum(TASK_STATUSES, { error: 'Pick Done, In progress or Blocked.' }),
  projectTaskId,
  timerNote,
});

/**
 * One project of a report. Its time comes as `minutes` (whole, 0-1440; the report page) or as
 * `hours` (any precision, 0-24); `minutes` wins when both are sent. The parsed entry always has
 * both: `minutes` whole and `hours` = minutes / 60.
 */
export const entryInputSchema = z
  .object({
    id: optionalId,
    projectId: optionalId,
    projectRequestId: optionalId,
    hours,
    minutes,
    tasks: z
      .array(taskInputSchema)
      .max(MAX_TASKS_PER_ENTRY, `A project can have at most ${MAX_TASKS_PER_ENTRY} tasks.`)
      .default([]),
  })
  .refine((entry) => Boolean(entry.projectId) !== Boolean(entry.projectRequestId), {
    message: 'Pick a project.',
    path: ['project'],
  })
  .transform((entry) => {
    const total = entryMinutes(entry);
    return { ...entry, minutes: total, hours: total / 60 };
  });

const entries = z
  .array(entryInputSchema, { error: 'Send the report entries as a list.' })
  .max(MAX_ENTRIES, `A report can have at most ${MAX_ENTRIES} projects.`);

/**
 * The `version` of the report the page last loaded or saved. When it no longer matches the
 * stored report (changed in another tab, on another device, or by a PM handling a project
 * request), the save is refused with CONFLICT instead of overwriting that change.
 */
const baseVersion = z
  .string({ error: 'Reload the page and try again.' })
  .trim()
  .min(1, 'Reload the page and try again.')
  .max(64, 'Reload the page and try again.')
  .optional();

/** PUT /api/reports/:id (autosave). */
export const saveReportSchema = z.object({ entries, baseVersion });

/** POST /api/reports/:id/submit. `entries` saves the latest changes in the same step. */
export const submitReportSchema = z.object({ entries: entries.optional(), baseVersion });

/** GET /api/reports/me */
export const reportForDateQuerySchema = z.object({ date: isoDate().optional() });

/** Route params with a numeric id. */
export const idParamsSchema = z.object({ id });

/** GET /api/reports */
export const listReportsQuerySchema = z
  .object({
    userId: optionalId,
    from: isoDate('Use a from date like 2026-09-01.').optional(),
    to: isoDate('Use a to date like 2026-09-30.').optional(),
    limit,
    offset,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The from date must be on or before the to date.',
    path: ['from'],
  });

/** POST /api/report-edit-requests */
export const editRequestSchema = z.object({
  workDate: isoDate('Pick the day of the report.'),
  reason: z
    .string({ error: 'Say what needs to change.' })
    .trim()
    .min(2, 'Say what needs to change.')
    .max(500, 'Keep the reason under 500 characters.'),
});

/** POST /api/report-edit-requests/:id/decline */
export const declineEditRequestSchema = z.object({
  reason: z
    .string({ error: 'Give a reason for declining.' })
    .trim()
    .min(2, 'Give a reason for declining.')
    .max(300, 'Keep the reason under 300 characters.'),
});

/** POST /api/report-edit-requests/:id/approve takes no fields. */
export const approveEditRequestSchema = z.object({});

/** GET /api/report-edit-requests */
export const listEditRequestsQuerySchema = z.object({
  status: z
    .enum(['pending', 'handled'], { error: 'Status is pending or handled.' })
    .default('pending'),
  limit,
  offset,
});

/** GET /api/me/log */
export const monthLogQuerySchema = z.object({
  month: isoMonth.optional(),
  format: z.enum(['json', 'xlsx'], { error: 'Format is json or xlsx.' }).default('json'),
});
