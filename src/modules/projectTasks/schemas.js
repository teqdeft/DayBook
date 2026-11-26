// Input schemas for the priority task endpoints (CONTRACT 13). Every string length is checked
// here: the local MariaDB silently truncates long strings, production MySQL rejects them.
import { z } from 'zod';
import { uploadKeySchema } from '@/modules/projectFiles/schemas';
import { planDate, taskPhase } from '@/modules/projectPlan/schemas';

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

/** A 'YYYY-MM-DD' date; null (or "") means no due date. */
const dueDate = planDate('Pick a real due date, or leave it empty.');

/** At most this many files on one task (CONTRACT 27). */
export const MAX_TASK_FILES = 20;
export const TASK_FILES_MESSAGE = 'A task can have up to 20 files. Remove one to add more.';

/** Held uploads to attach to the task, 0 to 20. */
const uploadKeys = z
  .array(uploadKeySchema, { error: 'Send the files as a list.' })
  .max(MAX_TASK_FILES, { error: TASK_FILES_MESSAGE });

/** Files of the task to remove, 0 to 20. */
const removeFileIds = z
  .array(idValue("That file isn't on this task any more."), { error: 'Send the files as a list.' })
  .max(MAX_TASK_FILES, { error: TASK_FILES_MESSAGE });

/**
 * Project files to link to (or unlink from) the task, 0 to 20 (CONTRACT 28, Linking). Made unique,
 * so `[5, 5]` links once and counts once.
 */
const linkFileIds = z
  .array(idValue("That file isn't in this project's files any more."), {
    error: 'Send the files as a list.',
  })
  .max(MAX_TASK_FILES, { error: TASK_FILES_MESSAGE })
  .transform((ids) => [...new Set(ids)]);

/** The share confirm of an "Only PM and Admins" file (CONTRACT 28). */
const shareConfirmed = z.boolean({ error: 'Send true or false.' });

/** The person the share confirm named ('' or null = anyone on the project). */
const shareWith = assigneeId.optional();

/** POST /api/projects/:id/tasks */
export const projectTaskCreateSchema = z.object(
  {
    title,
    details: details.optional().default(null),
    priority: priority.default('p2'),
    assigneeId: assigneeId.optional().default(null),
    phase: taskPhase.optional().default(null),
    dueDate: dueDate.optional().default(null),
    uploadKeys: uploadKeys.default([]),
    linkFileIds: linkFileIds.default([]),
    shareConfirmed: shareConfirmed.optional().default(false),
    shareWith,
  },
  { error: BODY_MESSAGE },
);

/** True when a field of an edit changes something: an empty file list doesn't. */
const changesSomething = (field) => (Array.isArray(field) ? field.length > 0 : field !== undefined);

/** The confirm fields only go with a change; on their own they change nothing. */
const CONFIRM_KEYS = new Set(['shareConfirmed', 'shareWith']);

/** PATCH /api/project-tasks/:id — only the fields sent change. */
export const projectTaskUpdateSchema = z
  .object(
    {
      title: title.optional(),
      details: details.optional(),
      priority: priority.optional(),
      assigneeId: assigneeId.optional(),
      phase: taskPhase.optional(),
      dueDate: dueDate.optional(),
      addUploadKeys: uploadKeys.optional(),
      removeFileIds: removeFileIds.optional(),
      addLinkFileIds: linkFileIds.optional(),
      removeLinkFileIds: linkFileIds.optional(),
      shareConfirmed: shareConfirmed.optional(),
      shareWith,
    },
    { error: BODY_MESSAGE },
  )
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, field]) => !CONFIRM_KEYS.has(key) && changesSomething(field),
      ),
    { message: 'Nothing to change.' },
  );

/**
 * POST /api/project-tasks/:id/files: held uploads and project files to add to the task, at least
 * one and together up to 20 (CONTRACT 28).
 */
export const projectTaskFilesSchema = z
  .object(
    {
      uploadKeys: uploadKeys.default([]),
      linkFileIds: linkFileIds.default([]),
      shareConfirmed: shareConfirmed.optional().default(false),
      shareWith,
    },
    { error: BODY_MESSAGE },
  )
  .refine((value) => value.uploadKeys.length + value.linkFileIds.length > 0, {
    message: 'Add files or pick project files.',
  })
  .refine((value) => value.uploadKeys.length + value.linkFileIds.length <= MAX_TASK_FILES, {
    message: TASK_FILES_MESSAGE,
  });

// One strict shape with both keys optional, then "exactly one of them": a union of two strict
// objects answers zod's generic "Invalid input" for both keys or a bad phase (checked on zod 4.6.5).
const kindOf = (change) => (Object.hasOwn(change, 'phase') ? 'phase' : 'assigneeId');
const bulkChange = z
  .strictObject(
    {
      id: idValue("We couldn't find that task."),
      assigneeId: assigneeId.optional(),
      phase: taskPhase.optional(),
    },
    { error: 'Change one thing at a time.' },
  )
  .refine((change) => Object.hasOwn(change, 'assigneeId') !== Object.hasOwn(change, 'phase'), {
    error: 'Change one thing at a time.',
  });

/** Most tasks one bulk save changes (CONTRACT 28, Bulk actions in the Table). */
export const MAX_BULK_TASKS = 100;

/**
 * POST /api/projects/:id/tasks/bulk: 1 to 100 changes of one kind (a person or a phase), each task
 * once. `assigneeId` as the task field ('' = anyone); `phase` one of the list, or null (an Undo
 * back to No phase yet).
 */
export const projectTaskBulkSchema = z.object(
  {
    changes: z
      .array(bulkChange, { error: 'Pick at least one task.' })
      .min(1, { error: 'Pick at least one task.' })
      .max(MAX_BULK_TASKS, { error: 'Pick up to 100 tasks.' })
      .refine((list) => new Set(list.map(kindOf)).size === 1, {
        error: 'Change one thing at a time.',
      })
      .refine((list) => new Set(list.map((change) => change.id)).size === list.length, {
        error: 'A task is in the list twice.',
      }),
    shareConfirmed: shareConfirmed.optional().default(false),
  },
  { error: BODY_MESSAGE },
);

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
