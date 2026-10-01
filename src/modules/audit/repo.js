import { db } from '@/lib/db';

/** Inserts one audit row and returns its id. */
export async function insertLog(row, trx = db) {
  const [id] = await trx('audit_logs').insert(row);
  return id;
}

/** Audit rows for one entity, newest first. */
export function listForEntity(entityType, entityId, { limit = 50 } = {}, trx = db) {
  return trx('audit_logs')
    .where({ entityType, entityId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(limit);
}
