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

/** Ids are read 500 at a time, so one IN list never grows past what the index handles well. */
const ID_CHUNK = 500;

/** One audit row as callers get it: before and after parsed, never the raw JSON. */
function toEntry(row) {
  return {
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
  };
}

/** Newest first: created_at, then id (two rows written in the same second keep their order). */
function newestFirst(a, b) {
  const byTime = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return byTime !== 0 ? byTime : b.id - a.id;
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
  return rows.map(toEntry);
}

/**
 * The audit trail of several entities of one type, newest first, with before/after parsed
 * (CONTRACT 25: the person month's Changes, the month view's missing and auto check-outs, the
 * HR notes). The ids are read in chunks of 500 on the entity_type, entity_id index.
 * @param {{ entityType: string, entityIds: Array<number | string>, actions?: string[],
 *   limit?: number }} input actions: only these (none given = every action); limit: the newest
 *   that many overall (none given = every row)
 * @returns {Promise<Array<{ id: number, actorId: number | null, action: string,
 *   entityType: string, entityId: number | null, before: unknown, after: unknown,
 *   reason: string | null, ip: string | null, createdAt: Date }>>} as listForEntity; empty when
 *   no id (or an empty actions list) is given
 */
export async function listForEntities({ entityType, entityIds, actions, limit } = {}) {
  const ids = [...new Set((entityIds ?? []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  const cap =
    limit === undefined || limit === null ? null : Math.max(Math.trunc(Number(limit)) || 0, 1);
  if (!entityType || ids.length === 0 || (actions && actions.length === 0)) return [];
  const rows = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    rows.push(...(await repo.listForEntities(entityType, chunk, { actions, limit: cap })));
  }
  const sorted = rows.sort(newestFirst);
  return (cap ? sorted.slice(0, cap) : sorted).map(toEntry);
}

/**
 * The audit rows of one entity type written on or after a moment, newest first, with before/after
 * parsed (CONTRACT 25: the person month finds a deleted or moved leave by its snapshot, since its
 * entry no longer touches the month). Reads on the entity_type prefix of the index.
 * @param {{ entityType: string, since: Date | string, actions?: string[] }} input actions: only
 *   these (none given = every action)
 * @returns {Promise<Array<{ id: number, actorId: number | null, action: string,
 *   entityType: string, entityId: number | null, before: unknown, after: unknown,
 *   reason: string | null, ip: string | null, createdAt: Date }>>} as listForEntities; empty
 *   without a type or a valid `since` (or with an empty actions list)
 */
export async function listForType({ entityType, since, actions } = {}) {
  const from = since ? new Date(since) : null;
  if (!entityType || !from || Number.isNaN(from.valueOf())) return [];
  if (actions && actions.length === 0) return [];
  const rows = await repo.listForType(entityType, { since: from, actions });
  return rows.map(toEntry);
}
