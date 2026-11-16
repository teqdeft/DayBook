// Sending a person's to-do (CONTRACT 24), mirroring the report post in outbox.js: a row that a
// newer to-do row for the same report replaces is skipped, a post for a report that already has a
// to-do message updates that message (chat.update), and a message that can no longer be updated
// is posted again in the to-do channel. The report remembers the message through
// reports.saveTodoSlackMessage, so "Update post" edits the same one.
import { logger } from '@/lib/logger';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import * as client from './client';
import * as repo from './repo';

export const TODO_KINDS = new Set(['todo_post', 'todo_update']);
const RELATED_TYPE = 'todo';

/**
 * Slack errors that sending again can't fix. A to-do row fails at once on them, so the person
 * sees "Couldn't post to Slack." and "Try again" while still on Today, instead of "Posting…" for
 * the next hour of retries. Reports and direct messages keep every retry.
 */
const PERMANENT_ERRORS = new Set([
  'not_in_channel',
  'channel_not_found',
  'is_archived',
  'msg_too_long',
  'no_text',
  'restricted_action',
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'missing_scope',
  'invalid_payload',
]);

/** True when a failed to-do row should be marked failed now, without retries. */
export function isPermanentTodoError(row, error) {
  if (!TODO_KINDS.has(row.kind)) return false;
  return PERMANENT_ERRORS.has(client.slackErrorCode(error));
}

function postAs(channel, payload) {
  return client.postMessage({
    channel,
    text: payload.text,
    username: payload.username,
    iconUrl: payload.icon_url,
  });
}

/** The to-do message the report already has: the one it remembers, else the last one sent. */
async function currentMessage(reportId) {
  const post = await reports.findTodoPost(reportId);
  if (post?.ts && post.channelId) return { channel: post.channelId, ts: post.ts };
  const sent = await repo.findSentMessage({ relatedType: RELATED_TYPE, relatedId: reportId });
  return sent ? { channel: sent.channel, ts: sent.resultTs } : null;
}

/**
 * Sends a todo_post or todo_update row. Two quick clicks queue two rows: the older one is
 * skipped, so one up-to-date message goes out.
 * @returns {Promise<{ channel: string, ts: string, kind: 'todo_post' | 'todo_update' }
 *   | { skipped: string }>}
 */
export async function deliverTodo(row, payload) {
  const reportId = row.relatedType === RELATED_TYPE ? row.relatedId : null;
  if (
    reportId &&
    (await repo.hasNewerMessage({ id: row.id, relatedType: RELATED_TYPE, relatedId: reportId }))
  ) {
    return { skipped: 'superseded by a newer version of this to-do' };
  }
  const target = reportId ? await currentMessage(reportId) : null;
  if (!target) return { ...(await postAs(row.channel, payload)), kind: 'todo_post' };
  try {
    const result = await client.updateMessage({ ...target, text: payload.text });
    return { ...result, kind: 'todo_update' };
  } catch (error) {
    const current = await settings.getAll();
    if (!client.isMessageGone(error) || !current.slackTodoChannelId) throw error;
    logger.warn(
      { outboxId: row.id, reportId, slackError: error.data.error },
      'slack to-do message can no longer be updated; posting a new one',
    );
    return { ...(await postAs(current.slackTodoChannelId, payload)), kind: 'todo_post' };
  }
}

/**
 * After a to-do post or update went out: the report stores the channel, ts, when it was sent and
 * the plan's hash (so "Update post" shows only after the list changes). A failure here is logged;
 * the message itself was sent.
 * @param {{ id: number, relatedType: string | null, relatedId: number | null }} row
 * @param {{ channel: string, ts: string }} delivered
 * @param {{ hash?: string | null }} payload
 * @param {Date} at
 */
export async function saveTodoDelivery(row, delivered, payload, at) {
  if (row.relatedType !== RELATED_TYPE || !row.relatedId) return;
  try {
    await reports.saveTodoSlackMessage({
      reportId: row.relatedId,
      channelId: delivered.channel,
      ts: delivered.ts,
      hash: payload.hash ?? null,
      at,
    });
  } catch (error) {
    logger.error(
      { err: error, outboxId: row.id, reportId: row.relatedId },
      'could not save the slack to-do message on the report',
    );
  }
}
