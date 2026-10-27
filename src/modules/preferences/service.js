// My settings (CONTRACT 21): how Daybook looks and works for one person (submit buttons, carry-over,
// polish, the bell, the theme). Company rules stay in Settings. A person only ever reads and changes
// their own row; there is no audit entry.
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { PREFERENCE_DEFAULTS, PREFERENCE_FIELDS, preferencesUpdateSchema } from './schemas';

export { PREFERENCE_DEFAULTS, SUBMIT_BUTTONS, NEW_TASK_STATUSES, THEMES } from './schemas';

// MySQL's "table doesn't exist": a deploy before `npm run migrate` added user_preferences.
const NO_SUCH_TABLE = 1146;
let warnedMissingTable = false;

function isMissingTable(error) {
  return error?.errno === NO_SUCH_TABLE || error?.code === 'ER_NO_SUCH_TABLE';
}

function warnMissingTable() {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  logger.warn('user_preferences is missing (run npm run migrate); everyone gets the defaults');
}

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  // No prototype: an unknown key may be named "__proto__" or like an Object method ("toString").
  const fields = Object.create(null);
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!Object.hasOwn(fields, path)) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

function requireUserId(user) {
  const id = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('UNAUTHENTICATED');
  return id;
}

/**
 * Stored values over the defaults. Keys that aren't preferences, and stored values a key no
 * longer accepts, are ignored (that key gets its default).
 * @param {unknown} stored what the row holds (any JSON value), or null
 * @returns {typeof PREFERENCE_DEFAULTS} a new, unfrozen object with every key
 */
export function withDefaults(stored) {
  const values = { ...PREFERENCE_DEFAULTS };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return values;
  for (const key of Object.keys(PREFERENCE_DEFAULTS)) {
    if (!Object.hasOwn(stored, key)) continue;
    const parsed = PREFERENCE_FIELDS[key].safeParse(stored[key]);
    if (parsed.success) values[key] = parsed.data;
  }
  return values;
}

/**
 * Every preference of one person: stored values over PREFERENCE_DEFAULTS. Without the table
 * (errno 1146) everyone gets the defaults, with one warning in the log per process; other
 * database errors throw.
 * @param {number} userId
 * @returns {Promise<{ submitButtons: 'both' | 'checkout' | 'submit',
 *   newTaskStatus: 'in_progress' | 'done', carryOver: boolean, slackPreview: boolean,
 *   polishButton: boolean, polishLines: boolean, polishAfterTimers: boolean, bellRing: boolean,
 *   theme: 'system' | 'light' | 'dark' }>}
 */
export async function getFor(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return { ...PREFERENCE_DEFAULTS };
  try {
    return withDefaults(await repo.findPrefs(id));
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    warnMissingTable();
    return { ...PREFERENCE_DEFAULTS };
  }
}

/**
 * Saves one or more of the person's own preferences; the keys not sent keep their values. A value
 * equal to the default is stored as "not changed", so the row only holds real choices.
 * @param {{ user: { id: number }, values: Record<string, unknown> }} input values = the PATCH body
 * @returns {Promise<object>} every preference after the change (as getFor)
 * @throws VALIDATION_FAILED (empty, an unknown key (only the first is named) or a wrong value;
 *   the field is named),
 *   UNAUTHENTICATED (no user), PREFERENCES_UNAVAILABLE (503, the table is missing)
 */
export async function update({ user, values }) {
  const userId = requireUserId(user);
  const changes = parseInput(preferencesUpdateSchema, values);
  const patch = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    patch[key] = value === PREFERENCE_DEFAULTS[key] ? null : value;
  }
  try {
    await repo.upsertPrefs({ userId, patch, at: nowDate() });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    warnMissingTable();
    throw new AppError('PREFERENCES_UNAVAILABLE', {
      status: 503,
      message: "Your settings can't be saved yet. Please try again later.",
    });
  }
  return getFor(userId);
}
