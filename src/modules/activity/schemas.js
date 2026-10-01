// zod schemas for the screen-time endpoints. Messages are written for people.
import { z } from 'zod';
import { dayjs } from '@/lib/time';
import { SOURCES, STATES } from './segments';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The longest range one request may ask for, in days (a year, leap years included). */
export const MAX_RANGE_DAYS = 366;

/** 'YYYY-MM-DD' that is a real calendar date. */
const dateString = (message = 'Pick a date.') =>
  z
    .string({ error: message })
    .trim()
    .max(10, message)
    .regex(DATE_RE, message)
    .refine((value) => dayjs(value, 'YYYY-MM-DD', true).isValid(), message);

/** POST /api/activity/heartbeat */
export const heartbeatSchema = z.object({
  state: z.enum(STATES, { error: 'State must be active, idle or locked.' }),
  source: z.enum(SOURCES, { error: 'Source must be system or window.' }).default('system'),
});

/** ?date= (GET /api/activity/team, GET /api/activity/export); empty means today. */
export const dateQuerySchema = z.object({
  date: dateString().optional(),
});

/**
 * ?from=&to= (GET /api/activity/me, GET /api/activity/users/[id]). Both optional: `to` defaults
 * to today and `from` to the first day of `to`'s month (the service fills them in).
 */
export const rangeQuerySchema = z
  .object({
    from: dateString('Pick a start date.').optional(),
    to: dateString('Pick an end date.').optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must be on or before the end date.',
    path: ['from'],
  })
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      dayjs(value.to, 'YYYY-MM-DD').diff(dayjs(value.from, 'YYYY-MM-DD'), 'day') < MAX_RANGE_DAYS,
    { message: `Pick at most ${MAX_RANGE_DAYS} days.`, path: ['to'] },
  );

/** The [id] in /api/activity/users/[id]: plain digits only (not '0x10', '1e3' or ' 16'). */
export const userIdParamSchema = z
  .string({ error: "We couldn't find that person." })
  .regex(/^[1-9]\d{0,15}$/, "We couldn't find that person.")
  .transform(Number);
