// Input schemas for the timer endpoints (CONTRACT 15). Every string length is checked here: the
// local MariaDB silently truncates long strings, production MySQL rejects them.
import { z } from 'zod';
import { dayjs, normalizeClock } from '@/lib/time';

export const NOTE_MAX = 200;
export const STOP_REASONS = ['stopped', 'switched', 'break', 'checkout', 'midnight', 'away'];
export const AWAY_DECISIONS = ['keep', 'remove'];

const BODY_MESSAGE = 'Send the fields as a JSON object.';
const ID_PATTERN = /^[1-9]\d{0,15}$/;
const CLOCK_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** A plain-digit id as a number or a string ("12"); anything else fails with `message`. */
const idValue = (message) =>
  z
    .union([z.number(), z.string().trim()], { error: message })
    .refine((value) => ID_PATTERN.test(String(value)), message)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value), message);

const projectId = idValue('Pick a project.');

/** null (or "") means no priority task. */
const projectTaskId = z.preprocess(
  (value) => (value === '' ? null : value),
  idValue('Pick a priority task of this project, or none.').nullable(),
);

/** Trimmed; empty means no note. */
const note = z
  .string({ error: 'The note must be text.' })
  .trim()
  .max(NOTE_MAX, `Keep the note to ${NOTE_MAX} characters or fewer.`)
  .nullish()
  .transform((value) => value || null);

/** A 'HH:mm' clock in company time ('9:30' becomes '09:30'). */
const clock = (label) =>
  z
    .string({ error: `Enter the ${label} time, like 09:30.` })
    .trim()
    .regex(CLOCK_PATTERN, `Enter the ${label} time, like 09:30.`)
    .transform(normalizeClock);

/** An ISO moment as the state sent it ('2026-09-30T08:10:00.000Z'). */
const moment = z
  .string({ error: 'Send the away time as the app sent it.' })
  .refine((value) => dayjs(value).isValid(), 'Send the away time as the app sent it.');

/** POSTs without fields (stop). */
export const emptyBodySchema = z.object({}).default({});

/** POST /api/timers/start */
export const timerStartSchema = z.object(
  {
    projectId,
    projectTaskId: projectTaskId.optional().default(null),
    note: note.optional().default(null),
  },
  { error: BODY_MESSAGE },
);

/** POST /api/timers/entries */
export const timerEntryCreateSchema = z.object(
  {
    projectId,
    projectTaskId: projectTaskId.optional().default(null),
    note: note.optional().default(null),
    startClock: clock('start'),
    endClock: clock('end'),
  },
  { error: BODY_MESSAGE },
);

/** PATCH /api/timers/entries/:id — only the fields sent change. */
export const timerEntryUpdateSchema = z
  .object(
    {
      projectId,
      projectTaskId,
      note,
      startClock: clock('start'),
      endClock: clock('end'),
    },
    { error: BODY_MESSAGE },
  )
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });

/** POST /api/timers/away */
export const timerAwaySchema = z.object(
  {
    entryId: idValue('Refresh and try again.'),
    from: moment,
    to: moment,
    decision: z.enum(AWAY_DECISIONS, { error: 'Choose keep or remove.' }),
  },
  { error: BODY_MESSAGE },
);

const idParamSchema = z.object({ id: idValue('Not found.') });

/**
 * The numeric :id of a route, or null when it isn't a plain-digit id (routes answer 404).
 * @param {Record<string, string>} params
 * @returns {number | null}
 */
export function routeId(params) {
  const parsed = idParamSchema.safeParse(params ?? {});
  return parsed.success ? parsed.data.id : null;
}
