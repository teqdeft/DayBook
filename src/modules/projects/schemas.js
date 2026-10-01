// Input schemas for the projects endpoints. Every string length is checked here: the local
// MariaDB silently truncates long strings, production MySQL rejects them.
import { z } from 'zod';
import { compactName } from '@/lib/text';

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed'];
export const PROJECT_COLORS = ['blue', 'green', 'violet', 'orange', 'teal', 'pink'];
export const REQUEST_STATUSES = ['pending', 'approved', 'declined'];

const BODY_MESSAGE = 'Send the fields as a JSON object.';

/** Whole positive ids; numeric strings from forms and query strings are accepted. */
const id = (message) =>
  z.coerce
    .number({ error: message })
    .int(message)
    .positive(message)
    .max(2 ** 53 - 1, message);

const projectName = z
  .string({ error: 'Enter a project name.' })
  .trim()
  .min(1, 'Enter a project name.')
  .max(120, 'Project name must be 120 characters or fewer.')
  .refine((value) => compactName(value).length > 0, 'Use letters or numbers in the project name.');

const clientName = z
  .string({ error: 'Enter the client or company name.' })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter the client or company name.')
      .max(160, 'Client name must be 160 characters or fewer.'),
  );

const urgentNote = z
  .string({ error: 'Add a short note so members know what is urgent.' })
  .trim()
  .max(200, 'Keep the urgent note to 200 characters or fewer.');

const memberIds = z
  .array(id('Pick people from the list.'), { error: 'Pick people from the list.' })
  .max(500, 'A project can have at most 500 members.')
  .transform((ids) => [...new Set(ids)]);

const projectFields = {
  name: projectName,
  clientName,
  pmId: id('Pick a project manager.'),
  memberIds,
  status: z.enum(PROJECT_STATUSES, { error: 'Pick a status.' }),
  color: z.enum(PROJECT_COLORS, { error: 'Pick a colour label.' }),
  isUrgent: z.boolean({ error: 'Choose on or off.' }),
  urgentNote: urgentNote.nullish(),
};

/** An urgent project needs a note, and only active projects can be urgent. */
function checkUrgent(value, ctx) {
  if (!value.isUrgent) return;
  if (!value.urgentNote) {
    ctx.addIssue({
      code: 'custom',
      path: ['urgentNote'],
      message: 'Add a short note so members know what is urgent.',
    });
  }
  if (value.status && value.status !== 'active') {
    ctx.addIssue({
      code: 'custom',
      path: ['isUrgent'],
      message: 'Only active projects can be marked urgent.',
    });
  }
}

/**
 * POST /api/projects and POST /api/project-requests/:id/approve (the New project form).
 * A new project starts active or on hold.
 */
export const projectCreateSchema = z
  .object(
    {
      ...projectFields,
      memberIds: memberIds.default([]),
      status: z.enum(['active', 'on_hold'], { error: 'Pick a status.' }).default('active'),
      color: projectFields.color.default('blue'),
      isUrgent: projectFields.isUrgent.default(false),
    },
    { error: BODY_MESSAGE },
  )
  .superRefine(checkUrgent);

/** PATCH /api/projects/:id. Every field is optional; only the ones sent change. */
export const projectUpdateSchema = z
  .object(projectFields, { error: BODY_MESSAGE })
  .partial()
  .superRefine(checkUrgent)
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change.' });

/** PUT /api/projects/:id/members — replaces the list of active members. */
export const projectMembersSchema = z.object(
  {
    userIds: memberIds,
  },
  { error: BODY_MESSAGE },
);

/** POST /api/projects/:id/urgent */
export const projectUrgentSchema = z.object(
  {
    note: urgentNote.min(1, 'Add a short note so members know what is urgent.'),
  },
  { error: BODY_MESSAGE },
);

const flag = z
  .union([z.boolean(), z.enum(['1', '0', 'true', 'false', ''])], {
    error: 'Use 1 or 0.',
  })
  .transform((value) => value === true || value === '1' || value === 'true');

const limit = (fallback) =>
  z.coerce
    .number({ error: 'Limit must be a number.' })
    .int('Limit must be a whole number.')
    .min(1, 'Limit must be between 1 and 100.')
    .max(100, 'Limit must be between 1 and 100.')
    .default(fallback);

const offset = z.coerce
  .number({ error: 'Offset must be a number.' })
  .int('Offset must be a whole number.')
  .min(0, 'Offset must be 0 or more.')
  .max(1_000_000, 'Offset is too large.')
  .default(0);

const search = z.string().trim().max(120, 'Search for 120 characters or fewer.');

/** GET /api/projects?status=&mine=1&q=&limit=&offset= */
export const projectListQuerySchema = z.object({
  status: z
    .enum(['', ...PROJECT_STATUSES], { error: 'Status must be active, on_hold or completed.' })
    .optional()
    .transform((value) => value || undefined),
  mine: flag.optional().default(false),
  q: search.optional().default(''),
  limit: limit(50),
  offset,
});

/** GET /api/clients?q=&limit=&offset= */
export const clientListQuerySchema = z.object({
  q: z.string().trim().max(160, 'Search for 160 characters or fewer.').optional().default(''),
  limit: limit(20),
  offset,
});

/** POST /api/project-requests */
export const projectRequestCreateSchema = z.object(
  {
    name: projectName,
    note: z
      .string({ error: 'Add a short note for your PM.' })
      .trim()
      .min(1, 'Add a short note for your PM.')
      .max(500, 'Keep the note to 500 characters or fewer.'),
    sendAnyway: z.boolean({ error: 'Choose yes or no.' }).optional().default(false),
  },
  { error: BODY_MESSAGE },
);

/** GET /api/project-requests?status=pending */
export const projectRequestListQuerySchema = z.object({
  status: z
    .enum(REQUEST_STATUSES, { error: 'Status must be pending, approved or declined.' })
    .default('pending'),
  limit: limit(50),
  offset,
});

/** POST /api/project-requests/:id/decline */
export const projectRequestDeclineSchema = z.object(
  {
    reason: z
      .string({ error: 'Add a reason so they know why.' })
      .trim()
      .min(1, 'Add a reason so they know why.')
      .max(300, 'Keep the reason to 300 characters or fewer.'),
    moveEntriesToProjectId: id('Pick a project to move the logged hours to.').nullish(),
  },
  { error: BODY_MESSAGE },
);

/** The :id in /api/projects/:id and /api/project-requests/:id */
export const idParamSchema = z.object({ id: id('Not found.') });

/**
 * The numeric :id of a route, or null when it isn't one (routes answer 404).
 * @param {Record<string, string>} params
 * @returns {number | null}
 */
export function routeId(params) {
  const parsed = idParamSchema.safeParse(params ?? {});
  return parsed.success ? parsed.data.id : null;
}
