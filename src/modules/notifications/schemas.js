import { z } from 'zod';

/** POST /api/notifications/read-all takes no fields; unknown ones are ignored. */
export const readAllSchema = z.object({}).optional();

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
