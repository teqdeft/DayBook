// My settings (CONTRACT 21): the keys each person may change for themselves, the values each key
// takes, the defaults, and the PATCH /api/me/preferences body.
import { z } from 'zod';
import { THEMES } from '@/lib/theme';

/** 'system' follows the computer's light or dark setting (the list lives with the browser code). */
export { THEMES };
/** Report top bar: which submit buttons show ('checkout' = Submit and check out). */
export const SUBMIT_BUTTONS = Object.freeze(['both', 'checkout', 'submit']);
/** The status of a task line added by hand. */
export const NEW_TASK_STATUSES = Object.freeze(['in_progress', 'done']);

/** Every key with its default (what a person who never changed it gets). */
export const PREFERENCE_DEFAULTS = Object.freeze({
  submitButtons: 'both',
  newTaskStatus: 'in_progress',
  carryOver: true,
  slackPreview: true,
  polishButton: true,
  polishLines: true,
  polishAfterTimers: true,
  bellRing: true,
  theme: 'system',
});

const onOff = (label) => z.boolean({ error: `${label} must be on or off.` });

/** One schema per key: what it may be set to (also used to ignore stored values gone stale). */
export const PREFERENCE_FIELDS = Object.freeze({
  submitButtons: z.enum(SUBMIT_BUTTONS, {
    error: 'Submit buttons must be Both, Submit and check out, or Submit report.',
  }),
  newTaskStatus: z.enum(NEW_TASK_STATUSES, {
    error: 'New tasks must start as In progress or Done.',
  }),
  carryOver: onOff('Bring unfinished tasks into my next report'),
  slackPreview: onOff('Show the Slack preview'),
  polishButton: onOff('Polish with AI button'),
  polishLines: onOff('Polish on each task line'),
  polishAfterTimers: onOff('Suggest wording after Fill report from timers'),
  bellRing: onOff('Ring the bell for unread notifications'),
  theme: z.enum(THEMES, { error: 'Theme must be Match my computer, Light or Dark.' }),
});

const UNKNOWN_KEY_SHOWN = 40;

/** '"fontSize" isn't one of your settings.' (a long key is cut short). */
function unknownKeyMessage(key) {
  const shown = key.slice(0, UNKNOWN_KEY_SHOWN);
  return shown ? `"${shown}" isn't one of your settings.` : "That isn't one of your settings.";
}

/**
 * The first key of a body that isn't a preference, or null (also for a body that isn't an
 * object). Own keys as JSON.parse made them, "__proto__" included.
 * @param {unknown} input
 * @returns {string | null}
 */
export function firstUnknownKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(PREFERENCE_DEFAULTS, key)) return key;
  }
  return null;
}

// Unknown keys are checked on the body as sent, before zod builds the object: only the first one
// is reported, so a body of thousands of them costs one short answer, and own keys that zod would
// drop or misread ("__proto__", "toString") are refused like any other.
const knownKeysOnly = z.unknown().superRefine((input, context) => {
  const key = firstUnknownKey(input);
  if (key === null) return;
  context.addIssue({ code: 'custom', path: [key], message: unknownKeyMessage(key) });
});

const optionalFields = Object.fromEntries(
  Object.entries(PREFERENCE_FIELDS).map(([key, schema]) => [key, schema.optional()]),
);

/**
 * PATCH /api/me/preferences: one or more keys of PREFERENCE_DEFAULTS. An unknown key (the first
 * one), a wrong value or an empty body fails with the field named.
 */
export const preferencesUpdateSchema = knownKeysOnly.pipe(
  z
    .object(optionalFields, { error: 'Send the settings to change.' })
    .refine(
      (values) => Object.values(values).some((value) => value !== undefined),
      'Choose a setting to change.',
    ),
);
