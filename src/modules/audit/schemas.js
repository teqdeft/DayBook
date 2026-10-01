import { z } from 'zod';

/** Cuts a string to the column size instead of failing the business change it belongs to. */
const clipped = (max) =>
  z
    .string()
    .nullish()
    .transform((value) => (value ? value.slice(0, max) : null));

/** One audit entry, as passed to audit.log(). Audit rows have no API endpoint in Phase 1. */
export const auditEntrySchema = z.object({
  actorId: z.coerce
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  action: z.string().min(1).max(80),
  entityType: z.string().min(1).max(40),
  entityId: z.coerce
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: clipped(500),
  ip: clipped(45),
});
