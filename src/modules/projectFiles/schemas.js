// Input schemas of the upload and file routes (CONTRACT 27, Uploads "Schemas"). Every length is
// checked here as well as in the database (the local MariaDB cuts long strings, MySQL refuses them).
import { z } from 'zod';
import { validationError } from '@/lib/errors';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';

const ID = /^[1-9]\d{0,15}$/;

/** A plain-digit id as a number or a string ("12"); anything else fails with `message`. */
const idValue = (message) =>
  z
    .union([z.number(), z.string().trim()], { error: message })
    .refine((value) => ID.test(String(value)), message)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value), message);

const name = z
  .string({ error: 'Pick a file.' })
  .min(1, { error: 'Pick a file.' })
  .max(1000, { error: 'That file name is too long.' });

const size = z
  .number({ error: 'Pick a file.' })
  .int({ error: 'Pick a file.' })
  .min(1, { error: 'This file is empty.' })
  .max(Number.MAX_SAFE_INTEGER, { error: 'Pick a file.' });

const common = {
  projectId: idValue("We couldn't find that project."),
  name,
  size,
  lastModified: z.number().int().min(0).optional(),
};

/** Who sees a project file, a note or a text-only document. */
export const VISIBILITIES = ['everyone', 'managers'];

/**
 * POST /api/uploads (Start). A project file's `visibility` is required with no default: the Upload
 * dialog always sends the choice, so nothing is shared by accident (fails closed).
 */
export const uploadStartSchema = z.discriminatedUnion(
  'target',
  [
    z.object({
      ...common,
      target: z.literal('project'),
      phase: z.enum(PHASE_KEYS, { error: 'Pick a place from the list.' }).nullable().default(null),
      visibility: z.enum(VISIBILITIES, { error: 'Pick who can see it.' }),
    }),
    z.object({
      ...common,
      target: z.literal('task'),
      taskId: idValue("We couldn't find that task.").nullable().default(null),
    }),
  ],
  { error: 'Pick where the file goes.' },
);

/** An upload key: 32 lower-case hex characters (the only id the browser sees). */
export const uploadKeySchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, { error: "We couldn't find that upload." });

/** `?offset=N` of the pieces route. */
export const pieceQuerySchema = z.object({
  offset: z.coerce
    .number({ error: 'Daybook has a different part of this file.' })
    .int({ error: 'Daybook has a different part of this file.' })
    .min(0, { error: 'Daybook has a different part of this file.' })
    .max(Number.MAX_SAFE_INTEGER, { error: 'Daybook has a different part of this file.' }),
});

/** PATCH /api/project-files/[id]: the base name only (the server keeps the stored extension). */
export const fileUpdateSchema = z
  .object({
    name: z
      .string({ error: 'Write a name.' })
      .trim()
      .min(1, { error: 'Write a name.' })
      .max(200, { error: 'Keep the name to 200 characters.' })
      .optional(),
    phase: z.enum(PHASE_KEYS, { error: 'Pick a place from the list.' }).nullable().optional(),
    visibility: z.enum(VISIBILITIES, { error: 'Pick who can see it.' }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Nothing to change.' });

/**
 * Validates service input with a zod schema (routes call the services, and so do tests, db/demo
 * and other modules).
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} value
 * @returns {T}
 * @throws VALIDATION_FAILED with a fields map and the first field's message
 */
export function parseInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}
