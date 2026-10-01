// Worker job: fills in Slack user IDs for people added by email.
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import { slack } from '@/modules/slack';
import * as repo from './repo';

/**
 * Worker job (hourly): looks up the Slack user ID by email for active people who don't have one
 * yet and saves it. Stops early when Slack rate-limits; other lookup errors skip that person.
 * @returns {Promise<{ updated: number }>}
 */
export async function syncSlackUserIds() {
  const people = await repo.listMissingSlackIds();
  let updated = 0;
  for (const person of people) {
    let slackUserId;
    try {
      slackUserId = await slack.lookupUserIdByEmail(person.email);
    } catch (error) {
      logger.warn({ err: error, userId: person.id }, 'slack user lookup failed');
      if (error?.code === 'slack_webapi_rate_limited_error' || error?.data?.error === 'ratelimited')
        break;
      continue;
    }
    if (!slackUserId) continue;
    const owner = await repo.findBySlackUserId(slackUserId);
    if (owner && owner.id !== person.id) {
      logger.warn(
        { userId: person.id, ownerId: owner.id },
        'slack user id already belongs to someone',
      );
      continue;
    }
    try {
      updated += await repo.updateUser(person.id, { slackUserId, updatedAt: nowDate() });
    } catch (error) {
      if (error?.errno !== 1062) throw error;
      logger.warn({ userId: person.id }, 'slack user id was saved for someone else meanwhile');
    }
  }
  if (updated > 0) logger.info({ updated }, 'slack user ids saved');
  return { updated };
}
