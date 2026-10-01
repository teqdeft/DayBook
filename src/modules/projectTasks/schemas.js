// Input schemas for the priority task endpoints (CONTRACT 13). Every string length is checked
// here: the local MariaDB silently truncates long strings, production MySQL rejects them.
import { z } from 'zod';

/** Highest first. */
export const PRIORITIES = ['p1', 'p2', 'p3'];
export const TASK_STATUSES = ['open', 'done'];

export const TITLE_MIN = 2;
export const TITLE_MAX = 200;
export const DETAILS_MAX = 1000;

const BODY_MESSAGE = 'Send the fields as a JSON object.';
const ID_PATTERN = /^[1-9]\d{0,15}$/;

/** A plain-digit id as a number or a string ("12"); anything else fails with `message`. */
const idValue = (message) =>
  z
    .union([z.number(), z.string().trim()], { error: message })
    .refine((value) => ID_PATTERN.test(String(value)), message)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value), message);

const title = z
  .string({ error: 'Enter a title.' })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter a title.')
      .min(TITLE_MIN, `Use at least ${TITLE_MIN} characters for the title.`)
      .max(TITLE_MAX, `Keep the title to ${TITLE_MAX} characters or fewer.`),
  );

const details = z
  .string({ error: 'Details must be text.' })
  .trim()
  .max(DETAILS_MAX, `Keep the details to ${DETAILS_MAX} characters or fewer.`)
  .nullish()
  .transform((value) => value || null);

const priority = z.enum(PRIORITIES, { error: 'Pick P1, P2 or P3.' });

/** null (or "") means anyone on the project. */
const assigneeId = z.preprocess(
  (value) => (value === '' ? null : value),
  idValue('Pick someone on the project, or anyone.').nullable(),
);

/** POST /api/projects/:id/tasks */
export const projectTaskCreateSchema = z.object(
  {
    title,
    details: details.optional().default(null),
    priority: priority.default('p2'),
    assigneeId: assigneeId.optional().default(null),
  },
  { error: BODY_MESSAGE },
);

/** PATCH /api/project-tasks/:id — only the fields sent change. */
export const projectTaskUpdateSchema = z
  .object({ title, details, priority, assigneeId }, { error: BODY_MESSAGE })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });

/** POST /api/project-tasks/:id/status */
export const projectTaskStatusSchema = z.object(
  { status: z.enum(TASK_STATUSES, { error: 'Status must be open or done.' }) },
  { error: BODY_MESSAGE },
);

/** GET /api/projects/:id/tasks?status=&limit=&offset= */
export const projectTaskListQuerySchema = z.object({
  status: z
    .enum(['', ...TASK_STATUSES], { error: 'Status must be open or done.' })
    .optional()
    .transform((value) => value || undefined),
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
    .max(100_000, 'Offset is too large.')
    .default(0),
});

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
