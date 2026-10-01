// health-log: every 5 minutes, log the Slack queue length and the oldest pending message, for
// monitoring. A message pending for 15 minutes or more is logged as a warning (the alert).
// Like every job it runs through runOnce, one run key per 5-minute slot, so two workers write each
// health line once.
import { logger } from '@/lib/logger';
import { minutesBetween, now } from '@/lib/time';
import { slack } from '@/modules/slack';
import { runOnce } from '../runOnce';

const EVERY_MINUTES = 5;
const SLOT_MS = EVERY_MINUTES * 60_000;
const ALERT_AFTER_MINUTES = 15;

/**
 * The run key of the 5-minute slot nearest to a moment, in UTC, for example
 * 'health_log:2026-10-01T10:05'. Nearest rather than the one started, so a tick that fires a
 * moment early or late still gets its own slot.
 * @param {import('dayjs').Dayjs} [at] defaults to now
 * @returns {string}
 */
export function healthLogRunKey(at = now()) {
  const offsetMs = Math.round(at.valueOf() / SLOT_MS) * SLOT_MS - at.valueOf();
  return `health_log:${at.utc().add(offsetMs, 'millisecond').format('YYYY-MM-DD[T]HH:mm')}`;
}

/** Reads the outbox health and logs it: a warning when a message has waited too long. */
async function logHealth() {
  const health = await slack.outboxHealth();
  const oldestPendingMinutes = health.oldestPendingAt
    ? minutesBetween(health.oldestPendingAt, now())
    : 0;
  const entry = {
    job: 'health-log',
    slackConfigured: slack.isConfigured(),
    ...health,
    oldestPendingMinutes,
  };
  if (entry.slackConfigured && oldestPendingMinutes >= ALERT_AFTER_MINUTES) {
    logger.warn(
      entry,
      `slack outbox is behind: a message has waited ${oldestPendingMinutes} minutes`,
    );
  } else {
    logger.info(entry, 'health');
  }
  return entry;
}

export const healthLogJob = {
  name: 'health-log',
  cron: `0 */${EVERY_MINUTES} * * * *`,
  // quiet: logHealth writes the health line itself, so runOnce's "job done" goes to debug.
  tick: () => runOnce('health-log', healthLogRunKey(), logHealth, { quiet: true }),
};
