// What every holiday and leave write does around itself (CONTRACT 25, items 6 and 9): the day
// rules over each changed date range inside the write's transaction, and after the commit the
// caches cleared in this process and one re-check for rows that a check-in created while the
// write ran (it read the calendar before the write). Shared by holidays.js and leave.js.
import { logger } from '@/lib/logger';
import { clearCompanyDayCache } from './calendarReads';
import { applyDayRules, recheckDayRules } from './dayRules';
import { clearNeedsLookCache } from './monthExports';
import * as repo from './repo';

/**
 * Merges the rows two passes of the day rules changed: one entry per row, with the first
 * pass's `before` and the last pass's `after`.
 * @param {...Array<{ rowId: number, before: object, after: object }>} lists oldest pass first
 * @returns {Array<object>}
 */
export function mergeChanged(...lists) {
  const byRow = new Map();
  for (const item of lists.flat()) {
    const seen = byRow.get(item.rowId);
    byRow.set(item.rowId, seen ? { ...item, before: seen.before } : item);
  }
  return [...byRow.values()];
}

/**
 * Runs `write(trx)` inside the day rules of every scope (nested, so each date range is compared
 * before and after the one write): a holiday move has the old and the new date, a leave change
 * the old and the new days. Separate ranges keep each calendar read small (a holiday can move
 * across three years; loadCalendar reads at most 400 days).
 * @template T
 * @param {Array<{ userIds?: number[], from: string, to: string, reason: string,
 *   actorId?: number | null }>} scopes
 * @param {import('knex').Knex.Transaction} trx
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} write
 * @returns {Promise<{ result: T, changed: object[] }>} changed as applyDayRules()
 */
export async function withDayRules(scopes, trx, write) {
  if (scopes.length === 0) return { result: await write(trx), changed: [] };
  const [scope, ...rest] = scopes;
  const outer = await applyDayRules(scope, trx, (tx) => withDayRules(rest, tx, write));
  return {
    result: outer.result.result,
    changed: mergeChanged(outer.result.changed, outer.changed),
  };
}

/** The scopes of a change, without a second copy of the same range. */
export function distinctScopes(scopes) {
  const seen = new Set();
  return scopes.filter((scope) => {
    const key = `${scope.from}|${scope.to}|${(scope.userIds ?? []).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * After a holiday or leave write has committed: clears the companyDay cache (holiday writes) and
 * the Needs a look cache in this process, then re-checks each scope once in its own transaction
 * for rows created since the write started. The write itself stays saved when the re-check
 * fails: the error is logged, and the next holiday or leave change of those days fixes the rows.
 * @param {{ scopes: object[], since: Date, holidays?: boolean }} input since = the write's start
 *   (to the second); holidays = a holiday write (clears the companyDay cache)
 * @returns {Promise<object[]>} the rows the re-check changed (as applyDayRules() changed)
 */
export async function afterCalendarWrite({ scopes, since, holidays = false }) {
  if (holidays) clearCompanyDayCache();
  clearNeedsLookCache();
  const changed = [];
  for (const scope of scopes) {
    try {
      const result = await repo.transaction((trx) => recheckDayRules({ ...scope, since }, trx));
      changed.push(...result.changed);
    } catch (error) {
      logger.error({ err: error, from: scope.from, to: scope.to }, 'day rules re-check failed');
    }
  }
  return changed;
}
