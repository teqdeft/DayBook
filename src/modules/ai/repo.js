// ai_usage (one row per Gemini request) and ai_summaries (the worker's texts), CONTRACT 20.
import { db } from '@/lib/db';

/**
 * Saves one Gemini request — { userId, feature, model, ok, errorCode, inputTokens, outputTokens,
 * createdAt } — and returns its id.
 */
export async function insertUsage(row, trx = db) {
  const [id] = await trx('ai_usage').insert(row);
  return id;
}

/** Fills in how a saved request went: { ok, errorCode, inputTokens, outputTokens }. */
export function updateUsage(id, changes, trx = db) {
  return trx('ai_usage').where({ id }).update(changes);
}

const LIMITS_LOCK = 'daybook_ai_limits';

/** SELECT <expression> on one connection (GET_LOCK and RELEASE_LOCK). */
function selectOn(connection, sql, bindings) {
  return db
    .select(db.raw(`${sql} AS result`, bindings))
    .connection(connection)
    .then((rows) => rows[0]?.result);
}

/**
 * Runs `fn(on)` while holding the MySQL named lock for the AI limits, which every web and worker
 * process shares. Everything runs on one pooled connection outside a transaction, so what `fn`
 * writes is committed before the lock is released; `on(table)` starts a query on that
 * connection. The lock also ends with its connection, so a crash never keeps it.
 * @template T
 * @param {(on: (table: string) => import('knex').Knex.QueryBuilder) => Promise<T>} fn
 * @param {{ waitSeconds?: number }} [options] how long to wait for the lock
 * @returns {Promise<{ locked: true, value: T } | { locked: false }>} locked false when another
 *   request held the lock all that time
 */
export async function withLimitsLock(fn, { waitSeconds = 5 } = {}) {
  const connection = await db.client.acquireConnection();
  try {
    const got = await selectOn(connection, 'GET_LOCK(?, ?)', [LIMITS_LOCK, waitSeconds]);
    if (Number(got) !== 1) return { locked: false };
    try {
      return { locked: true, value: await fn((table) => db(table).connection(connection)) };
    } finally {
      await selectOn(connection, 'RELEASE_LOCK(?)', [LIMITS_LOCK]);
    }
  } finally {
    await db.client.releaseConnection(connection);
  }
}

/**
 * Gemini requests made in [from, to), optionally for one person and one feature.
 * @param {{ from: Date, to: Date, userId?: number, feature?: string }} filter
 * @returns {Promise<number>}
 */
export async function countUsage({ from, to, userId, feature }, trx = db) {
  const query = trx('ai_usage').where('createdAt', '>=', from).andWhere('createdAt', '<', to);
  if (userId !== undefined && userId !== null) query.andWhere({ userId });
  if (feature) query.andWhere({ feature });
  const row = await query.count({ count: '*' }).first();
  return Number(row?.count ?? 0);
}

const SUMMARY_COLUMNS = [
  'id',
  'kind',
  'recipientId',
  'periodFrom',
  'periodTo',
  'title',
  'body',
  'createdAt',
];

/** Inserts a summary and returns its id. Throws errno 1062 when that period is already saved. */
export async function insertSummary(row, trx = db) {
  const [id] = await trx('ai_summaries').insert(row);
  return id;
}

/** Replaces the text of the saved summary for (kind, recipient, period start); returns its id. */
export async function replaceSummary({ kind, recipientId, periodFrom, ...changes }, trx = db) {
  await trx('ai_summaries').where({ kind, recipientId, periodFrom }).update(changes);
  const row = await trx('ai_summaries').where({ kind, recipientId, periodFrom }).first('id');
  return row?.id ?? null;
}

/** Only these kinds (all when `kinds` isn't given; none for an empty list). */
function ofKinds(query, kinds) {
  if (Array.isArray(kinds)) query.whereIn('kind', kinds.length > 0 ? kinds : ['']);
  return query;
}

/** A person's summaries of these kinds, newest first. */
export function listSummaries(recipientId, { limit, offset, kinds }, trx = db) {
  return ofKinds(trx('ai_summaries').where({ recipientId }), kinds)
    .select(SUMMARY_COLUMNS)
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(limit)
    .offset(offset);
}

export async function countSummaries(recipientId, { kinds } = {}, trx = db) {
  const row = await ofKinds(trx('ai_summaries').where({ recipientId }), kinds)
    .count({ count: '*' })
    .first();
  return Number(row?.count ?? 0);
}

/** Who already has a summary of this kind for the period starting `periodFrom`. */
export async function listSummaryRecipients({ kind, periodFrom }, trx = db) {
  const rows = await trx('ai_summaries').where({ kind, periodFrom }).select('recipientId');
  return rows.map((row) => Number(row.recipientId));
}

export function findSummary(id, trx = db) {
  return trx('ai_summaries').where({ id }).first(SUMMARY_COLUMNS);
}
