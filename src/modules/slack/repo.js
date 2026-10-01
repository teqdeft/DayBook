import { db } from '@/lib/db';

const REPORT_KINDS = ['report_post', 'report_update'];

export async function insertOutbox(row, trx = db) {
  const [id] = await trx('slack_outbox').insert(row);
  return id;
}

export function findOutbox(id, trx = db) {
  return trx('slack_outbox').where({ id }).first();
}

/**
 * Due pending rows, oldest first, locked FOR UPDATE (SKIP LOCKED when the database supports it)
 * so two workers never claim the same row. Call inside a transaction.
 */
export function selectDueForUpdate({ now, limit, skipLocked }, trx) {
  const query = trx('slack_outbox')
    .where({ status: 'pending' })
    .where('nextAttemptAt', '<=', now)
    .orderBy('id', 'asc')
    .limit(limit)
    .forUpdate();
  return skipLocked ? query.skipLocked() : query;
}

/** Pushes next_attempt_at forward for claimed rows (the claim lease). */
export function setNextAttempt(ids, nextAttemptAt, trx = db) {
  if (ids.length === 0) return 0;
  return trx('slack_outbox')
    .whereIn('id', ids)
    .where({ status: 'pending' })
    .update({ nextAttemptAt });
}

export function updateOutbox(id, changes, trx = db) {
  return trx('slack_outbox').where({ id }).update(changes);
}

/** True when a later report message row exists for the same report (this one is out of date). */
export async function hasNewerReportMessage({ id, reportId }, trx = db) {
  const row = await trx('slack_outbox')
    .where({ relatedType: 'report', relatedId: reportId })
    .whereIn('kind', REPORT_KINDS)
    .where('id', '>', id)
    .first('id');
  return Boolean(row);
}

/** The latest delivered message for a report (its channel and ts), if one was sent. */
export function findSentReportMessage(reportId, trx = db) {
  return trx('slack_outbox')
    .where({ relatedType: 'report', relatedId: reportId, status: 'sent' })
    .whereIn('kind', REPORT_KINDS)
    .whereNotNull('resultTs')
    .whereNotNull('channel')
    .orderBy('id', 'desc')
    .first('id', 'channel', 'resultTs');
}

export async function pendingStats(trx = db) {
  const row = await trx('slack_outbox')
    .where({ status: 'pending' })
    .count({ pending: '*' })
    .min({ oldestPendingAt: 'createdAt' })
    .first();
  return { pending: Number(row?.pending ?? 0), oldestPendingAt: row?.oldestPendingAt ?? null };
}

export async function countFailedSince(since, trx = db) {
  const row = await trx('slack_outbox')
    .where({ status: 'failed' })
    .where('updatedAt', '>=', since)
    .count({ count: '*' })
    .first();
  return Number(row?.count ?? 0);
}

export function deleteSentBefore(before, trx = db) {
  return trx('slack_outbox').where({ status: 'sent' }).where('createdAt', '<', before).delete();
}
