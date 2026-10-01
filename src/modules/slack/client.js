// The one place that talks to the Slack Web API with the bot token. Services call these small
// functions; tests swap the WebClient for a fake with setSlackClientForTests().
import { LogLevel, WebClient } from '@slack/web-api';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const RATE_LIMITED = 'slack_webapi_rate_limited_error';
const MAX_CHANNEL_PAGES = 25;

let testClient = null;

// Slack's SDK logs through this adapter into pino (never the token: the SDK doesn't log it).
const slackLogger = {
  debug: (...args) => logger.debug({ source: 'slack-sdk' }, args.join(' ')),
  info: (...args) => logger.debug({ source: 'slack-sdk' }, args.join(' ')),
  warn: (...args) => logger.warn({ source: 'slack-sdk' }, args.join(' ')),
  error: (...args) => logger.error({ source: 'slack-sdk' }, args.join(' ')),
  setLevel() {},
  getLevel: () => LogLevel.WARN,
  setName() {},
};

/** Tests only: use a fake client ({ chat, auth, conversations, users }); null restores Slack. */
export function setSlackClientForTests(client) {
  testClient = client;
}

/** True when a bot token is set (or a test client is in place). */
export function isConfigured() {
  return Boolean(testClient || env.SLACK_BOT_TOKEN);
}

/** The shared WebClient, or null without a bot token. */
function getClient() {
  if (testClient) return testClient;
  if (!env.SLACK_BOT_TOKEN) return null;
  if (!globalThis.__daybookSlackClient) {
    globalThis.__daybookSlackClient = new WebClient(env.SLACK_BOT_TOKEN, {
      // The outbox has its own retry schedule, and rate limits come back to it as errors
      // (with retryAfter) instead of the SDK waiting inside a request.
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      timeout: 15_000,
      logger: slackLogger,
      logLevel: LogLevel.WARN,
    });
  }
  return globalThis.__daybookSlackClient;
}

function requireClient() {
  const client = getClient();
  if (!client) throw new Error('SLACK_BOT_TOKEN is not set');
  return client;
}

/** Seconds Slack asked us to wait, when the error is a rate limit; otherwise null. */
export function rateLimitRetryAfter(error) {
  if (error?.code !== RATE_LIMITED) return null;
  const seconds = Number(error.retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

/** A short error description for logs and last_error: 'not_in_channel', 'rate_limited', ... */
export function slackErrorCode(error) {
  if (error?.data?.error) return String(error.data.error);
  if (error?.code === RATE_LIMITED) return 'rate_limited';
  const detail = error?.original?.message ?? error?.message;
  if (error?.code && detail) return `${error.code}: ${detail}`;
  return String(detail ?? error?.code ?? 'unknown_error');
}

/**
 * chat.postMessage. With username/iconUrl (chat:write.customize) the post shows under the
 * person's name and photo. For a DM, channel is the person's Slack user ID.
 * @returns {Promise<{ channel: string, ts: string }>}
 */
export async function postMessage({ channel, text, username, iconUrl }) {
  const args = { channel, text, unfurl_links: false, unfurl_media: false };
  if (username) args.username = username;
  if (iconUrl) args.icon_url = iconUrl;
  const result = await requireClient().chat.postMessage(args);
  return { channel: result.channel ?? channel, ts: result.ts };
}

/**
 * chat.update of an earlier message.
 * @returns {Promise<{ channel: string, ts: string }>}
 */
export async function updateMessage({ channel, ts, text }) {
  const result = await requireClient().chat.update({ channel, ts, text });
  return { channel: result.channel ?? channel, ts: result.ts ?? ts };
}

/**
 * auth.test with the bot token.
 * @returns {Promise<{ teamName: string | null, teamId: string | null, botUserId: string | null }>}
 */
export async function authTest() {
  const result = await requireClient().auth.test();
  return {
    teamName: result.team ?? null,
    teamId: result.team_id ?? null,
    botUserId: result.user_id ?? null,
  };
}

/**
 * Public channels the bot is a member of (so it can post there), following Slack's paging.
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listMemberChannels() {
  const client = requireClient();
  const channels = [];
  let cursor;
  for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
    const result = await client.conversations.list({
      types: 'public_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const channel of result.channels ?? []) {
      if (channel.is_member && !channel.is_archived)
        channels.push({ id: channel.id, name: channel.name });
    }
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return channels;
}

/**
 * users.lookupByEmail. Null when Slack has nobody with that email.
 * @returns {Promise<string | null>}
 */
export async function lookupUserByEmail(email) {
  try {
    const result = await requireClient().users.lookupByEmail({ email });
    return result.user?.id ?? null;
  } catch (error) {
    if (error?.data?.error === 'users_not_found') return null;
    throw error;
  }
}
