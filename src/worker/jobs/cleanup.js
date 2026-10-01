// cleanup: once a day at 03:00 company time. Deletes expired sessions, sent outbox rows older than
// 90 days and read notifications older than 180 days. It also keeps job_runs bounded (health-log
// adds a row every 5 minutes): rows older than 90 days go, long after their run keys stopped
// mattering (every key names its own day, hour or 5-minute slot). Screen time is kept for
// settings.activityRetentionDays days (work dates before today minus that many days go).
import { addDays, now } from '@/lib/time';
import { activity } from '@/modules/activity';
import { auth } from '@/modules/auth';
import { notifications } from '@/modules/notifications';
import { slack } from '@/modules/slack';
import { companyNow, isAtOrAfter } from '../clock';
import * as repo from '../repo';
import { runOnce } from '../runOnce';

const RUN_AT = '03:00';
const KEEP_SENT_OUTBOX_DAYS = 90;
const KEEP_READ_NOTIFICATIONS_DAYS = 180;
const KEEP_JOB_RUNS_DAYS = 90;

/**
 * Runs every step even if one fails, then fails the run if any step did.
 * @param {string} date today's company date
 * @param {{ activityRetentionDays: number }} current the settings read for this tick
 */
async function cleanUp(date, current) {
  const steps = {
    expiredSessions: () => auth.deleteExpiredSessions(),
    sentOutbox: () => slack.deleteOldSent(now().subtract(KEEP_SENT_OUTBOX_DAYS, 'day').toDate()),
    readNotifications: () =>
      notifications.deleteOldRead(now().subtract(KEEP_READ_NOTIFICATIONS_DAYS, 'day').toDate()),
    jobRuns: () => repo.deleteRunsStartedBefore(now().subtract(KEEP_JOB_RUNS_DAYS, 'day').toDate()),
    activitySegments: () => activity.deleteOlderThan(addDays(date, -current.activityRetentionDays)),
  };
  const deleted = {};
  const errors = [];
  for (const [name, step] of Object.entries(steps)) {
    try {
      deleted[name] = Number(await step()) || 0;
    } catch (error) {
      errors.push(`${name}: ${error?.message ?? error}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`cleanup failed (${errors.join('; ')}); deleted ${JSON.stringify(deleted)}`);
  }
  return deleted;
}

export const cleanupJob = {
  name: 'cleanup',
  cron: '0 * * * * *',
  async tick() {
    const { date, minutes, settings } = await companyNow();
    if (!isAtOrAfter(minutes, RUN_AT)) return null;
    return runOnce('cleanup', `cleanup:${date}`, () => cleanUp(date, settings));
  },
};
