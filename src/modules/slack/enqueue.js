// Queueing a Slack message (slack_outbox). Its own file so service.js and todo.js can both use it.
import { db, toJson } from '@/lib/db';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { enqueueSchema } from './schemas';

/**
 * Adds a row to slack_outbox. Call it inside the transaction of the change it belongs to, so the
 * message is queued only if the change commits. The worker sends it within about 10 seconds.
 * @param {{ kind: 'report_post' | 'report_update' | 'dm' | 'message' | 'todo_post' | 'todo_update',
 *   channel: string, payload: { text: string, [key: string]: unknown },
 *   relatedType?: string | null, relatedId?: number | null }} message channel is a channel ID, or
 *   a Slack user ID for a DM
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} the outbox row id
 * @throws ZodError on a malformed message (a programming error)
 */
export function enqueue(message, trx = db) {
  const row = enqueueSchema.parse(message);
  const at = nowDate();
  return repo.insertOutbox(
    {
      kind: row.kind,
      channel: row.channel,
      payload: toJson(row.payload),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: at,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}
