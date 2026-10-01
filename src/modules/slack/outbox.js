// Sends due slack_outbox rows (build guide section 11, "How the outbox works"). The worker calls
// processOutbox() every 10 seconds.
import { db, parseJson, supportsSkipLocked } from '@/lib/db';
import { logger } from '@/lib/logger';
import { now, nowDate } from '@/lib/time';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import * as client from './client';
import * as repo from './repo';

export const BATCH_SIZE = 20;
/** Minutes to wait after the 1st, 2nd, 3rd and 4th failure; the 5th failure is final. */
export const RETRY_MINUTES = [1, 5, 15, 60];
/**
 * A claimed row becomes due again after this long if the worker dies while sending it. Longer
 * than a worst-case batch (20 rows x the client's 15-second timeout = 5 minutes).
 */
const CLAIM_LEASE_MINUTES = 10;
/** chat.update errors that mean the old message is gone, so a new post replaces it. */
const MESSAGE_GONE = new Set([
  'message_not_found',
  'cant_update_message',
  'channel_not_found',
  'is_archived',
  'edit_window_closed',
]);
const REPORT_KINDS = new Set(['report_post', 'report_update']);
/**
 * A direct message still unsent after this long (for example queued while no bot token was set)
 * is dropped: a day-old reminder helps nobody. Report posts never expire.
 */
const DM_EXPIRES_HOURS = 24;

/** Claims up to BATCH_SIZE due rows: locks them and pushes next_attempt_at forward as a lease. */
async function claimDue() {
  const skipLocked = await supportsSkipLocked();
  return db.transaction(async (trx) => {
    const rows = await repo.selectDueForUpdate(
      { now: nowDate(), limit: BATCH_SIZE, skipLocked },
      trx,
    );
    const lease = now().add(CLAIM_LEASE_MINUTES, 'minute').toDate();
    await repo.setNextAttempt(
      rows.map((row) => row.id),
      lease,
      trx,
    );
    return rows;
  });
}

function postReport(channel, payload) {
  return client.postMessage({
    channel,
    text: payload.text,
    username: payload.username,
    iconUrl: payload.icon_url,
  });
}

/**
 * A report post or update. A row that a newer row for the same report replaces is skipped, and a
 * post for a report that already has a message updates that message, so resubmitting quickly
 * never posts twice.
 */
async function deliverReport(row, payload) {
  const reportId = row.relatedType === 'report' ? row.relatedId : null;
  if (reportId && (await repo.hasNewerReportMessage({ id: row.id, reportId }))) {
    return { skipped: 'superseded by a newer version of this report' };
  }
  let target = null;
  if (row.kind === 'report_update') target = { channel: row.channel, ts: payload.ts };
  else if (reportId) {
    const sent = await repo.findSentReportMessage(reportId);
    if (sent) target = { channel: sent.channel, ts: sent.resultTs };
  }
  if (!target) return { ...(await postReport(row.channel, payload)), kind: 'report_post' };
  try {
    const result = await client.updateMessage({ ...target, text: payload.text });
    return { ...result, kind: 'report_update' };
  } catch (error) {
    const current = await settings.getAll();
    if (!MESSAGE_GONE.has(error?.data?.error) || !current.slackReportChannelId) throw error;
    logger.warn(
      { outboxId: row.id, reportId, slackError: error.data.error },
      'slack report message can no longer be updated; posting a new one',
    );
    return { ...(await postReport(current.slackReportChannelId, payload)), kind: 'report_post' };
  }
}

function deliver(row, payload) {
  if (REPORT_KINDS.has(row.kind)) return deliverReport(row, payload);
  if (row.kind === 'dm') return client.postMessage({ channel: row.channel, text: payload.text });
  return postReport(row.channel, payload);
}

async function markSent(row, delivered) {
  const at = nowDate();
  const changes = {
    status: 'sent',
    attempts: row.attempts + 1,
    sentAt: at,
    lastError: null,
    updatedAt: at,
  };
  if (REPORT_KINDS.has(row.kind)) {
    Object.assign(changes, {
      kind: delivered.kind,
      channel: delivered.channel,
      resultTs: delivered.ts,
    });
  } else {
    changes.resultTs = delivered.ts ?? null;
  }
  await repo.updateOutbox(row.id, changes);
  // A new report message: remember it on the report, so later submits update the same message.
  if (delivered.kind === 'report_post' && row.relatedType === 'report' && row.relatedId) {
    try {
      await reports.saveSlackMessage({
        reportId: row.relatedId,
        channelId: delivered.channel,
        ts: delivered.ts,
      });
    } catch (error) {
      logger.error(
        { err: error, reportId: row.relatedId },
        'could not save the slack message on the report',
      );
    }
  }
}

async function handleFailure(row, error) {
  const slackError = client.slackErrorCode(error);
  const retryAfter = client.rateLimitRetryAfter(error);
  if (retryAfter) {
    // Not the message's fault, so it doesn't count as an attempt.
    const until = now().add(retryAfter, 'second').toDate();
    await repo.updateOutbox(row.id, {
      nextAttemptAt: until,
      lastError: 'rate_limited',
      updatedAt: nowDate(),
    });
    logger.warn(
      { outboxId: row.id, kind: row.kind, retryAfter },
      'slack rate limit; waiting before sending again',
    );
    return { status: 'retried', rateLimitedUntil: until };
  }
  const attempts = row.attempts + 1;
  const lastError = slackError.slice(0, 500);
  if (attempts <= RETRY_MINUTES.length) {
    const retryInMinutes = RETRY_MINUTES[attempts - 1];
    const nextAttemptAt = now().add(retryInMinutes, 'minute').toDate();
    await repo.updateOutbox(row.id, { attempts, lastError, nextAttemptAt, updatedAt: nowDate() });
    logger.warn(
      { outboxId: row.id, kind: row.kind, attempts, slackError, retryInMinutes },
      'slack message failed; will retry',
    );
    return { status: 'retried' };
  }
  await repo.updateOutbox(row.id, { status: 'failed', attempts, lastError, updatedAt: nowDate() });
  logger.error(
    { outboxId: row.id, kind: row.kind, attempts, slackError },
    'slack message failed after all retries',
  );
  return { status: 'failed' };
}

async function sendRow(row) {
  let payload = null;
  try {
    payload = parseJson(row.payload);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload.text !== 'string') {
    return handleFailure({ ...row, attempts: RETRY_MINUTES.length }, new Error('invalid_payload'));
  }
  if (row.kind === 'dm' && now().diff(row.createdAt, 'hour', true) >= DM_EXPIRES_HOURS) {
    await repo.updateOutbox(row.id, {
      status: 'failed',
      lastError: 'expired: not sent within 24 hours',
      updatedAt: nowDate(),
    });
    logger.warn({ outboxId: row.id }, 'slack direct message expired before it could be sent');
    return { status: 'failed' };
  }
  try {
    const delivered = await deliver(row, payload);
    if (delivered.skipped) {
      const at = nowDate();
      await repo.updateOutbox(row.id, {
        status: 'sent',
        sentAt: at,
        lastError: `skipped: ${delivered.skipped}`,
        updatedAt: at,
      });
      return { status: 'skipped' };
    }
    await markSent(row, delivered);
    return { status: 'sent' };
  } catch (error) {
    return handleFailure(row, error);
  }
}

/**
 * Sends due Slack messages: claims up to 20 pending rows whose next_attempt_at has passed, sends
 * each one outside the claiming transaction, then marks it sent (with result_ts; for a new report
 * post also reports.saveSlackMessage) or schedules a retry after 1, 5, 15 and 60 minutes before
 * marking it failed. A rate-limit reply waits the retry_after Slack asks for. Without
 * SLACK_BOT_TOKEN nothing is sent and rows stay pending.
 * @returns {Promise<{ sent: number, skipped: number, retried: number, failed: number,
 *   configured: boolean }>}
 */
export async function processOutbox() {
  const result = { sent: 0, skipped: 0, retried: 0, failed: 0, configured: client.isConfigured() };
  if (!result.configured) {
    logger.debug('slack outbox: SLACK_BOT_TOKEN is not set, messages stay pending');
    return result;
  }
  const rows = await claimDue();
  for (let index = 0; index < rows.length; index += 1) {
    const outcome = await sendRow(rows[index]);
    result[outcome.status] += 1;
    if (outcome.rateLimitedUntil) {
      // Slack asked us to slow down: the rest of this batch waits too.
      const rest = rows.slice(index + 1).map((row) => row.id);
      await repo.setNextAttempt(rest, outcome.rateLimitedUntil);
      break;
    }
  }
  if (rows.length > 0) logger.info({ job: 'slack-outbox', ...result }, 'slack outbox processed');
  return result;
}
