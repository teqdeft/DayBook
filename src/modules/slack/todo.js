// A person's to-do on Slack (CONTRACT 24). reports.queueTodoPost queues it when the person clicks
// "Post to Slack" on Today; it always goes to the to-do channel picked in Settings, never the
// report channel, under the person's name and photo. todoDelivery.js sends it.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { settings } from '@/modules/settings';
import * as client from './client';
import { enqueue } from './enqueue';
import { escapeSlackText } from './format';
import * as repo from './repo';

const RELATED_TYPE = 'todo';

function postingOn(current) {
  return Boolean(current.slackEnabled && client.isConfigured() && current.slackTodoChannelId);
}

/**
 * Whether to-dos can be posted now: Slack is on, the server has a bot token and an Admin picked a
 * to-do channel. The Today card hides "Post to Slack" otherwise.
 * @returns {Promise<boolean>}
 */
export async function canPostTodo() {
  return postingOn(await settings.getAll());
}

/** The person's name and photo for the post. users imports slack, so it is imported here. */
async function identityFor({ userId, userName, avatarUrl }) {
  let name = userName;
  let photo = avatarUrl;
  if (!name) {
    const { users } = await import('@/modules/users');
    const person = await users.findById(userId);
    name = person?.name;
    photo = person?.avatarUrl;
  }
  return { ...(name ? { username: name } : {}), ...(photo ? { icon_url: photo } : {}) };
}

/**
 * Queues a person's to-do for the to-do channel, as the person (chat:write.customize). The outbox
 * posts it, or updates the message the report already has (todo_slack_ts), so "Update post" edits
 * the same message; of two rows queued before the worker runs, only the newer one is sent.
 * @param {{ reportId: number, userId: number, text: string, hash: string, update?: boolean,
 *   userName?: string, avatarUrl?: string | null }} input text: formatTodo() output, not escaped
 *   (it is escaped here); hash: sha256 of the plan, stored on the report once sent; update: the
 *   report already has a to-do message (the row's kind is then todo_update); userName and
 *   avatarUrl are optional, read from users by userId when left out
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} the outbox row id
 * @throws CONFLICT (409, "Slack posting is off.") when Slack is off, no bot token is set or no
 *   to-do channel is picked
 */
export async function queueTodoPost(
  { reportId, userId, text, hash, update, userName, avatarUrl },
  trx = db,
) {
  const current = await settings.getAll();
  if (!postingOn(current)) throw new AppError('CONFLICT', { message: 'Slack posting is off.' });
  const identity = await identityFor({ userId, userName, avatarUrl });
  return enqueue(
    {
      kind: update ? 'todo_update' : 'todo_post',
      channel: current.slackTodoChannelId,
      payload: { text: escapeSlackText(text), hash: hash ?? null, ...identity },
      relatedType: RELATED_TYPE,
      relatedId: reportId,
    },
    trx,
  );
}

/**
 * Where the latest to-do message of a report stands, for the Today card ("Posting…", "Posted at
 * 9:41 AM", "Couldn't post to Slack.").
 * @param {number} reportId
 * @returns {Promise<{ status: 'none' | 'sending' | 'sent' | 'failed', at: Date | null }>}
 *   none: never queued; sending: waiting or retrying (at = when it was queued); sent: at = when
 *   Slack took it; failed: after the last retry or an error a retry can't fix (at = when it gave
 *   up)
 */
export async function latestTodoDelivery(reportId) {
  const id = Number(reportId);
  if (!Number.isInteger(id) || id <= 0) return { status: 'none', at: null };
  const row = await repo.findLatestMessage({ relatedType: RELATED_TYPE, relatedId: id });
  if (!row) return { status: 'none', at: null };
  if (row.status === 'sent') return { status: 'sent', at: row.sentAt ?? row.updatedAt };
  if (row.status === 'failed') return { status: 'failed', at: row.updatedAt };
  return { status: 'sending', at: row.createdAt };
}
