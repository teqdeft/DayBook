import { db, toJson } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { now, nowDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as client from './client';
import { escapeSlackText, formatReport } from './format';
import * as repo from './repo';
import { enqueueSchema } from './schemas';

export { processOutbox } from './outbox';

const CONNECTION_TTL_MS = 5 * 60 * 1000;
const CONNECTION_ERROR_TTL_MS = 60 * 1000;
let connectionCache = { value: null, expiresAt: 0 };

const toCamel = (key) => String(key).replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

/**
 * True when the server has a Slack bot token (SLACK_BOT_TOKEN), so messages can be sent.
 * @returns {boolean}
 */
export function isConfigured() {
  return client.isConfigured();
}

/**
 * Adds a row to slack_outbox. Call it inside the transaction of the change it belongs to, so the
 * message is queued only if the change commits. The worker sends it within about 10 seconds.
 * @param {{ kind: 'report_post' | 'report_update' | 'dm' | 'message', channel: string,
 *   payload: { text: string, [key: string]: unknown }, relatedType?: string | null,
 *   relatedId?: number | null }} message channel is a channel ID, or a Slack user ID for a DM
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

/**
 * Queues a submitted report for the report channel, in the team's format, under the person's
 * name and photo (chat:write.customize). The first submit posts a new message; when the report
 * already has a Slack message (report.slackTs), the same message is updated in place.
 * Does nothing when Slack is off, slack_post_reports is off, or no channel is picked.
 * @param {{ report: { id: number, workDate: string, slackTs?: string | null,
 *   slackChannelId?: string | null }, userName: string, userSlackUserId?: string | null,
 *   avatarUrl?: string | null, entries: Array<{ projectName: string, minutes: number,
 *   tasks: Array<{ title: string, status: string }> }> }} input
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number | null>} the outbox row id, or null when nothing was queued
 */
export async function queueReportPost({ report, userName, avatarUrl, entries }, trx = db) {
  const current = await settings.getAll();
  if (!current.slackEnabled || !current.slackPostReports || !current.slackReportChannelId)
    return null;
  const text = escapeSlackText(formatReport({ userName, workDate: report.workDate, entries }));
  const identity = { username: userName, ...(avatarUrl ? { icon_url: avatarUrl } : {}) };
  if (report.slackTs) {
    return enqueue(
      {
        kind: 'report_update',
        channel: report.slackChannelId || current.slackReportChannelId,
        payload: { text, ts: report.slackTs, ...identity },
        relatedType: 'report',
        relatedId: report.id,
      },
      trx,
    );
  }
  return enqueue(
    {
      kind: 'report_post',
      channel: current.slackReportChannelId,
      payload: { text, ...identity },
      relatedType: 'report',
      relatedId: report.id,
    },
    trx,
  );
}

/**
 * Queues a Slack direct message. Does nothing when Slack is off or when the named setting
 * (for example 'slackRemind', 'slackUrgentNotify', 'slackRequestsNotify') is off. A person without
 * a Slack user ID is skipped and logged; their in-app notification still arrives.
 * @param {{ slackUserId?: string | null, text: string, settingKey?: string,
 *   relatedType?: string | null, relatedId?: number | null }} input text may use Slack link
 *   syntax, for example 'Open <https://daybook.example/report|your report>'
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number | null>} the outbox row id, or null when nothing was queued
 */
export async function queueDm({ slackUserId, text, settingKey, relatedType, relatedId }, trx = db) {
  const current = await settings.getAll();
  if (!current.slackEnabled) return null;
  if (settingKey) {
    const key = toCamel(settingKey);
    if (typeof current[key] !== 'boolean') {
      logger.warn({ settingKey }, 'unknown slack setting; direct message not queued');
      return null;
    }
    if (!current[key]) return null;
  }
  if (!slackUserId) {
    logger.info(
      {
        settingKey: settingKey ?? null,
        relatedType: relatedType ?? null,
        relatedId: relatedId ?? null,
      },
      'slack direct message skipped: the person has no Slack user ID',
    );
    return null;
  }
  return enqueue(
    { kind: 'dm', channel: slackUserId, payload: { text }, relatedType, relatedId },
    trx,
  );
}

/**
 * The Slack connection for the Settings screen. Checks the bot token with auth.test (cached for 5
 * minutes). connected is false when Slack is turned off in settings.
 * @returns {Promise<{ configured: boolean, connected: boolean, teamName: string | null }>}
 *   configured: a bot token is set on the server
 */
export async function getConnection() {
  if (!client.isConfigured()) return { configured: false, connected: false, teamName: null };
  const current = await settings.getAll();
  if (!current.slackEnabled) return { configured: true, connected: false, teamName: null };
  const at = performance.now();
  if (connectionCache.value && at < connectionCache.expiresAt) return { ...connectionCache.value };
  let value;
  let ttl = CONNECTION_TTL_MS;
  try {
    const result = await client.authTest();
    value = { configured: true, connected: true, teamName: result.teamName };
  } catch (error) {
    logger.warn({ err: error, slackError: client.slackErrorCode(error) }, 'slack auth.test failed');
    value = { configured: true, connected: false, teamName: null };
    ttl = CONNECTION_ERROR_TTL_MS;
  }
  connectionCache = { value, expiresAt: at + ttl };
  return { ...value };
}

/** Tests only: forget the cached auth.test result. */
export function resetConnectionCacheForTests() {
  connectionCache = { value: null, expiresAt: 0 };
}

/**
 * Public channels the bot is in (so it can post there), sorted by name, for the "Post reports
 * to" picker. Empty when no bot token is set.
 * @returns {Promise<Array<{ id: string, name: string }>>}
 * @throws SLACK_ERROR when Slack doesn't answer
 */
export async function listChannels() {
  if (!client.isConfigured()) return [];
  try {
    const channels = await client.listMemberChannels();
    return channels.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  } catch (error) {
    logger.warn(
      { err: error, slackError: client.slackErrorCode(error) },
      'slack conversations.list failed',
    );
    throw new AppError('SLACK_ERROR', { cause: error });
  }
}

/**
 * The Slack user ID for an email (users.lookupByEmail), for the hourly user sync.
 * @param {string} email
 * @returns {Promise<string | null>} null when Slack has nobody with that email or no bot token is set
 * @throws the Slack error on other failures (for example a rate limit), so the sync can log it
 */
export async function lookupUserIdByEmail(email) {
  const value = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!value || !client.isConfigured()) return null;
  return client.lookupUserByEmail(value);
}

/**
 * Queue health for monitoring (the health-log job): pending messages and the oldest one.
 * @returns {Promise<{ pending: number, oldestPendingAt: Date | null, failedLastDay: number }>}
 */
export async function outboxHealth() {
  const stats = await repo.pendingStats();
  const failedLastDay = await repo.countFailedSince(now().subtract(1, 'day').toDate());
  return { ...stats, failedLastDay };
}

/**
 * Deletes sent outbox rows created before a moment (the daily cleanup keeps 90 days). Pending and
 * failed rows are kept.
 * @param {Date} before
 * @returns {Promise<number>} how many rows were deleted
 */
export function deleteOldSent(before) {
  return repo.deleteSentBefore(before);
}
