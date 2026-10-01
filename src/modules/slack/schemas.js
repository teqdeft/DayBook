import { z } from 'zod';

/** What a slack_outbox row can hold. 'message' is a plain post to a channel. */
export const OUTBOX_KINDS = ['report_post', 'report_update', 'dm', 'message'];

/** slack.enqueue() input (services only; there is no endpoint that queues messages). */
export const enqueueSchema = z
  .object({
    kind: z.enum(OUTBOX_KINDS),
    channel: z.string().trim().min(1).max(40),
    payload: z.looseObject({ text: z.string().min(1) }),
    relatedType: z
      .string()
      .max(40)
      .nullish()
      .transform((value) => value ?? null),
    relatedId: z.coerce
      .number()
      .int()
      .positive()
      .nullish()
      .transform((value) => value ?? null),
  })
  .refine((row) => row.kind !== 'report_update' || typeof row.payload.ts === 'string', {
    message: 'A report update needs the ts of the message it updates.',
    path: ['payload', 'ts'],
  });

/** GET /api/slack/channels takes no query fields. */
export const channelsQuerySchema = z.object({});
