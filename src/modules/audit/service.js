import { db, parseJson, toJson } from '@/lib/db';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { auditEntrySchema } from './schemas';

/**
 * Writes one audit_logs row. Call it inside the transaction of the change it records, so the log
 * and the change commit together.
 * @param {{ actorId?: number | null, action: string, entityType: string, entityId?: number | null,
 *   before?: unknown, after?: unknown, reason?: string | null, ip?: string | null }} entry
 *   action like 'settings.update'; before/after are stored as JSON (undefined -> NULL).
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} the new audit row id
 * @throws ZodError when action or entityType is missing (a programming error, not user input)
 */
export async function log(entry, trx = db) {
  const parsed = auditEntrySchema.parse(entry);
  const at = nowDate();
  return repo.insertLog(
    {
      actorId: parsed.actorId,
      action: parsed.action,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: parsed.reason,
      ip: parsed.ip,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}

/**
 * The audit trail of one entity, newest first, with before/after parsed.
 * @param {string} entityType for example 'settings' or 'attendance'
 * @param {number | null} entityId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<{ id: number, actorId: number | null, action: string, entityType: string,
 *   entityId: number | null, before: unknown, after: unknown, reason: string | null,
 *   ip: string | null, createdAt: Date }>>}
 */
export async function listForEntity(entityType, entityId, { limit = 50 } = {}) {
  const rows = await repo.listForEntity(entityType, entityId, {
    limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
  });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: parseJson(row.before),
    after: parseJson(row.after),
    reason: row.reason,
    ip: row.ip,
    createdAt: row.createdAt,
  }));
}
