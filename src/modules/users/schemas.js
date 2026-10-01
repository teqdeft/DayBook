import { z } from 'zod';
import { dayjs } from '@/lib/time';
import { ROLES } from '@/lib/permissions';

/** '' / null / undefined -> null, so a cleared picker or field saves "nothing". */
const emptyToNull = (value) =>
  value === '' || value === undefined || value === null
    ? null
    : typeof value === 'string'
      ? value.trim() || null
      : value;

const name = z
  .string({ error: 'Enter their full name.' })
  .trim()
  .min(1, 'Enter their full name.')
  .max(120, 'Name must be 120 characters or fewer.');

const email = z
  .string({ error: 'Enter their work email.' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter their work email.')
  .max(190, 'Email must be 190 characters or fewer.')
  .pipe(z.email('Enter a valid email, like name@company.com.'));

const designation = z
  .string({ error: 'Enter their designation.' })
  .trim()
  .min(1, 'Enter their designation.')
  .max(120, 'Designation must be 120 characters or fewer.');

const departmentId = z.coerce
  .number({ error: 'Pick a department.' })
  .int('Pick a department.')
  .positive('Pick a department.');

const reportsToId = z.preprocess(
  emptyToNull,
  z.coerce
    .number({ error: 'Pick who they report to.' })
    .int('Pick who they report to.')
    .positive('Pick who they report to.')
    .nullable(),
);

/** 'YYYY-MM-DD', a real calendar date; empty means "not known". */
const joinedOn = z.preprocess(
  emptyToNull,
  z
    .string({ error: 'Enter a date like 01-10-2026.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date like 01-10-2026.')
    .refine((value) => dayjs(value, 'YYYY-MM-DD', true).isValid(), 'Enter a date like 01-10-2026.')
    .nullable(),
);

/** '9:30' or '09:30' -> '09:30'; empty means the company default. */
const clock = (label) =>
  z.preprocess(
    emptyToNull,
    z
      .string({ error: `Enter the ${label} like 9:30 AM.` })
      .regex(/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `Enter the ${label} like 9:30 AM.`)
      .transform((value) => {
        const [h, m] = value.split(':');
        return `${h.padStart(2, '0')}:${m}`;
      })
      .nullable(),
  );

const role = z.enum(ROLES, { error: 'Pick a role.' });

const profileShape = {
  name,
  email,
  designation,
  departmentId,
  reportsToId: reportsToId.optional(),
  joinedOn: joinedOn.optional(),
  shiftStart: clock('shift start').optional(),
  shiftEnd: clock('shift end').optional(),
  tracksAttendance: z.boolean({ error: 'Choose on or off.' }).optional(),
};

/**
 * Both shift times or neither, and the shift ends after it starts. Used on the final values
 * (for an update: after merging with what is stored).
 * @returns {Record<string, string> | null} field errors, or null when fine
 */
export function shiftErrors(shiftStart, shiftEnd) {
  if (!shiftStart && !shiftEnd) return null;
  if (!shiftStart) return { shiftStart: 'Enter when their shift starts, or clear both times.' };
  if (!shiftEnd) return { shiftEnd: 'Enter when their shift ends, or clear both times.' };
  if (shiftEnd <= shiftStart) return { shiftEnd: 'The shift must end after it starts.' };
  return null;
}

/** POST /api/users (Add employee). `role` is only honoured for people who can manage roles. */
export const addUserSchema = z.object({ ...profileShape, role: role.optional() });

/** PATCH /api/users/:id (profile fields; never the role, which has its own endpoint). */
export const updateUserSchema = z.object(profileShape).partial();

/** PATCH /api/users/:id/role */
export const changeRoleSchema = z.object({ role });

/** The :id in /api/users/:id/... */
// Plain digits only, so '0x2', '2e0' or ' 2' never reach person 2 under a second URL.
export const userIdParamSchema = z.object({
  id: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z
      .string({ error: 'Unknown person.' })
      .regex(/^[1-9]\d{0,15}$/, 'Unknown person.')
      .transform(Number)
      .refine(Number.isSafeInteger, 'Unknown person.'),
  ),
});

/** GET /api/users?department=&status=&q=&limit=&offset= */
export const listUsersQuerySchema = z.object({
  // A department id, or its name ("Development").
  department: z.preprocess(
    (value) => emptyToNull(typeof value === 'number' ? String(value) : value),
    z.string().max(80, 'Pick a department from the list.').nullable().optional(),
  ),
  status: z.preprocess(
    emptyToNull,
    z
      .enum(['active', 'deactivated', 'all'], {
        error: 'Status must be active, deactivated or all.',
      })
      .nullable()
      .optional(),
  ),
  q: z.preprocess(
    emptyToNull,
    z.string().max(100, 'Search for 100 characters or fewer.').nullable().optional(),
  ),
  limit: z.coerce
    .number({ error: 'Limit must be a number from 1 to 100.' })
    .int('Limit must be a number from 1 to 100.')
    .min(1, 'Limit must be a number from 1 to 100.')
    .max(100, 'Limit must be a number from 1 to 100.')
    .default(50),
  offset: z.coerce
    .number({ error: 'Offset must be 0 or more.' })
    .int('Offset must be 0 or more.')
    .min(0, 'Offset must be 0 or more.')
    .default(0),
});
