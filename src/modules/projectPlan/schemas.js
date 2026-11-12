// Input schemas for the project plan endpoints (CONTRACT 22). Safe in the browser. Dates are real
// calendar dates in a sensible range: a typed "0202-12-15" would otherwise make a deadline nobody
// meant and a timeline thousands of weeks wide.
import { z } from 'zod';
import { dayjs } from '@/lib/time';
import { isPhase, PHASE_KEYS } from './phases';

const BODY_MESSAGE = 'Send the fields as a JSON object.';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[1-9]\d{0,15}$/;
const FIRST_YEAR = 2000;
const LAST_YEAR = 2099;

export const END_BEFORE_START = "The end date can't be before the start date.";

function isPlanDate(value) {
  if (!DATE_PATTERN.test(value) || !dayjs(value, 'YYYY-MM-DD', true).isValid()) return false;
  const year = Number(value.slice(0, 4));
  return year >= FIRST_YEAR && year <= LAST_YEAR;
}

/**
 * A 'YYYY-MM-DD' date or null ("" too, an emptied date box). Leaving it out fails with `message`.
 * @param {string} message
 */
export function planDate(message) {
  return z.preprocess(
    (value) => (value === '' ? null : value),
    z.string({ error: message }).refine(isPlanDate, message).nullable(),
  );
}

/** A phase on the list. */
const phaseKey = z.enum(PHASE_KEYS, { error: 'Pick a phase from the list.' });

/** A task's phase: one on the list, or null ("" too, the "No phase yet" option). */
export const taskPhase = z.preprocess(
  (value) => (value === '' ? null : value),
  phaseKey.nullable(),
);

export const PHASE_CHANGED = 'The phase changed. Reload the page.';

/**
 * PUT /api/projects/:id/phase. `from` is the phase the page showed when the button was drawn (null
 * for Not set): when the project has moved since, the move is refused, so an old page can't turn a
 * "Move to Development" into a move back. Left out, the move isn't checked.
 */
export const projectPhaseSchema = z.object(
  { phase: phaseKey, from: phaseKey.nullable().optional() },
  { error: BODY_MESSAGE },
);

/** PUT /api/projects/:id/deadline: null clears it. */
export const projectDeadlineSchema = z.object(
  { deadline: planDate('Pick a real date, or clear the deadline.') },
  { error: BODY_MESSAGE },
);

/** PUT /api/projects/:id/phases/:phase/dates: both are needed, and null empties one. */
export const phaseDatesSchema = z
  .object(
    {
      plannedStart: planDate('Pick a real start date, or leave it empty.'),
      plannedEnd: planDate('Pick a real end date, or leave it empty.'),
    },
    { error: BODY_MESSAGE },
  )
  .refine(
    ({ plannedStart, plannedEnd }) => !plannedStart || !plannedEnd || plannedEnd >= plannedStart,
    { path: ['plannedEnd'], message: END_BEFORE_START },
  );

const idParamSchema = z.object({ id: z.string().regex(ID_PATTERN) });

/**
 * The numeric :id of a route, or null when it isn't a plain-digit id (routes answer 404).
 * @param {Record<string, string>} params
 * @returns {number | null}
 */
export function routeId(params) {
  const parsed = idParamSchema.safeParse(params ?? {});
  if (!parsed.success) return null;
  const id = Number(parsed.data.id);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * The :phase of a route, or null when it isn't on the list (routes answer 404).
 * @param {Record<string, string>} params
 * @returns {string | null}
 */
export function routePhase(params) {
  return isPhase(params?.phase) ? params.phase : null;
}
