import { db } from '@/lib/db';

/** Inserts one audit row and returns its id. */
export async function insertLog(row, trx = db) {
  const [id] = await trx('audit_logs').insert(row);
  return id;
}

const NEWEST_FIRST = [
  { column: 'createdAt', order: 'desc' },
  { column: 'id', order: 'desc' },
];

/** Audit rows for one entity, newest first. */
export function listForEntity(entityType, entityId, { limit = 50 } = {}, trx = db) {
  return trx('audit_logs').where({ entityType, entityId }).orderBy(NEWEST_FIRST).limit(limit);
}

/**
 * Audit rows for several entities of one type (at most 500 ids a call, on the entity_type,
 * entity_id index), newest first. `actions` (optional) keeps only those actions; `limit` (optional)
 * the newest that many.
 */
export function listForEntities(entityType, entityIds, { actions, limit } = {}, trx = db) {
  const query = trx('audit_logs').where({ entityType }).whereIn('entityId', entityIds);
  if (actions) query.whereIn('action', actions);
  query.orderBy(NEWEST_FIRST);
  if (limit) query.limit(limit);
  return query;
}

/**
 * Audit rows of one entity type written on or after `since` (on the entity_type prefix of the
 * entity_type, entity_id index), newest first. `actions` (optional) keeps only those actions.
 */
export function listForType(entityType, { since, actions } = {}, trx = db) {
  const query = trx('audit_logs').where({ entityType }).where('createdAt', '>=', since);
  if (actions) query.whereIn('action', actions);
  return query.orderBy(NEWEST_FIRST);
}
