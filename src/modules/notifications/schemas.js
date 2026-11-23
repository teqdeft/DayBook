import { z } from 'zod';

/** The most ids one "Mark these as read" sends (the newest of a summary card, CONTRACT 26). */
export const READ_IDS_MAX = 50;
const READ_IDS_MESSAGE = 'Pick 1 to 50 notifications.';

/** 1 to 50 notification ids, each a positive whole number. */
function isIdList(value) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= READ_IDS_MAX &&
    value.every((id) => Number.isSafeInteger(id) && id > 0)
  );
}

/**
 * POST /api/notifications/read-all: {} marks every unread one; { ids } only those (CONTRACT 26).
 * Unknown fields are ignored. Every problem with ids is reported on the field itself.
 */
export const readAllSchema = z
  .object({ ids: z.custom(isIdList, { error: READ_IDS_MESSAGE }).optional() })
  .optional();

/**
 * GET /api/notifications?after=<id> (the live check, CONTRACT 26): the highest id the tab has
 * seen, a whole number from 0.
 */
export const liveQuerySchema = z.object({
  after: z.coerce
    .number({ error: 'Use a notification id.' })
    .int('Use a notification id.')
    .min(0, 'Use a notification id.')
    .max(Number.MAX_SAFE_INTEGER, 'Use a notification id.'),
});

/** One in-app notification, as passed to notifications.notify(). */
export const notifySchema = z.object({
  userIds: z.array(z.coerce.number().int()).default([]),
  type: z.string().trim().min(1).max(50),
  title: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, 200)),
  body: z
    .string()
    .nullish()
    .transform((value) => (value ? value.trim().slice(0, 500) || null : null)),
  link: z
    .string()
    .nullish()
    .transform((value) => (value ? value.trim().slice(0, 300) || null : null)),
});

/** The [id] in /api/notifications/[id]; anything that isn't a positive whole number is NOT_FOUND. */
export const notificationIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** PATCH /api/notifications/[id] { read: boolean } (CONTRACT 20). */
export const markReadSchema = z.object({
  read: z.boolean({ error: 'Say whether the notification is read.' }),
});
