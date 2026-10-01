import { z } from 'zod';

/** '9:30', '09:30' or '09:30:00' -> '09:30'. Anything else fails with a readable message. */
const clock = (label) =>
  z
    .string({ error: `Enter ${label} as a time like 09:30.` })
    .trim()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `Enter ${label} as a time like 09:30.`)
    .transform((value) => {
      const [h, m] = value.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    });

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Whole numbers; numeric strings from form inputs are accepted too. */
const wholeNumber = ({ min, max, typeMessage, rangeMessage }) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number({ error: typeMessage }).int(typeMessage).min(min, rangeMessage).max(max, rangeMessage),
  );

/** Allowed screen-time values (Settings form, API and stored-value clean-up use the same). */
export const ACTIVITY_IDLE_MINUTES = Object.freeze({ min: 1, max: 120 });
export const ACTIVITY_RETENTION_DAYS = Object.freeze({ min: 7, max: 3650 });

/** Empty strings become null, so a cleared picker saves "no channel". */
const nullableText = (max, message) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * PUT /api/settings. Every key is optional: only the keys sent (and actually changed) are saved.
 * Clock values are 'HH:mm' in company time.
 */
export const settingsUpdateSchema = z
  .object({
    companyName: z
      .string({ error: 'Enter the company name.' })
      .trim()
      .min(1, 'Enter the company name.')
      .max(120, 'Company name must be 120 characters or fewer.'),
    timezone: z
      .string({ error: 'Pick a time zone.' })
      .trim()
      .min(1, 'Pick a time zone.')
      .max(64, 'Pick a valid time zone.')
      .refine(isTimeZone, 'Pick a valid time zone.'),
    workingDays: z
      .array(
        wholeNumber({
          min: 1,
          max: 7,
          typeMessage: 'Working days must be Monday (1) to Sunday (7).',
          rangeMessage: 'Working days must be Monday (1) to Sunday (7).',
        }),
        { error: 'Pick at least one working day.' },
      )
      .min(1, 'Pick at least one working day.')
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    officeStart: clock('the office start time'),
    officeEnd: clock('the office end time'),
    lateAfter: clock('the late mark time'),
    reportReminderAt: clock('the report reminder time'),
    reportLock: z
      .string({ error: 'Pick when reports lock.' })
      .trim()
      .regex(/^(same|next)_day_\d{2}:\d{2}$/, 'Pick when reports lock.')
      .refine((value) => {
        const [h, m] = value.slice(-5).split(':').map(Number);
        return h <= 23 && m <= 59;
      }, 'Pick when reports lock.'),
    gapWarningMinutes: wholeNumber({
      min: 10,
      max: 600,
      typeMessage: 'Gap warning must be whole minutes.',
      rangeMessage: 'Gap warning must be between 10 and 600 minutes.',
    }),
    stuckTaskDays: wholeNumber({
      min: 1,
      max: 60,
      typeMessage: 'Stuck task days must be a whole number.',
      rangeMessage: 'Stuck task days must be between 1 and 60.',
    }),
    allowUnverifiedOffice: z.boolean({ error: 'Choose on or off.' }),
    autoMarkMissingCheckout: z.boolean({ error: 'Choose on or off.' }),
    slackEnabled: z.boolean({ error: 'Choose on or off.' }),
    slackReportChannelId: nullableText(40, 'Pick a channel from the list.'),
    slackReportChannelName: nullableText(80, 'Channel name is too long.').transform((value) =>
      value ? value.replace(/^#/, '') || null : null,
    ),
    slackPostReports: z.boolean({ error: 'Choose on or off.' }),
    slackRemind: z.boolean({ error: 'Choose on or off.' }),
    slackUrgentNotify: z.boolean({ error: 'Choose on or off.' }),
    slackRequestsNotify: z.boolean({ error: 'Choose on or off.' }),
    // Screen time (CONTRACT section 11)
    activityTrackingEnabled: z.boolean({ error: 'Choose on or off.' }),
    activityIdleMinutes: wholeNumber({
      min: ACTIVITY_IDLE_MINUTES.min,
      max: ACTIVITY_IDLE_MINUTES.max,
      typeMessage: 'Idle time must be whole minutes.',
      rangeMessage: `Idle time must be between ${ACTIVITY_IDLE_MINUTES.min} and ${ACTIVITY_IDLE_MINUTES.max} minutes.`,
    }),
    activityRetentionDays: wholeNumber({
      min: ACTIVITY_RETENTION_DAYS.min,
      max: ACTIVITY_RETENTION_DAYS.max,
      typeMessage: 'Keep screen time for a whole number of days.',
      rangeMessage: `Keep screen time for ${ACTIVITY_RETENTION_DAYS.min} to ${ACTIVITY_RETENTION_DAYS.max} days.`,
    }),
    // Desktop notifications (CONTRACT section 14)
    pushEnabled: z.boolean({ error: 'Choose on or off.' }),
  })
  .partial();

/** '::ffff:203.0.113.24' -> '203.0.113.24'; IPv6 in lowercase. */
export function normalizeIp(value) {
  const ip = String(value ?? '')
    .trim()
    .toLowerCase();
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

const ipv4 = z.ipv4();
const ipv6 = z.ipv6();

/** POST /api/office-networks */
export const officeNetworkSchema = z.object({
  name: z
    .string({ error: 'Enter a name for this network.' })
    .trim()
    .min(1, 'Enter a name for this network.')
    .max(80, 'Name must be 80 characters or fewer.'),
  ipAddress: z
    .string({ error: 'Enter the IP address.' })
    .transform(normalizeIp)
    .refine((value) => value.length > 0, 'Enter the IP address.')
    .refine(
      (value) =>
        value.length === 0 || ipv4.safeParse(value).success || ipv6.safeParse(value).success,
      'Enter a valid IP address, like 203.0.113.24.',
    ),
});

/** The :id in /api/office-networks/:id */
export const officeNetworkIdSchema = z.object({
  id: z.coerce.number({ error: 'Unknown network.' }).int().positive('Unknown network.'),
});
