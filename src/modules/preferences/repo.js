// user_preferences (CONTRACT 21): one row per person, `prefs` holding only the keys that differ
// from the defaults.
import { db, parseJson, toJson } from '@/lib/db';

/**
 * The person's stored preferences as saved (any JSON value), or null without a row.
 * @param {number} userId
 */
export async function findPrefs(userId, trx = db) {
  const row = await trx('userPreferences').where({ userId }).first('prefs');
  return row ? parseJson(row.prefs) : null;
}

/**
 * Applies `patch` to the person's row in one statement (JSON merge patch, RFC 7396): keys with a
 * value are set, keys with null are removed, the others stay. Creates the row on the first change.
 * Two changes saved at the same moment both stay (no read-then-write). Works on MariaDB 10.4 and
 * MySQL 8 (JSON_MERGE_PATCH; the insert branch merges into '{}' so a new row never holds a null).
 * @param {{ userId: number, patch: Record<string, unknown>, at: Date }} input
 */
export function upsertPrefs({ userId, patch, at }, trx = db) {
  const json = toJson(patch);
  return trx.raw(
    'INSERT INTO `user_preferences` (`user_id`, `prefs`, `updated_at`) ' +
      "VALUES (?, JSON_MERGE_PATCH('{}', ?), ?) " +
      'ON DUPLICATE KEY UPDATE `prefs` = JSON_MERGE_PATCH(`prefs`, ?), `updated_at` = ?',
    [userId, json, at, json, at],
  );
}
