// Request schemas of today's to-do (/api/me/todo/**) and of closing a suggestion
// (/api/me/carry-suggestions/**), CONTRACT 24. Kept apart from schemas.js, which holds the report
// schemas, only for its size; the limits and field schemas are the report's.
import { z } from 'zod';
import {
  MAX_ENTRIES,
  MAX_TASKS_PER_ENTRY,
  MAX_TASK_LENGTH,
  TASK_STATUSES,
  sharedFields,
} from './schemas';

const { id, optionalId, projectTaskId, carriedFromTaskId } = sharedFields;

/** POST /api/me/carry-suggestions/:taskId/close (CONTRACT 24): "Done already" or "Not needed". */
export const closeSuggestionSchema = z.object({
  reason: z.enum(['done', 'dropped'], { error: 'Pick Done already or Not needed.' }),
  undo: z.boolean({ error: 'Undo must be true or false.' }).optional(),
});

/** Route params with a numeric task id. */
export const taskIdParamsSchema = z.object({ taskId: id });

/** The longest text a to-do title is read from before its spaces collapse (the paste limit). */
const MAX_TODO_TITLE_INPUT = 20_000;

/**
 * A to-do line's title: every run of spaces collapses to one, then 2 to 500 characters (the
 * report's task length).
 */
const todoTitle = z
  .string({ error: 'Write the task as text.' })
  .max(MAX_TODO_TITLE_INPUT, `Keep the task under ${MAX_TASK_LENGTH} characters.`)
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(2, 'Write at least 2 characters.')
      .max(MAX_TASK_LENGTH, `Keep the task under ${MAX_TASK_LENGTH} characters.`),
  );

/** A to-do group is one project or one of the person's pending project requests. */
const oneProject = [
  (value) => Boolean(value.projectId) !== Boolean(value.projectRequestId),
  { message: 'Pick a project.', path: ['projectId'] },
];

/** POST /api/me/todo/lines: one line, typed, from a suggestion or from a priority task. */
export const todoLineCreateSchema = z
  .object({
    projectId: optionalId,
    projectRequestId: optionalId,
    title: todoTitle,
    projectTaskId,
    carriedFromTaskId,
  })
  .refine(...oneProject);

/** PATCH /api/me/todo/lines/:id: rename and/or tick (done true) or untick (done false). */
export const todoLineUpdateSchema = z
  .object({
    title: todoTitle.optional(),
    done: z.boolean({ error: 'Done must be true or false.' }).optional(),
  })
  .refine((value) => value.title !== undefined || value.done !== undefined, {
    message: 'Change the title or tick the task.',
  });

const todoBulkGroup = z
  .object({
    projectId: optionalId,
    projectRequestId: optionalId,
    lines: z
      .array(
        z.object({
          title: todoTitle,
          status: z
            .enum(TASK_STATUSES, { error: 'Pick Done, In progress or Blocked.' })
            .default('in_progress'),
        }),
        { error: 'Send the tasks as a list.' },
      )
      .min(1, 'Add at least one task.')
      .max(MAX_TASKS_PER_ENTRY, `A project can have up to ${MAX_TASKS_PER_ENTRY} tasks.`),
  })
  .refine(...oneProject);

/** POST /api/me/todo/lines/bulk: the pasted list, one group per project picked in the dialog. */
export const todoBulkSchema = z.object({
  groups: z
    .array(todoBulkGroup, { error: 'Send the projects as a list.' })
    .min(1, 'Add at least one task.')
    .max(MAX_ENTRIES, `A report can have up to ${MAX_ENTRIES} projects.`),
});

/** Route params with a numeric report entry id (DELETE /api/me/todo/projects/:entryId). */
export const entryIdParamsSchema = z.object({ entryId: id });
