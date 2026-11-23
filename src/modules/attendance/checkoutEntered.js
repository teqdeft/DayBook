// Who typed the check-out of a row that was missing (CONTRACT 25, items B and 7): the person from
// Today's pop-up, or HR (Fix, bulk fix and any later HR edit of that check-out), shown as "By
// Priya". Stored on the row (checkout_entered_by, checkout_entered_at and checkout_suggested_at,
// the suggestion the person saw); never part of ROW_COLUMNS. "Past last seen" is worked out when
// read. Before migration 018 reads are empty and writes are skipped (try018Write), so HR's fixes
// still save the check-out.
import { db } from '@/lib/db';
import { dayjs, nowDate } from '@/lib/time';
import { guard018Read, try018Write } from './migration018';

/** A self-entered check-out more than this after the suggested time gets HR's "Check" tag. */
export const PAST_LAST_SEEN_MINUTES = 15;

/**
 * True when the person entered the check-out themselves more than 15 minutes after Daybook last
 * saw them working, or with nothing to suggest.
 * @param {{ self: boolean, checkOutAt?: Date | string | null, suggestedAt?: Date | null }} input
 */
export function isPastLastSeen({ self, checkOutAt, suggestedAt }) {
  if (!self || !checkOutAt) return false;
  if (!suggestedAt) return true;
  return dayjs(checkOutAt).diff(dayjs(suggestedAt), 'second') > PAST_LAST_SEEN_MINUTES * 60;
}

/**
 * Who entered the check-out of each row, for the rows that have one.
 * @param {number[]} rowIds attendance ids
 * @returns {Promise<Map<number, { by: { id: number, name: string }, at: Date, self: boolean,
 *   suggestedAt: Date | null, pastLastSeen: boolean }>>} empty before migration 018
 */
export async function checkoutEnteredFor(rowIds) {
  const ids = [...new Set((rowIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await guard018Read(
    'checkouts',
    () =>
      db('attendance as a')
        .join('users as u', 'u.id', 'a.checkoutEnteredBy')
        .whereIn('a.id', ids)
        .select(
          'a.id',
          'a.userId',
          'a.checkOutAt',
          'a.checkoutEnteredBy',
          'a.checkoutEnteredAt',
          'a.checkoutSuggestedAt',
          'u.name as enteredByName',
        ),
    () => [],
  );
  const result = new Map();
  for (const row of rows) {
    const self = row.checkoutEnteredBy === row.userId;
    const suggestedAt = row.checkoutSuggestedAt ?? null;
    result.set(row.id, {
      by: { id: row.checkoutEnteredBy, name: row.enteredByName },
      at: row.checkoutEnteredAt,
      self,
      suggestedAt,
      pastLastSeen: isPastLastSeen({ self, checkOutAt: row.checkOutAt, suggestedAt }),
    });
  }
  return result;
}

/**
 * Marks who typed a row's check-out (a separate statement inside the caller's transaction; a
 * no-op before migration 018). HR passes no suggestion (null).
 * @param {{ rowId: number, userId: number, suggestedAt?: Date | null }} input
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<number | null>} rows changed, null before migration 018
 */
export function markCheckoutEntered({ rowId, userId, suggestedAt = null }, trx = db) {
  return try018Write('checkouts', () =>
    trx('attendance').where({ id: rowId }).update({
      checkoutEnteredBy: userId,
      checkoutEnteredAt: nowDate(),
      checkoutSuggestedAt: suggestedAt,
    }),
  );
}

/**
 * Clears who typed a row's check-out (an approved correction request sets the time instead).
 * @param {number} rowId
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<number | null>} rows changed, null before migration 018
 */
export function clearCheckoutEntered(rowId, trx = db) {
  return try018Write('checkouts', () =>
    trx('attendance').where({ id: rowId }).update({
      checkoutEnteredBy: null,
      checkoutEnteredAt: null,
      checkoutSuggestedAt: null,
    }),
  );
}

/**
 * True when the row's check-out was entered by someone (the HR Edit rule: a new check-out on such
 * a row names whoever typed it). False before migration 018.
 * @param {number} rowId
 * @param {import('knex').Knex.Transaction} [trx]
 */
export async function hasCheckoutEntered(rowId, trx = db) {
  const row = await guard018Read(
    'checkouts',
    () => trx('attendance').select('checkoutEnteredBy').where({ id: rowId }).first(),
    () => null,
  );
  return Boolean(row?.checkoutEnteredBy);
}
