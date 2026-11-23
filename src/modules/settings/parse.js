// Turns a zod result into the API's VALIDATION_FAILED error (settings and office networks).
import { validationError } from '@/lib/errors';

/** zod result -> the API's VALIDATION_FAILED error with a message per field. */
export function parseInput(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}
